import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareCodexPiProfile } from "./codex-pi-profile.mjs";

function token(exp = 2_000_000_000) {
  return `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "codex-pi-profile-"));
  const baseAgentDir = join(home, ".pi", "agent");
  const configDir = join(home, ".codex-company");
  mkdirSync(join(baseAgentDir, "skills"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(baseAgentDir, "settings.json"), "{}\n");
  writeFileSync(join(baseAgentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "shared" } }));
  writeFileSync(join(configDir, "auth.json"), JSON.stringify({ tokens: {
    access_token: token(), refresh_token: "codex-refresh", account_id: "company-account",
  } }));
  return { home, baseAgentDir, configDir };
}

test("creates a Pi profile that shares resources but uses the selected Codex subscription", () => {
  const value = fixture();
  try {
    const target = prepareCodexPiProfile({ id: "codex-company", kind: "codex", configDir: value.configDir }, value);
    assert.equal(realpathSync(join(target, "settings.json")), realpathSync(join(value.baseAgentDir, "settings.json")));
    assert.equal(realpathSync(join(target, "skills")), realpathSync(join(value.baseAgentDir, "skills")));
    const auth = JSON.parse(readFileSync(join(target, "auth.json"), "utf8"));
    assert.equal(auth.anthropic.key, "shared");
    assert.deepEqual(auth["openai-codex"], {
      type: "oauth", access: token(), refresh: "codex-refresh", expires: 2_000_000_000_000, accountId: "company-account",
    });
  } finally {
    rmSync(value.home, { recursive: true, force: true });
  }
});

test("keeps a matching Pi credential after Pi refreshes it", () => {
  const value = fixture();
  try {
    const profile = { id: "codex-company", kind: "codex", configDir: value.configDir };
    const target = prepareCodexPiProfile(profile, value);
    const authPath = join(target, "auth.json");
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    auth["openai-codex"] = { type: "oauth", access: "new-access", refresh: "new-refresh", expires: 9_999_999_999_999, accountId: "company-account" };
    writeFileSync(authPath, JSON.stringify(auth));
    prepareCodexPiProfile(profile, value);
    assert.equal(JSON.parse(readFileSync(authPath, "utf8"))["openai-codex"].access, "new-access");
  } finally {
    rmSync(value.home, { recursive: true, force: true });
  }
});
