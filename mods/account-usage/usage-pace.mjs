// Pure history/delta/pace math for the usage mod, kept free of fetch, exec
// and file I/O so it's unit-testable without touching the network or disk —
// mirrors usage-helper.mjs's own split (helper does I/O, this does math).
//
// The provider snapshot (usage-helper.mjs) only ever answers "how much is
// used right now." It can't say whether that's normal for this point in the
// cycle, or whether the current pace will blow through the limit before
// reset — both need samples over time, which is what `history.json`
// (recorded here, persisted by usage-helper.mjs) is for.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Below this age, a new sample is dropped as a duplicate of the last one for
// the same (kind, window) — the helper runs every 5 minutes, which would
// otherwise write near-identical points for a number that mostly doesn't move.
export const MIN_SAMPLE_SPACING_MS = 10 * MINUTE_MS;
// Samples older than this (relative to `now`, not to the sample's own time)
// are dropped on every record. Covers the 7-day weekly lookback plus slack.
export const HISTORY_RETENTION_MS = 9 * DAY_MS;
// A drop of this many points between consecutive samples counts as the
// window resetting, not ordinary fluctuation.
const RESET_DROP_THRESHOLD = 20;

function emptyHistory() {
  return { version: 1, samples: [] };
}

export function normalizeHistory(raw) {
  return raw && Array.isArray(raw.samples) ? raw : emptyHistory();
}

/**
 * Record this round's fresh (non-stale, non-error) samples into `history`,
 * then prune anything past retention. `samples` is a flat list of
 * `{kind, window, usedPercent}` — callers skip any account/window that came
 * from a stale cache fallback or a failed fetch, since recording an old
 * value at "now" would fabricate a flat stretch the app never actually saw.
 */
export function recordUsageHistory(history, samples, now = Date.now()) {
  const base = normalizeHistory(history);
  const next = base.samples.slice();
  for (const { kind, window, usedPercent } of samples) {
    if (!kind || !window || !Number.isFinite(usedPercent)) continue;
    const lastIndex = findLastIndex(next, (s) => s.kind === kind && s.window === window);
    if (lastIndex !== -1) {
      const last = next[lastIndex];
      const age = now - last.at;
      const jumped = Math.abs(usedPercent - last.usedPercent) >= 1;
      if (age < MIN_SAMPLE_SPACING_MS && !jumped) continue;
    }
    next.push({ kind, window, usedPercent, at: now });
  }
  const cutoff = now - HISTORY_RETENTION_MS;
  return { version: 1, samples: next.filter((s) => s.at >= cutoff) };
}

function findLastIndex(array, predicate) {
  for (let i = array.length - 1; i >= 0; i -= 1) if (predicate(array[i])) return i;
  return -1;
}

function samplesFor(history, kind, window) {
  return normalizeHistory(history)
    .samples.filter((s) => s.kind === kind && s.window === window)
    .sort((a, b) => a.at - b.at);
}

/**
 * The index of the sample where the CURRENT cycle began: the one right
 * after the most recent reset-sized drop, or the very first sample when no
 * such drop is in the retained history (the cycle started before recording
 * did). `null` only when `samples` is empty.
 */
function currentCycleStart(samples) {
  if (samples.length === 0) return null;
  for (let i = samples.length - 1; i >= 1; i -= 1) {
    if (samples[i - 1].usedPercent - samples[i].usedPercent > RESET_DROP_THRESHOLD) return samples[i];
  }
  return samples[0];
}

/**
 * Points used now vs. the same point one cycle ago. `null` whenever that
 * comparison would be misleading rather than merely unflattering: no cycle
 * length, no sample old enough yet (first cycle since history started), the
 * nearest one is too far from the exact one-cycle-ago instant to trust, or a
 * reset happened somewhere between that sample and now (so "last period"
 * and "now" aren't the same kind of measurement).
 */
export function usageDelta(history, kind, window, currentPercent, cycleMinutes, now = Date.now()) {
  if (!Number.isFinite(currentPercent) || !Number.isFinite(cycleMinutes) || cycleMinutes <= 0) return null;
  const samples = samplesFor(history, kind, window);
  if (samples.length === 0) return null;

  const cycleMs = cycleMinutes * MINUTE_MS;
  const target = now - cycleMs;
  const nearest = samples.reduce((best, s) =>
    Math.abs(s.at - target) < Math.abs(best.at - target) ? s : best);
  const tolerance = Math.min(cycleMs * 0.25, 12 * 60 * MINUTE_MS);
  if (Math.abs(nearest.at - target) > tolerance) return null;

  const between = samples.filter((s) => s.at >= nearest.at && s.at <= now);
  for (let i = 1; i < between.length; i += 1) {
    if (between[i - 1].usedPercent - between[i].usedPercent > RESET_DROP_THRESHOLD) return null;
  }
  const last = between[between.length - 1];
  if (last && last.usedPercent - currentPercent > RESET_DROP_THRESHOLD) return null;

  return currentPercent - nearest.usedPercent;
}

function formatDuration(ms) {
  const minutes = ms / MINUTE_MS;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  return `${Math.max(1, Math.round(minutes / 60))}h`;
}

/**
 * A one-line read on whether the current burn rate will last until the
 * window resets, or leaves room to spend more. `null` when there isn't
 * enough same-cycle history to trust a rate (under 30 minutes of span), or
 * there's no `resetsAt` to project against — never a guess dressed up as a
 * reading.
 */
export function usageProjection(history, kind, window, currentPercent, resetsAt, cycleMinutes, now = Date.now()) {
  if (!Number.isFinite(currentPercent) || !Number.isFinite(resetsAt) || resetsAt <= now) return null;
  const samples = samplesFor(history, kind, window);
  const start = currentCycleStart(samples);
  if (!start) return null;
  const spanMs = now - start.at;
  if (spanMs < 30 * MINUTE_MS) return null;

  const rate = (currentPercent - start.usedPercent) / spanMs; // points per ms
  const remainingMs = Math.max(resetsAt - now, 0);
  if (rate <= 0) return "plenty of room at this rate";

  const projected = currentPercent + rate * remainingMs;
  if (projected >= 100) {
    const msToLimit = (100 - currentPercent) / rate;
    if (msToLimit > 0 && msToLimit < remainingMs) {
      return `on track to hit the limit before reset (~${formatDuration(msToLimit)} away)`;
    }
    return "on track to hit the limit before reset";
  }
  if (projected >= 80) return "on pace to last until reset";
  const multiple = Math.max((100 - currentPercent) / Math.max(projected - currentPercent, 0.001), 1);
  return `plenty of room — could use ~${Math.round(multiple)}× more at this rate`;
}

/** "▲Npts vs last week" / "▼Npts vs last session" — the arrow carries the
 * direction, since the bar itself already spends green/amber/red on headroom. */
export function usageDeltaLabel(delta, windowLabel) {
  const rounded = Math.round(delta);
  if (rounded === 0) return `flat vs last ${windowLabel}`;
  const arrow = rounded > 0 ? "▲" : "▼";
  return `${arrow}${Math.abs(rounded)}pts vs last ${windowLabel}`;
}
