import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountTerminalLabels, colorAccountProfiles } from "./account-colors.mjs";
import { identityForAccount } from "./account-identity.mjs";
import { discoverAccountProfiles, launchArgv, resolveProfile } from "./account-profiles.mjs";
import { inspectAuthMode, serializeSettings, switchAuthMode } from "./claude-auth.mjs";
import { prepareCodexPiProfile } from "./codex-pi-profile.mjs";

function switchClaudeAuth(profile, targetMode) {
  if (profile.kind !== "claude") throw new Error("Billing mode is only available for Claude profiles.");
  const path = join(profile.configDir, "settings.json");
  const original = readFileSync(path, "utf8");
  const result = switchAuthMode(JSON.parse(original), targetMode);
  if (result.changed) {
    const temporary = `${path}.tmp-account-usage-${process.pid}`;
    writeFileSync(temporary, serializeSettings(result.settings, original), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  }
  return inspectAuthMode(result.settings).mode;
}

function labelTerminal(profile) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  for (const [key, value] of Object.entries(accountTerminalLabels(profile))) {
    if (value) spawnSync("hc", ["label", terminal, `${key}=${value}`], { stdio: "ignore" });
  }
}

function launch(profile) {
  labelTerminal(profile);
  const piAgentDir = profile.kind === "codex" ? prepareCodexPiProfile(profile) : undefined;
  const [command, ...args] = launchArgv(profile, { piAgentDir });
  const result = spawnSync(command, args, { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.status ?? 1;
}

function main() {
  const [action, id, value] = process.argv.slice(2);
  const profiles = colorAccountProfiles(discoverAccountProfiles());
  if (action === "list") {
    const accounts = profiles.map((profile) => {
      const identity = identityForAccount(profile);
      return { id: profile.id, kind: profile.kind, label: profile.label, email: identity.email, color: profile.color };
    });
    process.stdout.write(JSON.stringify({ accounts }));
    return;
  }
  const profile = resolveProfile(profiles, id);
  if (action === "launch") return launch(profile);
  if (action === "switch-auth") {
    const mode = switchClaudeAuth(profile, value);
    process.stdout.write(JSON.stringify({ id: profile.id, mode }));
    return;
  }
  throw new Error(`Unknown action: ${action || "(missing)"}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
