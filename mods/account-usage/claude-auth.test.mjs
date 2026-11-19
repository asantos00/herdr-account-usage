import test from "node:test";
import assert from "node:assert/strict";
import { inspectAuthMode, serializeSettings, subscriptionCapacityAvailable, switchAuthMode } from "./claude-auth.mjs";

const parkedFixture = () => ({
  env: {
    ENABLE_TOOL_SEARCH: "true",
    _ANTHROPIC_BASE_URL: "https://fake.invalid",
    _ANTHROPIC_AUTH_TOKEN: "fake-redacted-token",
  },
  hooks: { SessionStart: [{ hooks: [{ type: "command", command: "fake-command" }] }] },
  theme: "dark",
});

test("detects subscription mode from the parked underscore-prefixed pair", () => {
  const inspection = inspectAuthMode(parkedFixture());
  assert.equal(inspection.mode, "subscription");
  assert.deepEqual(inspection.fields.map(({ parkedPresent, activePresent }) => ({ parkedPresent, activePresent })), [
    { parkedPresent: true, activePresent: false },
    { parkedPresent: true, activePresent: false },
  ]);
  assert.equal(JSON.stringify(inspection).includes("fake-redacted-token"), false);
});

test("switches to API mode while preserving unrelated JSON semantics", () => {
  const original = parkedFixture();
  const unrelated = { hooks: original.hooks, theme: original.theme, toolSearch: original.env.ENABLE_TOOL_SEARCH };
  const result = switchAuthMode(original, "api");

  assert.equal(result.changed, true);
  assert.equal(result.inspection.mode, "api");
  assert.equal(result.settings.env.ANTHROPIC_AUTH_TOKEN, "fake-redacted-token");
  assert.equal(result.settings.env.ANTHROPIC_BASE_URL, "https://fake.invalid");
  assert.equal("_ANTHROPIC_AUTH_TOKEN" in result.settings.env, false);
  assert.equal("_ANTHROPIC_BASE_URL" in result.settings.env, false);
  assert.deepEqual(
    { hooks: result.settings.hooks, theme: result.settings.theme, toolSearch: result.settings.env.ENABLE_TOOL_SEARCH },
    unrelated,
  );
  assert.equal("ANTHROPIC_AUTH_TOKEN" in original.env, false, "input is not mutated");
});

test("round-trips from API mode back to subscription mode", () => {
  const api = switchAuthMode(parkedFixture(), "api").settings;
  const result = switchAuthMode(api, "subscription");
  assert.equal(result.inspection.mode, "subscription");
  assert.equal(result.settings.env._ANTHROPIC_AUTH_TOKEN, "fake-redacted-token");
  assert.equal(result.settings.env._ANTHROPIC_BASE_URL, "https://fake.invalid");
});

test("does not rewrite when the requested mode is already active", () => {
  const original = parkedFixture();
  const result = switchAuthMode(original, "subscription");
  assert.equal(result.changed, false);
  assert.equal(result.settings, original);
});

test("refuses conflicts instead of overwriting either credential field", () => {
  const conflicted = parkedFixture();
  conflicted.env.ANTHROPIC_AUTH_TOKEN = "different-fake-redacted-token";
  assert.equal(inspectAuthMode(conflicted).mode, "conflict");
  assert.throws(() => switchAuthMode(conflicted, "api"), /no automatic switch is safe/i);
});

test("refuses an incomplete field pair", () => {
  const incomplete = parkedFixture();
  delete incomplete.env._ANTHROPIC_BASE_URL;
  assert.equal(inspectAuthMode(incomplete).mode, "incomplete");
  assert.throws(() => switchAuthMode(incomplete, "api"), /incomplete/i);
});

test("serialization preserves the source newline convention", () => {
  assert.equal(serializeSettings({ env: {} }, "{}\n").endsWith("\n"), true);
  assert.equal(serializeSettings({ env: {} }, "{}").endsWith("\n"), false);
});

test("marks renewed subscription capacity only while API billing is active", () => {
  assert.equal(subscriptionCapacityAvailable("api", { session: { usedPercent: 42 } }), true);
  assert.equal(subscriptionCapacityAvailable("api", { session: { usedPercent: 100 } }), false);
  assert.equal(subscriptionCapacityAvailable("subscription", { session: { usedPercent: 42 } }), false);
  assert.equal(subscriptionCapacityAvailable("api", { session: null }), false);
});
