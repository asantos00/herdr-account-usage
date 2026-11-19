export function accountEntries(accounts = []) {
  return accounts
    .filter((account) => account?.id && account?.label)
    .map((account) => ({
      name: `account.${account.id}`,
      args: {},
      group: "Agent",
      title: `New chat: ${account.label}`,
      words: ["new", "tab", "session", "account", account.kind, account.email].filter(Boolean).join(" "),
      profileId: account.id,
    }));
}
