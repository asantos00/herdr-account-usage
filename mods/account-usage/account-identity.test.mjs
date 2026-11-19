import test from "node:test";
import assert from "node:assert/strict";
import { identityForAccount } from "./account-identity.mjs";

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function fakeFs(files) {
  return {
    existsSync(path) { return Object.hasOwn(files, path) || Object.keys(files).some((candidate) => candidate.startsWith(`${path}/`)); },
    readFileSync(path) {
      if (!Object.hasOwn(files, path)) throw new Error("missing");
      return files[path];
    },
    readdirSync(path) {
      const prefix = `${path}/`;
      return Object.keys(files).filter((candidate) => candidate.startsWith(prefix)).map((candidate) => candidate.slice(prefix.length));
    },
  };
}

test("reads Codex email and name from the local id token", () => {
  const configDir = "/profiles/codex";
  const fs = fakeFs({
    [`${configDir}/auth.json`]: JSON.stringify({ tokens: { id_token: jwt({ email: "codex@example.com", name: "Codex User" }) } }),
  });
  assert.deepEqual(identityForAccount({ kind: "codex", configDir }, fs), {
    email: "codex@example.com",
    name: "Codex User",
    organization: null,
  });
});

test("reads Claude identity from the newest backup that contains an OAuth account", () => {
  const configDir = "/profiles/claude";
  const fs = fakeFs({
    [`${configDir}/backups/.claude.json.backup.100`]: JSON.stringify({ oauthAccount: { emailAddress: "old@example.com" } }),
    [`${configDir}/backups/.claude.json.backup.200`]: JSON.stringify({ firstStartTime: 200 }),
    [`${configDir}/backups/.claude.json.backup.150`]: JSON.stringify({ oauthAccount: { emailAddress: "claude@example.com", displayName: "Claude User", organizationName: "Example Team" } }),
  });
  assert.deepEqual(identityForAccount({ kind: "claude", configDir }, fs), {
    email: "claude@example.com",
    name: "Claude User",
    organization: "Example Team",
  });
});

test("an explicit account email overrides provider metadata", () => {
  assert.deepEqual(identityForAccount({ kind: "claude", configDir: "/missing", email: "label@example.com" }, fakeFs({})), {
    email: "label@example.com",
    name: null,
    organization: null,
  });
});

test("returns empty identity without exposing credential contents", () => {
  assert.deepEqual(identityForAccount({ kind: "codex", configDir: "/missing" }, fakeFs({})), {
    email: null,
    name: null,
    organization: null,
  });
});
