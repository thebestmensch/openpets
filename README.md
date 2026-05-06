<p align="center">
  <img src="assets/openpets.png" alt="OpenPets - pixel art desktop pets for coding agents" width="100%" />
</p>

<h1 align="center">OpenPets</h1>

<p align="center">
  <strong>A tiny desktop pet for Claude Code and coding agents.</strong>
</p>

<p align="center">
  See agent progress, test runs, and coding state as a playful desktop companion.
</p>

---

> **JM's fork of [alvinunreal/openpets](https://github.com/alvinunreal/openpets).** Ships four custom pets (Bean, Gia, Ruthie, JM & Partner) and a window-level patch so the pet sits above Ghostty's ⌘+Enter quick-terminal. Run from source — this fork doesn't publish prebuilt releases. For the upstream prebuilt app, see [INSTALL.md](INSTALL.md).

## What is OpenPets?

OpenPets is a desktop pet that reacts while Claude Code and other coding agents work.

- **Desktop companion** - a small pet that changes state while agents think, edit, test, and finish.
- **Claude Code ready** - MCP tools let Claude launch, talk to, and control the pet.
- **Automatic reactions** - pair with [Claude Pets](https://github.com/alvinunreal/claude-pets) for Claude Code hooks.
- **Pet-pack friendly** - loads Codex/Petdex-style animated pet directories.


https://github.com/user-attachments/assets/fbad0d58-8040-4ebb-a26b-73fa497a4ceb



## Quick start (this fork)

Run from source. macOS-only as currently set up (rotation uses `launchd`).

### 1. Clone and build

```bash
git clone https://github.com/thebestmensch/openpets.git
cd openpets
bun install
bun run build
```

### 2. Launch with one of the four pets

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/bean
# or: gia, ruthie, couple
```

The pet renders on your desktop and a tray icon appears in the macOS menu bar. Quit via the tray menu.

See [examples/pets/README.md](examples/pets/README.md) for what each pet looks like.

### 3. (Optional) Hook up to Claude Code

Add the OpenPets MCP server so Claude can drive pet state:

```bash
claude mcp add -s user openpets -- bunx @open-pets/mcp
```

Restart Claude Code, then verify with `claude mcp list`. Claude can now call `openpets_health`, `openpets_set_state`, `openpets_say`, `openpets_start`, `openpets_release`.

For automatic state changes while Claude works (thinking → editing → success → idle), install Claude Pets hooks:

```bash
bunx @open-pets/claude-pets install
```

Restart Claude Code. Pet now reacts to prompt submits, file edits, shell runs, permission prompts, and completion.

Test it:

```bash
bunx @open-pets/claude-pets test-event thinking
```

### 4. (Optional) Rotate pets every hour

`scripts/openpets-rotate` swaps the active pet to a random pick from the four. With OpenPets running it hot-swaps via the pet-v1 IPC capability; otherwise it just updates the launch config so the next start picks up the new pet.

```bash
# install rotation script
mkdir -p ~/bin
cp scripts/openpets-rotate ~/bin/openpets-rotate
chmod +x ~/bin/openpets-rotate

# install launchd agent (rotates every 3600s, does not rotate on login)
cp scripts/com.jm.openpets-rotate.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jm.openpets-rotate.plist
```

Force a specific pet on demand: `openpets-rotate gia` (or `bean`, `ruthie`, `couple`).
Disable rotation: `launchctl bootout gui/$(id -u)/com.jm.openpets-rotate`.

> The plist hardcodes JM's `$HOME` (`/Users/jm`). If you're not JM, edit `ProgramArguments` and `EnvironmentVariables/HOME` before bootstrapping.

## Claude Code integration

OpenPets works best with Claude Code in two parts:

1. **OpenPets MCP** - lets Claude intentionally launch, talk to, and control the pet.
2. **[Claude Pets](https://github.com/alvinunreal/claude-pets)** - installs Claude Code hooks so the pet reacts automatically while Claude works.

Install both for the full experience:

```bash
claude mcp add -s user openpets -- bunx @open-pets/mcp
bunx @open-pets/claude-pets install
```

For setup details, troubleshooting, and hook behavior, see:

https://github.com/alvinunreal/claude-pets

## Integrations

OpenPets is the desktop app. Use these companion integrations for automatic agent status updates:

- [Claude Pets](https://github.com/alvinunreal/claude-pets) - Claude Code hooks that update OpenPets while Claude works.
- [OpenCode Pets](https://github.com/alvinunreal/opencode-pets) - OpenCode plugin integration for OpenPets status updates.

## Development

Use this if you are working from the source repo:

```bash
git clone https://github.com/thebestmensch/openpets.git
cd openpets
bun install
bun run build
```

Start the desktop pet:

```bash
bun packages/cli/src/index.ts start
```

Send it a state:

```bash
bun packages/cli/src/index.ts event thinking --message "Planning the next step"
bun packages/cli/src/index.ts event testing
bun packages/cli/src/index.ts event success --message "That worked"
```

Control the window:

```bash
bun packages/cli/src/index.ts show
bun packages/cli/src/index.ts hide
bun packages/cli/src/index.ts sleep
bun packages/cli/src/index.ts quit
```

## Checks

Run tests:

```bash
bun test packages/core/src packages/client/src packages/cli/src packages/mcp/src
```

Typecheck everything:

```bash
bun run typecheck
```

Build everything:

```bash
bun run build
```

Run the desktop in dev mode:

```bash
bun run dev:desktop
```

## Status

OpenPets is available as a v0.1 desktop release for macOS, Windows, and Linux. Code signing and auto-update polish are planned for future releases.
