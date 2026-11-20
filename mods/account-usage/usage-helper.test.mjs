import test from "node:test";
import assert from "node:assert/strict";
import { clampPercent, classifyWindows, claudeExtraUsage, claudeUsage, epochMs, mergeWithCache } from "./usage-helper.mjs";

test("clamps percentages", () => {
  assert.equal(clampPercent(-2), 0);
  assert.equal(clampPercent(42.5), 42.5);
  assert.equal(clampPercent(120), 100);
});

test("normalizes reset timestamps", () => {
  assert.equal(epochMs(2_000_000_000), 2_000_000_000_000);
  assert.equal(epochMs("2033-05-18T03:33:20Z"), 2_000_000_000_000);
});

test("keeps session and weekly windows distinct", () => {
  const session = { usedPercent: 10, windowMinutes: 300 };
  const weekly = { usedPercent: 20, windowMinutes: 10080 };
  assert.deepEqual(classifyWindows([weekly, session]), { session, weekly });
  assert.deepEqual(classifyWindows([weekly]), { session: null, weekly });
});

test("normalizes Claude Enterprise extra-credit usage", () => {
  assert.deepEqual(claudeExtraUsage({
    extra_usage: { is_enabled: true, utilization: 20.885, currency: "USD", decimal_places: 2 },
    spend: {
      percent: 21,
      used: { amount_minor: 4177, currency: "USD", exponent: 2 },
      limit: { amount_minor: 20000, currency: "USD", exponent: 2 },
    },
  }), {
    usedPercent: 21,
    usedAmountMinor: 4177,
    limitAmountMinor: 20000,
    currency: "USD",
    exponent: 2,
  });
  assert.equal(claudeExtraUsage({ extra_usage: { is_enabled: false, utilization: 0 } }), null);
});

test("uses extra-credit usage only when plan windows are unavailable", () => {
  const extra = { extra_usage: { is_enabled: true, utilization: 24 } };
  assert.equal(claudeUsage(extra).extra.usedPercent, 24);
  assert.equal(claudeUsage({ ...extra, five_hour: { utilization: 10 } }).extra, null);
});

test("keeps the last successful usage when a provider check fails", () => {
  const previous = {
    results: [{ kind: "claude", label: "Claude", plan: null, session: { usedPercent: 64 }, weekly: { usedPercent: 31 }, checkedAt: 100 }],
  };
  const merged = mergeWithCache([{ kind: "claude", label: "Claude", error: "HTTP 429" }], previous, 200);
  assert.equal(merged.results[0].session.usedPercent, 64);
  assert.equal(merged.results[0].checkedAt, 100);
  assert.equal(merged.results[0].stale, true);
  assert.equal(merged.results[0].warning, "HTTP 429");
  assert.equal(merged.cache.results[0].checkedAt, 100);
});

test("cache excludes credential locations and transient errors", () => {
  const merged = mergeWithCache([{
    kind: "codex", label: "Codex", configDir: "/secret/location", plan: "pro",
    session: null, weekly: { usedPercent: 17 },
  }], { results: [] }, 300);
  assert.deepEqual(merged.cache.results[0], {
    kind: "codex", label: "Codex", email: null, name: null, organization: null,
    plan: "pro", session: null, weekly: { usedPercent: 17 }, extra: null, checkedAt: 300,
  });
});

test("cache exposes the safe account display color", () => {
  const merged = mergeWithCache([{
    id: "claude-one", kind: "claude", label: "Claude", color: "#F59E75",
    session: null, weekly: { usedPercent: 17 },
  }], { results: [] }, 300);
  assert.equal(merged.cache.results[0].color, "#F59E75");
});

test("cache keeps same-provider profiles separate by stable id", () => {
  const previous = {
    results: [
      { id: "codex-one", kind: "codex", label: "Codex", plan: "pro", session: null, weekly: { usedPercent: 10 }, checkedAt: 100 },
      { id: "codex-two", kind: "codex", label: "Codex", plan: "team", session: null, weekly: { usedPercent: 60 }, checkedAt: 100 },
    ],
  };
  const merged = mergeWithCache([
    { id: "codex-one", kind: "codex", label: "Codex", error: "offline" },
    { id: "codex-two", kind: "codex", label: "Codex", error: "offline" },
  ], previous, 200);
  assert.deepEqual(merged.results.map((account) => account.weekly.usedPercent), [10, 60]);
});

test("a failed usage refresh still keeps the current Claude billing mode", () => {
  const previous = {
    results: [{ id: "claude-one", kind: "claude", label: "Claude", authMode: "api", plan: null, session: null, weekly: { usedPercent: 30 }, extra: { usedPercent: 100 }, checkedAt: 100 }],
  };
  const merged = mergeWithCache([
    { id: "claude-one", kind: "claude", label: "Claude", authMode: "subscription", error: "offline" },
  ], previous, 200);
  assert.equal(merged.results[0].authMode, "subscription");
  assert.equal(merged.results[0].extra, null);
});
