import test from "node:test";
import assert from "node:assert/strict";
import { accountStyle } from "./account-style.mjs";

test("reads account appearance from terminal labels", () => {
  assert.deepEqual(accountStyle({
    "herdr.account.id": "claude-ttc",
    "herdr.account.label": "Claude TTC",
    "herdr.account.kind": "claude",
    "herdr.account.color": "#A78BFA",
  }), { id: "claude-ttc", label: "Claude TTC", kind: "claude", color: "#A78BFA" });
});

test("ignores unlabelled terminals and unsafe color values", () => {
  assert.equal(accountStyle({}), null);
  assert.equal(accountStyle({ "herdr.account.id": "x", "herdr.account.color": "red" }), null);
});
