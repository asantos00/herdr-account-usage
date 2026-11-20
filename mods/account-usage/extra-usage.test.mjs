import test from "node:test";
import assert from "node:assert/strict";
import { extraUsageWords } from "./extra-usage.mjs";

test("formats Enterprise credit spend without browser-only globals", () => {
  assert.equal(extraUsageWords({
    usedAmountMinor: 4758,
    limitAmountMinor: 20000,
    currency: "USD",
    exponent: 2,
  }), "$47.58 / $200");
  assert.equal(extraUsageWords({ usedPercent: 24, usedAmountMinor: null, limitAmountMinor: null, currency: "USD" }), "Credit usage");
});
