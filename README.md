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

> **JM's fork of [alvinunreal/openpets](https://github.com/alvinunreal/openpets).** Ships four custom pets — Bean, Gia, Ruthie, and JM & Partner — bundled in the DMG (seeded into `~/Library/Application Support/OpenPets/pets/` on first launch, no manual install) and a window-level patch so the pet sits above Ghostty's ⌘+Enter quick-terminal. Prebuilt macOS arm64 `.dmg` on [Releases](https://github.com/thebestmensch/openpets/releases/latest). See [INSTALL.md](INSTALL.md) for troubleshooting and extension docs.

## What is OpenPets?

OpenPets is a desktop pet that reacts while Claude Code and other coding agents work.

- **Desktop companion** - a small pet that changes state while agents think, edit, test, and finish.
- **Claude Code ready** - MCP tools let Claude launch, talk to, and control the pet.
- **Automatic reactions** - pair with [Claude Pets](https://github.com/alvinunreal/claude-pets) for Claude Code hooks.
- **Pet-pack friendly** - loads Codex/Petdex-style animated pet directories.


https://github.com/user-attachments/assets/fbad0d58-8040-4ebb-a26b-73fa497a4ceb



## Quick start (this fork)

macOS arm64 only (other platforms: build from source — see [Develop / extend](#develop--extend)).

### 1. Download and install

Grab the latest `.dmg` from [Releases](https://github.com/thebestmensch/openpets/releases/latest):

- **macOS Apple Silicon**: `OpenPets-*-arm64.dmg` or `OpenPets-*-arm64.zip`

Open the `.dmg`, drag `OpenPets.app` to `/Applications`. The app is signed with JM's Apple Development cert (not a distribution cert), so Gatekeeper may still warn the first time. Strip the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/OpenPets.app
open /Applications/OpenPets.app
```

Pet appears on your desktop, tray icon in the menu bar. Quit via the tray menu.

The first launch seeds Bean, Gia, Ruthie, and JM & Partner into `~/Library/Application Support/OpenPets/pets/`. Switch between them from the tray menu (right-click the menubar icon → pick a pet).

See [examples/pets/README.md](examples/pets/README.md) for what each pet looks like.

### 2. (Optional) Hook up to Claude Code

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

### 3. (Optional) Rotate pets every hour

The rotation script swaps the active pet to a random pick from the four. With OpenPets running it hot-swaps via the pet-v1 IPC capability; otherwise it just updates the launch config so the next start picks up the new pet.

```bash
# pull the script + launchd plist from this fork
mkdir -p ~/bin
curl -fsSL https://raw.githubusercontent.com/thebestmensch/openpets/master/scripts/openpets-rotate \
  -o ~/bin/openpets-rotate
chmod +x ~/bin/openpets-rotate

curl -fsSL https://raw.githubusercontent.com/thebestmensch/openpets/master/scripts/com.jm.openpets-rotate.plist \
  -o ~/Library/LaunchAgents/com.jm.openpets-rotate.plist

# load it (rotates every 3600s, does NOT rotate on login)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jm.openpets-rotate.plist
```

Force a specific pet on demand: `openpets-rotate gia` (or `bean`, `ruthie`, `couple`).
Disable rotation: `launchctl bootout gui/$(id -u)/com.jm.openpets-rotate`.

> The script and plist hardcode JM's `$HOME` (`/Users/jm`) and the path to `examples/pets/` inside JM's checkout. If you're not JM, you'll also need to clone the repo locally so the pet directories exist on disk — see [Develop / extend](#develop--extend) for the clone path, then edit `PETS_DIR` in `~/bin/openpets-rotate` and `HOME` / `ProgramArguments` in the plist.

## Develop / extend

Use this if you want to rebuild from source (other platforms, code changes, adding pets).

### Prereqs

[bun](https://bun.sh) on `$PATH`. If you don't have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Clone and build

```bash
git clone https://github.com/thebestmensch/openpets.git
cd openpets
bun install
bun run build
```

### Run from source

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/bean
# or: gia, ruthie, couple
```

### Build a `.dmg`

```bash
bun run package:mac
# artifact at: release/desktop/OpenPets-*-arm64.dmg
```

For the full extension reference (sprite contract, window-level patch, troubleshooting, etc.), see [INSTALL.md](INSTALL.md).

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

## CLI cheatsheet (source builds)

After `bun run build`:

```bash
# send a state
bun packages/cli/src/index.ts event thinking --message "Planning the next step"
bun packages/cli/src/index.ts event testing
bun packages/cli/src/index.ts event success --message "That worked"

# control the window
bun packages/cli/src/index.ts show
bun packages/cli/src/index.ts hide
bun packages/cli/src/index.ts sleep
bun packages/cli/src/index.ts quit

# tests + typecheck + dev mode
bun test packages/core/src packages/client/src packages/cli/src packages/mcp/src
bun run typecheck
bun run dev:desktop
```
