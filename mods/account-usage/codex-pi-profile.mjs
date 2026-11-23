import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROVIDER = "openai-codex";
const PRIVATE_ENTRIES = new Set(["auth.json", "auth-backups", "sessions"]);

function readJson(fs, path) {
  try {
    const value = JSON.parse(fs.readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function jwtExpiry(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number.isFinite(Number(parsed.exp)) ? Number(parsed.exp) * 1000 : 0;
  } catch {
    return 0;
  }
}

function importedCredential(codexAuth) {
  const tokens = codexAuth?.tokens;
  const access = tokens?.access_token;
  const refresh = tokens?.refresh_token;
  const accountId = tokens?.account_id;
  if (typeof access !== "string" || !access || typeof refresh !== "string" || !refresh || typeof accountId !== "string" || !accountId) {
    throw new Error("The selected Codex profile does not contain reusable subscription credentials.");
  }
  return { type: "oauth", access, refresh, expires: jwtExpiry(access), accountId };
}

function atomicJson(fs, path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, path);
  fs.chmodSync(path, 0o600);
}

export function prepareCodexPiProfile(profile, {
  home = homedir(),
  fs = nodeFs,
  baseAgentDir = join(home, ".pi", "agent"),
  profilesRoot = join(home, ".pi", "account-profiles"),
} = {}) {
  if (profile?.kind !== "codex" || !profile.id || !profile.configDir) throw new Error("A complete Codex profile is required.");

  const target = join(profilesRoot, profile.id);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  fs.mkdirSync(join(target, "auth-backups"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(join(target, "sessions"), { recursive: true, mode: 0o700 });

  for (const entry of fs.readdirSync(baseAgentDir, { withFileTypes: true })) {
    if (PRIVATE_ENTRIES.has(entry.name)) continue;
    const destination = join(target, entry.name);
    if (!fs.existsSync(destination)) fs.symlinkSync(join(baseAgentDir, entry.name), destination, entry.isDirectory() ? "dir" : "file");
  }

  const sourceCredential = importedCredential(readJson(fs, join(profile.configDir, "auth.json")));
  const targetAuthPath = join(target, "auth.json");
  const existing = readJson(fs, targetAuthPath);
  const current = existing[PROVIDER];
  const selected = current?.type === "oauth" && current.accountId === sourceCredential.accountId ? current : sourceCredential;
  const shared = readJson(fs, join(baseAgentDir, "auth.json"));
  atomicJson(fs, targetAuthPath, { ...shared, ...existing, [PROVIDER]: selected });
  return target;
}
