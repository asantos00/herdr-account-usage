function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

export function mostUrgentUsage(accounts = []) {
  let best = null;
  for (const account of accounts) {
    for (const window of ["session", "weekly"]) {
      const usage = account?.[window];
      const used = percent(usage?.usedPercent);
      if (used == null) continue;
      const candidate = {
        percent: used,
        window,
        windowMinutes: Number.isFinite(Number(usage?.windowMinutes)) ? Number(usage.windowMinutes) : null,
        accountId: account?.id || null,
      };
      if (!best || candidate.percent > best.percent) best = candidate;
    }
  }
  return best;
}

function windowLabel(summary) {
  if (!summary) return "";
  if (summary.window === "weekly") return "W";
  const minutes = summary.windowMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return "S";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.round(minutes / 60)}h`;
}

export function compactUsageLabel(kind, accountCount, summary) {
  const provider = kind === "codex" ? "Cx" : "Cl";
  const count = accountCount > 1 ? String(accountCount) : "";
  const window = windowLabel(summary);
  return `${provider}${count}${window ? `·${window}` : ""}`;
}
