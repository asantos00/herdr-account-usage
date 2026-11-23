import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAccountProfiles, launchArgv, profileId, resolveProfile } from "./account-profiles.mjs";

const fakeFs = ({ dirs = [], files = {} } = {}) => ({
  existsSync(path) { return dirs.includes(path) || Object.hasOwn(files, path); },
  readdirSync(path) {
    const prefix = `${path}/`;
    return dirs
      .filter((candidate) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"))
      .map((candidate) => ({ name: candidate.slice(prefix.length), isDirectory: () => true }));
  },
  readFileSync(path) {
    if (!Object.hasOwn(files, path)) throw new Error("missing");
    return files[path];
  },
});

test("auto-discovers default and suffixed Claude and Codex homes", () => {
  const profiles = discoverAccountProfiles({
    home: "/Users/test",
    env: {},
    fs: fakeFs({ dirs: [
      "/Users/test/.claude",
      "/Users/test/.claude-work",
      "/Users/test/.claude-ttc",
      "/Users/test/.codex",
      "/Users/test/.codex-2",
      "/Users/test/.codex-company",
      "/Users/test/.codexbar",
    ] }),
    profilesPath: "/missing/profiles.json",
  });

  assert.deepEqual(profiles.map(({ kind, label, configDir }) => ({ kind, label, configDir })), [
    { kind: "codex", label: "Codex", configDir: "/Users/test/.codex" },
    { kind: "codex", label: "Codex 2", configDir: "/Users/test/.codex-2" },
    { kind: "codex", label: "Codex Company", configDir: "/Users/test/.codex-company" },
    { kind: "claude", label: "Claude", configDir: "/Users/test/.claude" },
    { kind: "claude", label: "Claude TTC", configDir: "/Users/test/.claude-ttc" },
    { kind: "claude", label: "Claude Work", configDir: "/Users/test/.claude-work" },
  ]);
});

test("an accounts file provides exact labels and arbitrary profile homes", () => {
  const profilesPath = "/mod/accounts.json";
  const profiles = discoverAccountProfiles({
    home: "/Users/test",
    env: {},
    fs: fakeFs({ files: {
      [profilesPath]: JSON.stringify({ accounts: [
        { kind: "claude", label: "Client", configDir: "~/.accounts/client-claude" },
        { kind: "codex", label: "Personal", configDir: "/Volumes/secure/codex" },
      ] }),
    } }),
    profilesPath,
  });

  assert.deepEqual(profiles.map(({ kind, label, configDir }) => ({ kind, label, configDir })), [
    { kind: "claude", label: "Client", configDir: "/Users/test/.accounts/client-claude" },
    { kind: "codex", label: "Personal", configDir: "/Volumes/secure/codex" },
  ]);
});

test("profile ids are stable without exposing the credential path", () => {
  const id = profileId("claude", "/Users/test/.claude-work");
  assert.match(id, /^claude-[a-f0-9]{12}$/);
  assert.equal(id.includes("Users"), false);
});

test("launches each chat with only its selected account home", () => {
  assert.deepEqual(launchArgv({ kind: "claude", configDir: "/profiles/claude-work" }), [
    "env", "CLAUDE_CONFIG_DIR=/profiles/claude-work", "claude",
  ]);
  assert.deepEqual(launchArgv(
    { kind: "codex", configDir: "/profiles/codex-work" },
    { piAgentDir: "/profiles/pi-codex-work" },
  ), [
    "env", "CODEX_HOME=/profiles/codex-work", "PI_CODING_AGENT_DIR=/profiles/pi-codex-work", "pi",
  ]);
});

test("resolves a launcher id without accepting an unknown profile", () => {
  const profiles = [{ id: "claude-known", kind: "claude", configDir: "/profiles/known" }];
  assert.equal(resolveProfile(profiles, "claude-known"), profiles[0]);
  assert.throws(() => resolveProfile(profiles, "claude-missing"), /Unknown account profile/);
});

test("the account control list exposes safe palette metadata without config paths", () => {
  const root = mkdtempSync(join(tmpdir(), "account-list-"));
  const profilesPath = join(root, "accounts.json");
  writeFileSync(profilesPath, JSON.stringify({ accounts: [
    { kind: "claude", label: "Claude Client", email: "client@example.com", configDir: join(root, "secret-claude-home") },
  ] }));
  const control = join(dirname(fileURLToPath(import.meta.url)), "account-control.mjs");
  const result = spawnSync(process.execPath, [control, "list"], {
    encoding: "utf8",
    env: { ...process.env, ACCOUNT_USAGE_PROFILES: profilesPath },
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.accounts.map(({ kind, label, email, color }) => ({ kind, label, email, color })), [
    { kind: "claude", label: "Claude Client", email: "client@example.com", color: "#F59E75" },
  ]);
  assert.equal(result.stdout.includes("secret-claude-home"), false);
});

test("the chat launcher opens Pi with the selected Codex subscription", () => {
  const root = mkdtempSync(join(tmpdir(), "account-control-"));
  const bin = join(root, "bin");
  const configDir = join(root, "codex-work");
  const profilesPath = join(root, "accounts.json");
  const piAgentDir = join(root, ".pi", "agent");
  mkdirSync(bin);
  mkdirSync(configDir);
  mkdirSync(piAgentDir, { recursive: true });
  writeFileSync(join(piAgentDir, "settings.json"), "{}\n");
  writeFileSync(join(piAgentDir, "auth.json"), "{}\n");
  writeFileSync(join(configDir, "auth.json"), JSON.stringify({ tokens: {
    access_token: `x.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString("base64url")}.y`,
    refresh_token: "refresh", account_id: "work-account",
  } }));
  writeFileSync(profilesPath, JSON.stringify({ accounts: [{ kind: "codex", label: "Work", configDir }] }));
  const fakePi = join(bin, "pi");
  writeFileSync(fakePi, "#!/bin/sh\nprintf '%s|%s' \"$CODEX_HOME\" \"$PI_CODING_AGENT_DIR\"\n");
  chmodSync(fakePi, 0o755);
  const labelLog = join(root, "labels.log");
  const fakeHc = join(bin, "hc");
  writeFileSync(fakeHc, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HC_LABEL_LOG\"\n");
  chmodSync(fakeHc, 0o755);

  const id = profileId("codex", configDir);
  const control = join(dirname(fileURLToPath(import.meta.url)), "account-control.mjs");
  const result = spawnSync(process.execPath, [control, "launch", id], {
    encoding: "utf8",
    env: {
      ...process.env,
      ACCOUNT_USAGE_PROFILES: profilesPath,
      HOME: root,
      PATH: `${bin}${delimiter}${process.env.PATH || ""}`,
      HC_TERMINAL_ID: "t-account",
      HC_LABEL_LOG: labelLog,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${configDir}|${join(root, ".pi", "account-profiles", id)}`);
  const labels = readFileSync(labelLog, "utf8");
  assert.match(labels, new RegExp(`label t-account herdr\\.account\\.id=${id}`));
  assert.match(labels, /label t-account herdr\.account\.label=Work/);
  assert.match(labels, /label t-account herdr\.account\.kind=codex/);
  assert.match(labels, /label t-account herdr\.account\.color=#59C18C/);
  assert.match(labels, /label t-account herdr\.billing\.route=subscription/);
});
