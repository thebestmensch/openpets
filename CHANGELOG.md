# Changelog

All notable changes to OpenPets will be documented in this file.

## 0.1.4

- Bundle a fifth pet, Ollie (scruffy black tricolor Mini Australian Shepherd), in the DMG and seed on first launch.

## 0.1.3 - 2026-05-13

- Collapse speech-bubble slot when no message is showing so the pet can reach the top of the screen instead of being blocked by a fixed 72 px reservation.
- Add macOS focus-follow option: tray toggle "Hide when ghostty not on screen" hides the pet when the chosen app (default `ghostty`) has no visible window. Detects floating panels (e.g. Ghostty's quick-terminal) via a compiled Swift helper using `CGWindowListCopyWindowInfo`, so always-on-top hotkey windows are detected even when they don't claim frontmost.
- Clamp saved window position at drag-end so macOS `NSWindow.constrainFrameRect` snap on next show doesn't appear as the pet "drifting" left after hide/show cycles.
- Shrink window to the pet's bounding box when the speech bubble isn't visible, letting the sprite sit visually closer to the screen edge.

## 0.1.0 - Unreleased

- Initial desktop preview release; macOS is the known-good baseline, with Windows/Linux preview artifacts after native-host smoke testing.
- Add Electron desktop pet with tray/menu-bar controls.
- Add secure same-user IPC transport.
- Add Claude MCP tools for health, start, state, speech, and release.
- Add lifecycle leases for safe shared agent ownership.
- Add TypeScript client, local CLI, and Codex/Petdex pet loader.
