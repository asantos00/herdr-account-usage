import test from "node:test";
import assert from "node:assert/strict";
import { compactUsageLabel, mostUrgentUsage } from "./usage-summary.mjs";

test("uses the short session when it is closer to exhaustion than weekly usage", () => {
  assert.deepEqual(mostUrgentUsage([{
    id: "claude-one",
    session: { usedPercent: 92, windowMinutes: 300 },
    weekly: { usedPercent: 31, windowMinutes: 10080 },
  }]), {
    percent: 92,
    window: "session",
    windowMinutes: 300,
    accountId: "claude-one",
  });
});

test("uses weekly usage when it is the more exhausted window", () => {
  assert.deepEqual(mostUrgentUsage([{
    id: "codex-one",
    session: { usedPercent: 15, windowMinutes: 300 },
    weekly: { usedPercent: 78, windowMinutes: 10080 },
  }]), {
    percent: 78,
    window: "weekly",
    windowMinutes: 10080,
    accountId: "codex-one",
  });
});

test("compares every window across multiple accounts", () => {
  const summary = mostUrgentUsage([
    { id: "one", session: { usedPercent: 60 }, weekly: { usedPercent: 40 } },
    { id: "two", session: { usedPercent: 25 }, weekly: { usedPercent: 96 } },
  ]);
  assert.equal(summary.percent, 96);
  assert.equal(summary.window, "weekly");
  assert.equal(summary.accountId, "two");
});

test("includes Enterprise extra-credit usage in the urgent summary", () => {
  assert.deepEqual(mostUrgentUsage([{
    id: "claude-enterprise",
    session: null,
    weekly: null,
    extra: { usedPercent: 81 },
  }]), {
    percent: 81,
    window: "extra",
    windowMinutes: null,
    accountId: "claude-enterprise",
  });
});

test("a tie favors the shorter session because it resets sooner", () => {
  assert.equal(mostUrgentUsage([{
    session: { usedPercent: 100 },
    weekly: { usedPercent: 100 },
  }]).window, "session");
});

test("compact labels identify provider, account count, and winning window", () => {
  assert.equal(compactUsageLabel("claude", 1, { window: "session", windowMinutes: 300 }), "Cl·5h");
  assert.equal(compactUsageLabel("codex", 2, { window: "weekly", windowMinutes: 10080 }), "Cx2·W");
  assert.equal(compactUsageLabel("claude", 1, { window: "extra" }), "Cl·$");
  assert.equal(compactUsageLabel("claude", 1, null), "Cl");
});
