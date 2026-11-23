import test from "node:test";
import assert from "node:assert/strict";
import { sessionRoute } from "./session-route.mjs";

test("reads the immutable billing route written for a session", () => {
  assert.deepEqual(sessionRoute({ "herdr.billing.route": "subscription" }), { id: "subscription", label: "Subscription" });
  assert.deepEqual(sessionRoute({ "herdr.billing.route": "api" }), { id: "api", label: "API" });
});

test("ignores absent or untrusted route labels", () => {
  assert.equal(sessionRoute({}), null);
  assert.equal(sessionRoute({ "herdr.billing.route": "free money" }), null);
});
