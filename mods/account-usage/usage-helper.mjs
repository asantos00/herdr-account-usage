import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHistory, recordUsageHistory, usageDelta, usageDeltaLabel, usageProjection } from "./usage-pace.mjs";

const TIMEOUT_MS = 10_000;
const home = homedir();
const cachePath = process.env.ACCOUNT_USAGE_CACHE || join(dirname(fileURLToPath(import.meta.url)), "cache.json");
const historyPath = process.env.ACCOUNT_USAGE_HISTORY || join(dirname(fileURLToPath(import.meta.url)), "history.json");

export function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
}

export function epochMs(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number > 1e10 ? number : number * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeWindow(raw, defaultMinutes) {
  if (!raw || typeof raw !== "object") return null;
  const usedPercent = clampPercent(raw.used_percent ?? raw.usedPercent ?? raw.utilization ?? raw.used_percentage);
  if (usedPercent === null) return null;
  const seconds = Number(raw.limit_window_seconds);
  return {
    usedPercent,
    windowMinutes: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : defaultMinutes,
    resetsAt: epochMs(raw.reset_at ?? raw.resets_at ?? raw.resetsAt),
  };
}

export function classifyWindows(windows) {
  const valid = windows.filter(Boolean);
  const minutes = (window) => Number(window.windowMinutes ?? 0);
  return {
    session: valid.find((window) => minutes(window) > 0 && minutes(window) < 1440) ?? null,
    weekly: valid.find((window) => minutes(window) >= 1440) ?? null,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function discoverAccounts() {
  const accounts = [
    { kind: "codex", configDir: process.env.CODEX_HOME || join(home, ".codex"), label: "Codex" },
    { kind: "claude", configDir: process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), label: "Claude" },
  ];
  const seen = new Set();
  return accounts.filter((account) => {
    if (account.kind !== "codex" && account.kind !== "claude") return false;
    const key = `${account.kind}:${normalize(account.configDir)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchCodex(account, fetchFn = fetch) {
  const authPath = join(account.configDir, "auth.json");
  if (!existsSync(authPath)) throw new Error("Not signed in");
  const auth = readJson(authPath), token = auth.tokens?.access_token;
  if (!token) throw new Error("Access token missing");
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "codex-cli",
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
  };
  if (auth.tokens?.account_id) headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
  const response = await fetchFn("https://chatgpt.com/backend-api/wham/usage", {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Usage request failed (HTTP ${response.status})`);
  const body = await response.json();
  const windows = classifyWindows([
    normalizeWindow(body.rate_limit?.primary_window, 300),
    normalizeWindow(body.rate_limit?.secondary_window, 10080),
  ]);
  return { ...account, plan: body.plan_type || null, ...windows };
}

function keychainService(configDir) {
  const defaultDir = join(home, ".claude");
  let candidate = normalize(configDir);
  try { candidate = realpathSync(candidate); } catch {
    let parent = candidate;
    const missing = [];
    while (!existsSync(parent) && dirname(parent) !== parent) {
      missing.unshift(parent.slice(dirname(parent).length));
      parent = dirname(parent);
    }
    try { candidate = join(realpathSync(parent), ...missing); } catch {}
  }
  if (candidate === normalize(defaultDir)) return "Claude Code-credentials";
  const digest = createHash("sha256").update(candidate.normalize("NFC")).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${digest}`;
}

function parseClaudeCredential(raw) {
  try {
    const oauth = JSON.parse(raw).claudeAiOauth;
    return typeof oauth?.accessToken === "string" ? oauth.accessToken : null;
  } catch { return null; }
}

function claudeToken(configDir) {
  if (process.platform === "darwin") {
    const username = process.env.USER || process.env.USERNAME || userInfo().username || "claude-code-user";
    try {
      const raw = execFileSync("security", ["find-generic-password", "-s", keychainService(configDir), "-a", username, "-w"], {
        encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
      });
      const token = parseClaudeCredential(raw.trim());
      if (token) return token;
    } catch {}
  }
  const path = join(configDir, ".credentials.json");
  return existsSync(path) ? parseClaudeCredential(readFileSync(path, "utf8")) : null;
}

export async function fetchClaude(account, fetchFn = fetch) {
  const token = claudeToken(account.configDir);
  if (!token) throw new Error("Not signed in");
  const response = await fetchFn("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code/2.1.0",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Usage request failed (HTTP ${response.status})`);
  const body = await response.json();
  return {
    ...account,
    session: normalizeWindow(body.five_hour, 300),
    weekly: normalizeWindow(body.seven_day, 10080),
  };
}

export async function allUsage(accounts = discoverAccounts()) {
  return Promise.all(accounts.map(async (account) => {
    try {
      return account.kind === "codex" ? await fetchCodex(account) : await fetchClaude(account);
    } catch (error) {
      return { ...account, session: null, weekly: null, error: error instanceof Error ? error.message : String(error) };
    }
  }));
}

function cacheable(account, checkedAt) {
  return {
    kind: account.kind,
    label: account.label,
    plan: account.plan || null,
    session: account.session || null,
    weekly: account.weekly || null,
    checkedAt,
  };
}

export function mergeWithCache(fresh, cached = { results: [] }, checkedAt = Date.now()) {
  const prior = new Map((cached.results || []).map((account) => [`${account.kind}:${account.label}`, account]));
  const results = fresh.map((account) => {
    const key = `${account.kind}:${account.label}`;
    if (!account.error) return cacheable(account, checkedAt);
    const previous = prior.get(key);
    return previous
      ? { ...previous, stale: true, warning: account.error }
      : { kind: account.kind, label: account.label, plan: null, session: null, weekly: null, error: account.error, checkedAt: null };
  });
  const successful = results.filter((account) => !account.error).map(({ stale, warning, ...account }) => account);
  return {
    results,
    cache: { version: 1, updatedAt: Math.max(0, ...successful.map((account) => account.checkedAt || 0)), results: successful },
  };
}

function readCache() {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8"));
    return parsed && Array.isArray(parsed.results) ? parsed : { results: [] };
  } catch { return { results: [] }; }
}

function writeCache(cache) {
  if (!cache.results.length) return;
  const temporary = `${cachePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(cache)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, cachePath);
}

function readHistory() {
  try { return normalizeHistory(JSON.parse(readFileSync(historyPath, "utf8"))); } catch { return normalizeHistory(null); }
}

function writeHistory(history) {
  const temporary = `${historyPath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(history)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, historyPath);
}

// Only a genuinely fresh (this round) reading is worth recording: a stale
// fallback or a hard failure carries no new information, and recording it
// at "now" would fabricate a flat stretch the app never actually observed.
function freshSamples(results) {
  const samples = [];
  for (const account of results) {
    if (account.error || account.stale) continue;
    if (account.session) samples.push({ kind: account.kind, window: "session", usedPercent: account.session.usedPercent });
    if (account.weekly) samples.push({ kind: account.kind, window: "weekly", usedPercent: account.weekly.usedPercent });
  }
  return samples;
}

// Derived, point-in-time readings — never cached (they'd go stale the
// instant usage moves) and never mutate the window objects `merged.cache`
// shares by reference, so `cache.json` stays exactly what it was.
function withPace(account, history, now) {
  const annotate = (window, windowKind, label) => {
    if (!window) return window;
    const delta = usageDelta(history, account.kind, windowKind, window.usedPercent, window.windowMinutes, now);
    const pace = usageProjection(history, account.kind, windowKind, window.usedPercent, window.resetsAt, window.windowMinutes, now);
    return {
      ...window,
      delta,
      deltaLabel: delta == null ? null : usageDeltaLabel(delta, label),
      pace,
    };
  };
  return { ...account, session: annotate(account.session, "session", "session"), weekly: annotate(account.weekly, "weekly", "week") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkedAt = Date.now();
  const merged = mergeWithCache(await allUsage(), readCache(), checkedAt);
  writeCache(merged.cache);
  const history = recordUsageHistory(readHistory(), freshSamples(merged.results), checkedAt);
  writeHistory(history);
  const results = merged.results.map((account) => withPace(account, history, checkedAt));
  process.stdout.write(JSON.stringify({ updatedAt: merged.cache.updatedAt || checkedAt, results }));
}
