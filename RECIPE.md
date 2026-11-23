# Herdr Account Usage

A compact Codex and Claude consumption map in Herdr's bottom-right status bar, with a detailed multi-account popup and Claude Subscription/API billing switches.

![Herdr Account Usage](preview.png)

## What you see

The status bar ends with one small combined control. Colored Codex and Claude glyphs each have ten 3×4px usage segments. Filled segments are green below 70%, amber from 70%, and red from 90%. The Claude profile default follows the meters: `Sub` in the done color, or `API` in muted text. When API billing is active while Claude subscription capacity is available, `API` turns red and gets a 5px red dot.

Clicking the control opens a centered 620×400 themed popup. Its header says “Accounts” and has the last check time, refresh, and close controls. Every discovered profile gets one compact card with its email and both the short-session and weekly meters on single lines, so four accounts fit without scrolling. Clicking a card expands its comparison and pace details. Claude cards with a safe billing configuration also have a compact `Sub` / `API` toggle.

## How it behaves

The status map refreshes usage when it starts and every five minutes. It keeps the last successful values when a provider is unavailable. For each provider it compares every profile's short session, weekly window, and Enterprise extra-credit cap, then shows the highest percentage; ties favor the shorter session. Colored Claude and Codex glyphs identify the winning account, while compact suffixes such as `2·5h`, `W`, and `2·$` identify profile count and limit. Clicking it runs `mod.open` for `account-usage`. `Cmd+Shift+U`, when merged from `keys.json`, opens the same popup.

The popup hydrates from shared cached state, refreshes immediately on open, refreshes every five minutes while visible, and refreshes when the user clicks ↻ or presses `R`. Escape or × closes it. Missing accounts and provider failures stay local to their card.

The popup does not launch chats. The companion `account-command-palette` is a personal clone of Herdr's command palette. It keeps the original commands and adds one searchable `New chat: …` entry per discovered profile. Selecting a Claude profile starts Claude with its `CLAUDE_CONFIG_DIR`. Selecting a Codex profile starts Pi with its `CODEX_HOME` and account-scoped `PI_CODING_AGENT_DIR`, then tags the Herdr terminal with safe account labels. `Cmd+Shift+P`, when merged from `keys.json`, opens it.

The `account-agents` companion is a personal clone of Herdr's Agents mod. It reads those terminal labels and wraps each account-launched agent icon in a stable colored tile. Codex profiles use green, blue, teal, then gold; Claude profiles use coral, purple, pink, then gold. Unlabelled agents retain the native icon treatment.

The `account-pane` companion clones Herdr's pane header and adds a `Subscription` or `API` pill from the immutable route label written when that terminal launches. Changing a profile default later does not rewrite the badge on an existing session.

Each Claude toggle changes only newly started sessions for that profile. It moves an existing `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` pair between active fields and underscore-prefixed parked fields. It refuses to write when the pair is incomplete or conflicting.

## Built from

