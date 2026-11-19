export function accountStyle(labels = {}) {
  const id = labels?.["herdr.account.id"];
  const color = labels?.["herdr.account.color"];
  if (!id || !/^#[0-9a-f]{6}$/i.test(color ?? "")) return null;
  return {
    id,
    color,
    label: labels["herdr.account.label"] || id,
    kind: labels["herdr.account.kind"] || null,
  };
}
