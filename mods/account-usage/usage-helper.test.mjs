import test from "node:test";
import assert from "node:assert/strict";
import { clampPercent, classifyWindows, discoverAccounts, epochMs, mergeWithCache } from "./usage-helper.mjs";

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

test("discovers only current Codex and Claude CLI accounts", () => {
  assert.deepEqual(discoverAccounts().map(({ kind, label }) => ({ kind, label })), [
    { kind: "codex", label: "Codex" },
    { kind: "claude", label: "Claude" },
  ]);
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
    kind: "codex", label: "Codex", plan: "pro", session: null,
    weekly: { usedPercent: 17 }, checkedAt: 300,
  });
});
