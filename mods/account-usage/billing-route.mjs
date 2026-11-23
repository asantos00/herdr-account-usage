import * as nodeFs from "node:fs";
import { join } from "node:path";
import { inspectAuthMode } from "./claude-auth.mjs";

export function billingRoute(profile, { fs = nodeFs } = {}) {
  if (profile?.kind === "codex") return "subscription";
  if (profile?.kind !== "claude" || !profile.configDir) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(join(profile.configDir, "settings.json"), "utf8"));
    const inspection = inspectAuthMode(settings);
    if (inspection.mode === "subscription" || inspection.mode === "api") return inspection.mode;
    const noApiFields = inspection.fields.length > 0 && inspection.fields.every((field) => !field.parkedPresent && !field.activePresent);
    return noApiFields ? "subscription" : null;
  } catch {
    return null;
  }
}
