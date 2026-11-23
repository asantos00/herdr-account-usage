import test from "node:test";
import assert from "node:assert/strict";
import { billingRoute } from "./billing-route.mjs";

test("Codex Pi sessions use the subscription route", () => {
  assert.equal(billingRoute({ kind: "codex", configDir: "/unused" }), "subscription");
});

test("Claude sessions capture the route active when they launch", () => {
  const subscription = { env: { _ANTHROPIC_BASE_URL: "https://proxy", _ANTHROPIC_AUTH_TOKEN: "token" } };
  const api = { env: { ANTHROPIC_BASE_URL: "https://proxy", ANTHROPIC_AUTH_TOKEN: "token" } };
  const fs = (value) => ({ readFileSync: () => JSON.stringify(value) });
  assert.equal(billingRoute({ kind: "claude", configDir: "/claude" }, { fs: fs(subscription) }), "subscription");
  assert.equal(billingRoute({ kind: "claude", configDir: "/claude" }, { fs: fs(api) }), "api");
});

test("unknown or unreadable sessions do not claim a billing route", () => {
  assert.equal(billingRoute({ kind: "shell" }), null);
  assert.equal(billingRoute({ kind: "claude", configDir: "/missing" }, { fs: { readFileSync: () => { throw new Error("missing"); } } }), null);
});
