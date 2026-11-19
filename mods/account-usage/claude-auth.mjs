export const SETTINGS_RELATIVE_PATH = ".claude/settings.json";

export const AUTH_FIELDS = Object.freeze([
  Object.freeze({ parked: "_ANTHROPIC_BASE_URL", active: "ANTHROPIC_BASE_URL" }),
  Object.freeze({ parked: "_ANTHROPIC_AUTH_TOKEN", active: "ANTHROPIC_AUTH_TOKEN" }),
]);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function inspectAuthMode(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return { mode: "invalid", detail: "Settings must be a JSON object.", fields: [] };
  }
  if (!settings.env || typeof settings.env !== "object" || Array.isArray(settings.env)) {
    return { mode: "invalid", detail: "The env object is missing.", fields: [] };
  }

  const fields = AUTH_FIELDS.map(({ parked, active }) => ({
    parked,
    active,
    parkedPresent: hasOwn(settings.env, parked),
    activePresent: hasOwn(settings.env, active),
  }));
  const allParked = fields.every((field) => field.parkedPresent && !field.activePresent);
  const allActive = fields.every((field) => field.activePresent && !field.parkedPresent);

  if (allParked) {
    return { mode: "subscription", detail: "API credentials are parked in underscore-prefixed fields.", fields };
  }
  if (allActive) {
    return { mode: "api", detail: "API credential fields are active.", fields };
  }

  const hasConflict = fields.some((field) => field.parkedPresent && field.activePresent);
  return {
    mode: hasConflict ? "conflict" : "incomplete",
    detail: hasConflict
      ? "Both parked and active versions exist; no automatic switch is safe."
      : "The expected parked or active field pair is incomplete.",
    fields,
  };
}

export function switchAuthMode(settings, targetMode) {
  if (targetMode !== "subscription" && targetMode !== "api") {
    throw new Error("Target mode must be subscription or api.");
  }

  const inspection = inspectAuthMode(settings);
  const expectedMode = targetMode === "api" ? "subscription" : "api";
  if (inspection.mode === targetMode) return { settings, changed: false, inspection };
  if (inspection.mode !== expectedMode) {
    throw new Error(inspection.detail);
  }

  const next = JSON.parse(JSON.stringify(settings));
  for (const { parked, active } of AUTH_FIELDS) {
    const source = targetMode === "api" ? parked : active;
    const destination = targetMode === "api" ? active : parked;
    next.env[destination] = next.env[source];
    delete next.env[source];
  }

  return { settings: next, changed: true, inspection: inspectAuthMode(next) };
}

export function subscriptionCapacityAvailable(mode, account) {
  const used = account?.session?.usedPercent;
  return mode === "api" && Number.isFinite(used) && used < 100;
}

export function serializeSettings(settings, originalText = "") {
  const newline = originalText.endsWith("\n") ? "\n" : "";
  return `${JSON.stringify(settings, null, 2)}${newline}`;
}
