import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_RETENTION_MS,
  recordUsageHistory,
  usageDelta,
  usageDeltaLabel,
  usageProjection,
} from "./usage-pace.mjs";

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SESSION_MINUTES = 300;   // 5h, matches usage-helper.mjs's normalizeWindow default
const WEEKLY_MINUTES = 10_080; // 7d

function history(samples) {
  return { version: 1, samples };
}

// MARK: - recordUsageHistory

test("throttles a near-identical value within the spacing window", () => {
  const after1 = recordUsageHistory(history([]), [{ kind: "codex", window: "session", usedPercent: 50 }], T0);
  const after2 = recordUsageHistory(after1, [{ kind: "codex", window: "session", usedPercent: 50.2 }], T0 + 60_000);
  assert.equal(after2.samples.length, 1, "a 0.2pt move inside 10 minutes should not land a second sample");
});

test("keeps a genuine jump even inside the spacing window", () => {
  const after1 = recordUsageHistory(history([]), [{ kind: "codex", window: "session", usedPercent: 50 }], T0);
  const after2 = recordUsageHistory(after1, [{ kind: "codex", window: "session", usedPercent: 3 }], T0 + 60_000);
  assert.equal(after2.samples.length, 2, "a reset-sized jump must land even early, or delta/projection miss it");
});

test("prunes samples older than retention, relative to now", () => {
  const start = history([{ kind: "claude", window: "weekly", usedPercent: 10, at: T0 }]);
  const next = recordUsageHistory(start, [{ kind: "claude", window: "weekly", usedPercent: 90 }], T0 + HISTORY_RETENTION_MS + 60_000);
  assert.deepEqual(next.samples.map((s) => s.usedPercent), [90]);
});

// MARK: - usageDelta

test("usageDelta is null without a usable cycle length", () => {
  const h = recordUsageHistory(history([]), [{ kind: "codex", window: "weekly", usedPercent: 10 }], T0);
  assert.equal(usageDelta(h, "codex", "weekly", 40, NaN, T0 + HOUR), null);
});

test("usageDelta is null with no history yet", () => {
  assert.equal(usageDelta(history([]), "codex", "weekly", 40, WEEKLY_MINUTES, T0), null);
});

test("usageDelta compares against the same point one cycle ago", () => {
  const cycleMs = WEEKLY_MINUTES * 60_000;
  const h = history([
    { kind: "claude", window: "weekly", usedPercent: 30, at: T0 },
    { kind: "claude", window: "weekly", usedPercent: 55, at: T0 + cycleMs / 2 },
  ]);
  const now = T0 + cycleMs;
  assert.equal(usageDelta(h, "claude", "weekly", 42, WEEKLY_MINUTES, now), 12,
    "42 now vs 30 at the same point last week");
});

test("usageDelta is null when the nearest sample is outside tolerance", () => {
  const cycleMs = SESSION_MINUTES * 60_000;
  const h = history([{ kind: "codex", window: "session", usedPercent: 10, at: T0 }]);
  const now = T0 + cycleMs + 3 * HOUR; // well past a 5h-cycle's ~75min tolerance
  assert.equal(usageDelta(h, "codex", "session", 40, SESSION_MINUTES, now), null);
});

test("usageDelta is null across a detected reset", () => {
  const cycleMs = WEEKLY_MINUTES * 60_000;
  const h = history([
    { kind: "claude", window: "weekly", usedPercent: 95, at: T0 },
    { kind: "claude", window: "weekly", usedPercent: 2, at: T0 + cycleMs / 2 }, // a reset partway through
  ]);
  const now = T0 + cycleMs;
  assert.equal(usageDelta(h, "claude", "weekly", 20, WEEKLY_MINUTES, now), null);
});

test("usageDelta keeps different accounts and windows apart", () => {
  const h = history([
    { kind: "codex", window: "session", usedPercent: 10, at: T0 - SESSION_MINUTES * 60_000 },
    { kind: "claude", window: "session", usedPercent: 50, at: T0 - SESSION_MINUTES * 60_000 },
  ]);
  assert.equal(usageDelta(h, "codex", "session", 15, SESSION_MINUTES, T0), 5);
  assert.equal(usageDelta(h, "claude", "session", 42, SESSION_MINUTES, T0), -8);
});

// MARK: - usageProjection

test("usageProjection is null without a resetsAt", () => {
  const h = history([{ kind: "codex", window: "session", usedPercent: 10, at: T0 }]);
  assert.equal(usageProjection(h, "codex", "session", 40, undefined, SESSION_MINUTES, T0 + HOUR), null);
});

test("usageProjection is null once resetsAt has already passed", () => {
  const h = history([{ kind: "codex", window: "session", usedPercent: 10, at: T0 }]);
  assert.equal(usageProjection(h, "codex", "session", 40, T0 - 1000, SESSION_MINUTES, T0 + HOUR), null);
});

test("usageProjection is null with less than 30 minutes of same-cycle span", () => {
  const h = history([{ kind: "codex", window: "session", usedPercent: 10, at: T0 }]);
  const now = T0 + 10 * 60_000;
  assert.equal(usageProjection(h, "codex", "session", 15, now + 4 * HOUR, SESSION_MINUTES, now), null);
});

test("usageProjection warns when on track to exceed before reset", () => {
  const h = history([{ kind: "codex", window: "session", usedPercent: 10, at: T0 }]);
  const now = T0 + HOUR; // 1h in: 10 -> 50, so 40pts/hour
  const resetsAt = T0 + 5 * HOUR;
  const reading = usageProjection(h, "codex", "session", 50, resetsAt, SESSION_MINUTES, now);
  assert.equal(reading, "on track to hit the limit before reset (~1h away)",
    "50pts used at 40pts/h means ~75m to 100%, well before the 4h left on the reset");
});

test("usageProjection reports on-pace when projected near but under the limit", () => {
  const h = history([{ kind: "claude", window: "weekly", usedPercent: 10, at: T0 }]);
  const now = T0 + DAY;           // 1 day in: 10 -> 20, 10pts/day
  const resetsAt = T0 + 7 * DAY;  // 6 days left
  assert.equal(usageProjection(h, "claude", "weekly", 20, resetsAt, WEEKLY_MINUTES, now),
    "on pace to last until reset");
});

test("usageProjection reports headroom when well under pace", () => {
  const h = history([{ kind: "claude", window: "weekly", usedPercent: 5, at: T0 }]);
  const now = T0 + DAY;           // 1 day in: 5 -> 8, 3pts/day
  const resetsAt = T0 + 7 * DAY;  // 6 days left, projected ~26%
  assert.equal(usageProjection(h, "claude", "weekly", 8, resetsAt, WEEKLY_MINUTES, now),
    "plenty of room — could use ~5× more at this rate");
});

test("usageProjection reports plenty of room when flat or decreasing", () => {
  const h = history([{ kind: "codex", window: "session", usedPercent: 20, at: T0 }]);
  const now = T0 + HOUR;
  assert.equal(usageProjection(h, "codex", "session", 20, now + HOUR, SESSION_MINUTES, now),
    "plenty of room at this rate");
});

// MARK: - usageDeltaLabel

test("usageDeltaLabel renders the arrow and rounds to whole points", () => {
  assert.equal(usageDeltaLabel(7.6, "week"), "▲8pts vs last week");
  assert.equal(usageDeltaLabel(-3.2, "session"), "▼3pts vs last session");
  assert.equal(usageDeltaLabel(0.4, "week"), "flat vs last week");
});
