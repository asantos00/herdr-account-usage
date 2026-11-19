import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS = Object.freeze({
  codex: Object.freeze({ prefix: ".codex", env: "CODEX_HOME", command: ["codex"] }),
  claude: Object.freeze({ prefix: ".claude", env: "CLAUDE_CONFIG_DIR", command: ["claude"] }),
});

export const DEFAULT_PROFILES_PATH = join(dirname(fileURLToPath(import.meta.url)), "accounts.json");

function expandHome(path, home) {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

function defaultLabel(kind, directoryName) {
  const provider = kind === "codex" ? "Codex" : "Claude";
  const suffix = directoryName.slice(PROVIDERS[kind].prefix.length).replace(/^-+/, "").replace(/[-_]+/g, " ").trim();
  const displaySuffix = suffix.split(" ").filter(Boolean).map((word) =>
    /^\d+$/.test(word) ? word : word.length <= 3 ? word.toUpperCase() : `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
  return displaySuffix ? `${provider} ${displaySuffix}` : provider;
}

export function profileId(kind, configDir) {
  const digest = createHash("sha256").update(`${kind}:${normalize(configDir)}`).digest("hex").slice(0, 12);
  return `${kind}-${digest}`;
}

function normalizeProfile(raw, home) {
  if (!raw || !Object.hasOwn(PROVIDERS, raw.kind)) throw new Error("Account kind must be claude or codex.");
  if (typeof raw.configDir !== "string" || !raw.configDir.trim()) throw new Error("Account configDir must be a non-empty path.");
  const configDir = normalize(expandHome(raw.configDir.trim(), home));
  const label = typeof raw.label === "string" && raw.label.trim()
    ? raw.label.trim()
    : defaultLabel(raw.kind, configDir.split("/").at(-1) || raw.kind);
  const email = typeof raw.email === "string" && raw.email.trim() ? raw.email.trim() : null;
  return { id: profileId(raw.kind, configDir), kind: raw.kind, label, configDir, ...(email ? { email } : {}) };
}

function configuredProfiles({ home, fs, profilesPath }) {
  if (!fs.existsSync(profilesPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
  if (!parsed || !Array.isArray(parsed.accounts)) throw new Error("accounts.json must contain an accounts array.");
  return parsed.accounts.map((account) => normalizeProfile(account, home));
}

function discoveredProfiles({ home, env, fs }) {
  const profiles = [];
  for (const kind of ["codex", "claude"]) {
    const provider = PROVIDERS[kind];
    const current = env[provider.env] ? normalize(expandHome(env[provider.env], home)) : join(home, provider.prefix);
    const candidates = new Set([current]);
    try {
      for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
        if (entry.isDirectory() && (entry.name === provider.prefix || entry.name.startsWith(`${provider.prefix}-`))) {
          candidates.add(join(home, entry.name));
        }
      }
    } catch {}
    for (const configDir of [...candidates].sort()) {
      if (!fs.existsSync(configDir)) continue;
      profiles.push(normalizeProfile({ kind, configDir }, home));
    }
  }
  return profiles;
}

export function discoverAccountProfiles({
  home = homedir(),
  env = process.env,
  fs = nodeFs,
  profilesPath = env.ACCOUNT_USAGE_PROFILES || DEFAULT_PROFILES_PATH,
} = {}) {
  const profiles = configuredProfiles({ home, fs, profilesPath }) ?? discoveredProfiles({ home, env, fs });
  const seen = new Set();
  return profiles.filter((profile) => {
    const key = `${profile.kind}:${normalize(profile.configDir)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveProfile(profiles, id) {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`Unknown account profile: ${id}`);
  return profile;
}

export function launchArgv(profile) {
  const provider = PROVIDERS[profile.kind];
  if (!provider) throw new Error(`Unsupported account kind: ${profile.kind}`);
  return ["env", `${provider.env}=${profile.configDir}`, ...provider.command];
}
