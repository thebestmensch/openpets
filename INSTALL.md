# Install + troubleshooting (this fork)

Quick start (download + install) lives in [README.md](README.md). This file covers prereqs, config locations, how to extend (add pets, change always-on-top behavior), and what to do when things break.

Prebuilt macOS arm64 `.dmg` lives on [Releases](https://github.com/thebestmensch/openpets/releases/latest). For Windows / Linux, build from source — [upstream](https://github.com/alvinunreal/openpets) publishes those platforms via their own CI.

## Prereqs

- macOS 12+ (rotation script + window-level patch are macOS-shaped; pet itself runs anywhere Electron does)
- [bun](https://bun.sh) on `$PATH`
- (Optional) Claude Code CLI for MCP integration

## Build from source

```bash
git clone https://github.com/thebestmensch/openpets.git
cd openpets
bun install
bun run build
```

Rebuild after pulling upstream changes:

```bash
git pull
bun install
bun run build
```

## Config locations (macOS)

| Path | What |
|---|---|
| `~/Library/Application Support/OpenPets/config.json` | active pet pointer + window/tray prefs |
| `~/Library/Application Support/OpenPets/pets/<slug>-<hash>/` | installed pet packs (added via `openpets install`) |
| `~/.openpets/sock` | IPC socket (recreated each launch) |

Reset everything: quit OpenPets via tray menu, delete `~/Library/Application Support/OpenPets/`, relaunch.

## Add a new pet

Sprite contract: 1536×1872 PNG, 8 columns × 9 rows of 192×208 frames. See [examples/pets/README.md](examples/pets/README.md) for the row-state mapping and the `pet.json` schema.

Once the directory exists with `pet.json` + spritesheet:

```bash
bunx --bun @open-pets/cli install ./examples/pets/<new-pet>
```

If OpenPets is running, the pet hot-swaps via the pet-v1 IPC capability (no restart).

Add to rotation: edit `scripts/openpets-rotate`, append the slug to the `PETS` array.

## Window-level patch

This fork patches `apps/desktop/src/main.ts` line 166:

```ts
mainWindow.setAlwaysOnTop(true, "screen-saver");
```

Upstream uses `"floating"` which sits below most macOS hotkey panels (Ghostty ⌘+Enter quick-terminal, Raycast, etc). `"screen-saver"` is the highest non-system Electron level — pet sits above hotkey panels but below the Dock and top menu bar.

Other levels (Electron docs): `floating < torn-off-menu < modal-panel < main-menu < status < pop-up-menu < screen-saver`. To change, edit the line, run `bun run build`, relaunch.

## Hook up to Claude Code

```bash
claude mcp add -s user openpets -- bunx @open-pets/mcp
```

Restart Claude Code, verify with `claude mcp list`. Available tools: `openpets_health`, `openpets_start`, `openpets_set_state`, `openpets_say`, `openpets_release`.

For automatic state changes:

```bash
bunx @open-pets/claude-pets install
```

This patches `~/.claude/settings.json` with hooks that fire on prompt submit, edits, shell commands, permission prompts, and completion. Restart Claude Code after install.

Test:

```bash
bunx @open-pets/claude-pets test-event thinking
```

## Troubleshooting

### Tray icon missing or duplicated

```bash
pkill -f "openpets/apps/desktop"
bun packages/cli/src/index.ts start --pet ./examples/pets/bean
```

If multiple Electron processes show in Activity Monitor, that's the culprit — kill them all and relaunch.

### MCP says connected but pet does not launch

Launch manually first:

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/bean
```

If you installed a release build to `/Applications/`, set the override env vars upstream documents:

```bash
# macOS app bundle
OPENPETS_DESKTOP_COMMAND="open -a OpenPets"

# direct binary
OPENPETS_DESKTOP_APP="/path/to/binary"
```

### Stale IPC socket

Quit OpenPets via tray menu (or `bun packages/cli/src/index.ts quit`) and relaunch. OpenPets cleans stale same-user IPC sockets on launch.

### Pet still covered by Ghostty / Raycast / other hotkey panel

`screen-saver` is the highest non-system Electron level. If a panel still beats it, that panel is using a true system-level NSPanel that Electron can't reach. Workarounds:

- Move the panel (Ghostty: Settings → Quick Terminal Position)
- Move the pet (drag it elsewhere — its position is per-display)
- File an upstream issue if you find an even higher Electron level

Verify the patch is in the running build:

```bash
grep setAlwaysOnTop apps/desktop/src/main.ts
# should print: mainWindow.setAlwaysOnTop(true, "screen-saver");
```

If it shows `floating`, you're on upstream — `git pull` + `bun run build`.

### Rotation script not firing

```bash
# is launchd agent loaded?
launchctl print gui/$(id -u)/com.jm.openpets-rotate | head -20

# tail the log
tail /tmp/openpets-rotate.log

# force-fire now
launchctl kickstart -k gui/$(id -u)/com.jm.openpets-rotate
```

If the agent is loaded but never fires, check the plist `StartInterval` (default `3600`) and that `RunAtLoad` is `false` (no rotation on login by design).

If `launchctl bootstrap` fails with "Bootstrap failed: 5: Input/output error", the plist is malformed — `plutil ~/Library/LaunchAgents/com.jm.openpets-rotate.plist` will show why.

### Pet pack does not load

The OpenPets desktop validates each pet on install. If you see "Pet pack failed to load":

```bash
bunx --bun @open-pets/cli install ./examples/pets/<name>
```

Verbose error goes to stderr. Common causes:

- Spritesheet not 1536×1872
- Wrong frame count (must be 8×9)
- Missing rows in `pet.json` `states` (rows 6/7/8 must exist even if they reuse idle as a placeholder)
- `spritesheetPath` in `pet.json` does not match the file on disk

## Checks

```bash
# unit tests
bun test packages/core/src packages/client/src packages/cli/src packages/mcp/src

# typecheck
bun run typecheck

# desktop in dev mode
bun run dev:desktop
```
