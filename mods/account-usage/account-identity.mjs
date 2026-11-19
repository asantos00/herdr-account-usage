import * as nodeFs from "node:fs";
import { join } from "node:path";

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readJson(path, fs) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function jwtClaims(token) {
  try {
    const payload = String(token).split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

function codexIdentity(account, fs) {
  try {
    const auth = readJson(join(account.configDir, "auth.json"), fs);
    const claims = jwtClaims(auth.tokens?.id_token);
    const profile = claims?.["https://api.openai.com/profile"];
    return {
      email: text(claims?.email) || text(profile?.email),
      name: text(claims?.name) || text(profile?.name),
      organization: text(profile?.organization_name) || text(profile?.organization),
    };
  } catch {
    return { email: null, name: null, organization: null };
  }
}

function claudeAccountFrom(path, fs) {
  try {
    const oauth = readJson(path, fs).oauthAccount;
    if (!oauth || typeof oauth !== "object") return null;
    return {
      email: text(oauth.emailAddress) || text(oauth.email),
      name: text(oauth.displayName) || text(oauth.fullName),
      organization: text(oauth.organizationName),
    };
  } catch {
    return null;
  }
}

function claudeIdentity(account, fs) {
  const current = claudeAccountFrom(join(account.configDir, ".claude.json"), fs);
  if (current?.email) return current;
  const backups = join(account.configDir, "backups");
  try {
    const names = fs.readdirSync(backups)
      .filter((name) => name.startsWith(".claude.json.backup."))
      .sort()
      .reverse();
    for (const name of names) {
      const identity = claudeAccountFrom(join(backups, name), fs);
      if (identity?.email) return identity;
    }
  } catch {}
  return current || { email: null, name: null, organization: null };
}

export function identityForAccount(account, fs = nodeFs) {
  const discovered = account.kind === "codex"
    ? codexIdentity(account, fs)
    : account.kind === "claude"
      ? claudeIdentity(account, fs)
      : { email: null, name: null, organization: null };
  return {
    email: text(account.email) || discovered.email,
    name: discovered.name,
    organization: discovered.organization,
  };
}