- `layouts/main-usage.json` is a personal clone of Herdr's `main` layout. Its 28px bottom status block uses `workspace-status-usage`, and its pane headers use `account-pane`.
- `mods/workspace-status-usage/main.js` retains the shipped workspace status information and adds the usage control on the right. It uses `shared`, `setShared`, `exec`, `appHome`, `theme`, `spaces`, `agents`, `keys`, `window`, and `run` from `herdr`.
- `mods/account-usage/main.js` renders the compact/expandable popup with GPUI `div`, `h_flex`, and `v_flex` elements. It uses Herdr's overlay, process, shared-state, and theme APIs.
- `mods/account-command-palette/main.js` clones the shipped frame palette, loads safe profile metadata through `account-control.mjs list`, and launches the selected profile by stable ID.
- `mods/account-agents/main.js` clones the shipped Agents view and colors program-icon tiles from path-free `herdr.account.*` terminal labels.
- `mods/account-pane/main.js` clones the shipped pane header and renders the validated `herdr.billing.route` session label.
- `account-colors.mjs` assigns provider-aware display colors and builds the safe labels written before an account CLI starts.
- `account-profiles.mjs` discovers default and suffixed CLI homes or reads an exact local `accounts.json` registry. It gives each profile a path-free stable ID and builds isolated Claude or Pi launch commands.
- `codex-pi-profile.mjs` creates one protected Pi agent directory per Codex identity, imports that subscription's OAuth credential, keeps its Pi sessions separate, and links the remaining Pi resources to the normal agent directory.
- `account-identity.mjs` reads only display identity: Codex's email/name claims and Claude's cached OAuth account metadata. An explicit local `email` field is the fallback.
- `account-control.mjs` resolves a profile ID at launch time, starts Claude or Pi with the matching account environment, and applies profile-specific Claude billing changes without exposing credential paths to shared state.
- `usage-helper.mjs` reads every discovered Codex and Claude CLI credential in memory, fetches provider usage, normalizes Enterprise extra-credit spend when plan windows are unavailable, writes sanitized per-profile cache and history files atomically with mode `0600`, and emits JSON for the mods.
- `usage-pace.mjs` records at most one stable sample per ten minutes, retains nine days, compares against the same point in the prior cycle, detects resets, and projects whether the current burn rate will last until reset.
- `claude-auth.mjs` inspects and safely rewrites the existing Claude settings field pair after an explicit toggle.
- The popup uses Herdr's shipped `icons/codex.svg` and `icons/claude.svg`. The status bar uses icons from the shipped `workspace-chrome` mod.

## Watch out

The mod reaches the network, runs local Node.js, reads CLI credentials, and can edit `~/.claude/settings.json` after an explicit billing-toggle click. It never prints tokens or credential paths. Account-scoped Pi OAuth credentials are persisted only in protected `~/.pi/account-profiles/<profile-id>/auth.json` files.

Codex usage comes from `https://chatgpt.com/backend-api/wham/usage`. Claude usage comes from `https://api.anthropic.com/api/oauth/usage`. These are provider endpoints used by the installed CLI sessions and may change.

On macOS, Claude credentials are read from the matching Keychain service. On other systems, the helper reads each profile's `.credentials.json`. Without `accounts.json`, discovery honors `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, then includes sibling `~/.codex-*` and `~/.claude-*` directories. With `accounts.json`, only its entries are used.

The billing toggle expects both Claude API fields to be either active or parked. It deliberately does nothing for incomplete or conflicting settings. The layout was cloned from Herdr main 0.1.12 and validated on Herdr app 0.1.16; a later main layout may add structure that this clone does not inherit.

`cache.json` and `history.json` are runtime files. Do not distribute a user's copies.

## Done when

- `npm test` passes.
- `herdr-app check ~/.config/herdr-app/mods/account-usage` passes.
- `herdr-app check ~/.config/herdr-app/mods/account-agents` passes.
- `herdr-app check ~/.config/herdr-app/mods/account-command-palette` passes.
- `herdr-app check ~/.config/herdr-app/mods/account-pane` passes.
- `herdr-app check ~/.config/herdr-app/mods/workspace-status-usage` passes.
- `herdr-app status` reports no new errors.
- The `main-usage` layout shows provider glyphs, profile counts when needed, and a single Claude profile's default billing mode at bottom right.
- New Claude and Pi chats show their launch-time `Subscription` or `API` route in the pane header.
- Clicking the map opens the Accounts popup with one card per configured or discovered profile.
- Four account cards fit in the popup without scrolling while collapsed; clicking one reveals pace details.
- `Cmd+Shift+P` preserves the original command palette and adds one dynamic new-chat entry per account.
- New account chats carry safe account labels, and the account-aware Agents sidebar renders distinct colored icon tiles for them.
- Live percentages render for signed-in accounts without credentials appearing in stdout, `shared.json`, `cache.json`, or `history.json`.
- A billing-mode change updates only the selected Claude profile's expected settings fields and applies to a newly started Claude session.
