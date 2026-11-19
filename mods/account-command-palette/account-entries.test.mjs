import test from "node:test";
import assert from "node:assert/strict";
import { accountEntries } from "./account-entries.mjs";

test("turns discovered profiles into searchable command-palette entries", () => {
  assert.deepEqual(accountEntries([
    { id: "claude-ttc", kind: "claude", label: "Claude TTC", email: "person@ttc.com" },
    { id: "codex-company", kind: "codex", label: "Codex Company", email: "person@company.com" },
  ]), [
    {
      name: "account.claude-ttc", args: {}, group: "Agent", title: "New chat: Claude TTC",
      words: "new tab session account claude person@ttc.com", profileId: "claude-ttc",
    },
    {
      name: "account.codex-company", args: {}, group: "Agent", title: "New chat: Codex Company",
      words: "new tab session account codex person@company.com", profileId: "codex-company",
    },
  ]);
});

test("ignores incomplete profile records", () => {
  assert.deepEqual(accountEntries([{ id: "missing-label" }, { label: "missing id" }, null]), []);
});
