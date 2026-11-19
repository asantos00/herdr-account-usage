const COLORS = Object.freeze({
  codex: Object.freeze(["#59C18C", "#5AA9FF", "#64D1CC", "#E0B45A"]),
  claude: Object.freeze(["#F59E75", "#A78BFA", "#E87FA1", "#D6A84B"]),
});

export function colorAccountProfiles(profiles = []) {
  const counts = { codex: 0, claude: 0 };
  return profiles.map((profile) => {
    const palette = COLORS[profile.kind] ?? ["#93A3B8"];
    const index = counts[profile.kind] ?? 0;
    counts[profile.kind] = index + 1;
    return { ...profile, color: palette[index % palette.length] };
  });
}

export function accountTerminalLabels(profile) {
  return {
    "herdr.account.id": profile.id,
    "herdr.account.label": profile.label,
    "herdr.account.kind": profile.kind,
    "herdr.account.color": profile.color,
  };
}
