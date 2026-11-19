# Herdr Account Usage

![Herdr account usage status](preview.png)

A Herdr layout add-on that puts Codex and Claude consumption meters in the bottom-right status bar. Each collapsed meter shows whichever window is closer to exhaustion—the short session or the week—and labels it (`5h` or `W`). Click the meters to inspect every local account, see its email and usage, and manage Claude billing mode. Account-launched chats also get stable, distinct icon colors in the Agents sidebar.

## Requirements

- Herdr app 0.1.16 or newer
- Node.js 22 or newer
- Signed-in Codex and/or Claude CLI accounts

## Install

Copy the four mods and layout into your Herdr app home:

```sh
cp -R mods/account-usage ~/.config/herdr-app/mods/
cp -R mods/account-agents ~/.config/herdr-app/mods/
cp -R mods/account-command-palette ~/.config/herdr-app/mods/
cp -R mods/workspace-status-usage ~/.config/herdr-app/mods/
cp layouts/main-usage.json ~/.config/herdr-app/layouts/
```

Merge the shortcuts from [`keys.json`](keys.json) into your own `~/.config/herdr-app/keys.json`. Do not replace your whole keys file. `Cmd+Shift+P` uses a personal clone of Herdr's command palette with one dynamic `New chat` action per discovered account; remove that binding if you prefer the shipped palette.

Then validate and switch layouts:

```sh
herdr-app check ~/.config/herdr-app/mods/account-usage
herdr-app check ~/.config/herdr-app/mods/account-agents
herdr-app check ~/.config/herdr-app/mods/account-command-palette
herdr-app check ~/.config/herdr-app/mods/workspace-status-usage
herdr-app do layout.switch --name main-usage
```

If `main-usage` already exists, rename the layout file, its layout name when switching, and any colliding mod folders or references before copying.

## Multiple accounts

With no extra config, the mod discovers `~/.claude`, `~/.claude-*`, `~/.codex`, and `~/.codex-*`. Each directory is an isolated CLI profile. Sign in once per profile:

```sh
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
CODEX_HOME="$HOME/.codex-work" codex login
```

For custom paths or labels, copy [`accounts.example.json`](mods/account-usage/accounts.example.json) to `mods/account-usage/accounts.json` in your Herdr app home and edit it. When `accounts.json` exists, its list is authoritative. An optional `email` field can identify API-only profiles that do not expose account metadata.

To choose an account per chat, open `Cmd+Shift+P` and select a dynamic `New chat: …` command. The launcher sets the profile's `CLAUDE_CONFIG_DIR` or `CODEX_HOME` and labels the running Herdr terminal with its account ID, name, provider, and display color. The account usage popup stays focused on identity, usage, and billing rather than duplicating chat launch controls.

## Use it in another layout

The included `main-usage` layout is a clone of Herdr's main layout with its status block changed to:

```json
{
  "id": "status",
  "type": "block",
  "content": { "mod": "workspace-status-usage" },
  "size": { "px": 28 }
}
```

Use the same block in a personal layout if you do not want the included clone. Replace the layout's `agents` block with `account-agents` to show the per-account icon colors there too.

## Privacy and security

This mod runs local Node.js helpers and calls:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://api.anthropic.com/api/oauth/usage`

It reads the credentials already used by the Codex and Claude CLIs. Tokens and credential paths remain in memory and are never printed or stored by the mod. The command palette and account-aware Agents sidebar receive only stable profile IDs, labels, provider kinds, display emails, and non-secret display colors. Local `accounts.json`, `cache.json`, and `history.json` files are ignored by Git; the cache and history contain only profile IDs, labels, account display identity such as email, sanitized usage windows, and timestamps.

Each Claude billing toggle edits that profile's `settings.json` only after a click. It moves the existing `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` pair between active and underscore-prefixed parked fields. It refuses incomplete or conflicting configurations.

## Development

```sh
npm test
herdr-app check ./mods/account-usage
herdr-app check ./mods/account-agents
herdr-app check ./mods/account-command-palette
herdr-app check ./mods/workspace-status-usage
```

Validated with Herdr app 0.1.16. See [`RECIPE.md`](RECIPE.md) for the implementation brief.

## License

MIT
