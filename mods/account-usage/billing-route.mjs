import * as nodeFs from "node:fs";
import { join } from "node:path";
import { inspectAuthMode } from "./claude-auth.mjs";

export function billingRoute(profile, { fs = nodeFs } = {}) {
  if (profile?.kind === "codex") return "subscription";
  if (profile?.kind !== "claude" || !profile.configDir) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(join(profile.configDir, "settings.json"), "utf8"));
    const mode = inspectAuthMode(settings).mode;
    return mode === "subscription" || mode === "api" ? mode : null;
  } catch {
    return null;
  }
}
