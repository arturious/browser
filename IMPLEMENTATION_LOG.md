# Implementation Log

## 2026-10-11 - Settings sections

- Replaced the minimal Settings screen with a dark, tabbed settings window.
- Added `General`, `Sidebar`, and `Topbar` sections.
- Added controls for ad blocking, sidebar expansion, compact mode, sidebar width, window border, and chrome style.
- Reused the existing appearance and ad-block IPC APIs.
- Validation: `npm run typecheck`, `npm run build`, and `git diff --check` passed.

## 2026-10-11 - Native macOS settings styling

- Switched the Settings window to the macOS `hiddenInset` title bar with native traffic lights.
- Removed the custom content title bar and restyled section navigation as a compact macOS-style toolbar.
- Updated grouped cards, toggles, controls, spacing, and colors for the native dark appearance.
