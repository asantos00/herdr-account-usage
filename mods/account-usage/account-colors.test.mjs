import test from "node:test";
import assert from "node:assert/strict";
import { accountTerminalLabels, colorAccountProfiles } from "./account-colors.mjs";

test("assigns stable distinct colors within and across providers", () => {
  const colored = colorAccountProfiles([
    { id: "codex-personal", kind: "codex", label: "Codex" },
    { id: "codex-company", kind: "codex", label: "Codex Company" },
    { id: "claude-personal", kind: "claude", label: "Claude" },
    { id: "claude-ttc", kind: "claude", label: "Claude TTC" },
  ]);
  assert.deepEqual(colored.map((profile) => profile.color), ["#59C18C", "#5AA9FF", "#F59E75", "#A78BFA"]);
  assert.equal(new Set(colored.map((profile) => profile.color)).size, 4);
});

test("builds path-free labels for the running terminal", () => {
  assert.deepEqual(accountTerminalLabels({
    id: "claude-ttc", kind: "claude", label: "Claude TTC", color: "#A78BFA",
  }), {
    "herdr.account.id": "claude-ttc",
    "herdr.account.label": "Claude TTC",
    "herdr.account.kind": "claude",
    "herdr.account.color": "#A78BFA",
  });
});
