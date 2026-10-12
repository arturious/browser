# Zen Browser interface adaptations

This project includes interface assets and adapted layout/motion behavior from
[Zen Browser desktop](https://github.com/zen-browser/desktop), licensed under the
[Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/).

Reference: the user-supplied Zen 1.23.2b checkout at
`/Users/r/dev/desktop-dev`. `src/vendor/zen-source.json` records SHA-256 hashes
of the exact source inputs; a Git revision is not assumed for this checkout.
Earlier interface work referenced the installed distribution of the same version.

The original notices are retained in `src/renderer/assets/zen/*.svg`. These SVG
sprite sheets were adapted for Chromium by replacing Firefox's `context-fill`
and `context-stroke` with explicit colors. Both selected and unselected versions
are included. Source assets: `zen-icons/library/library.svg` and the Media,
Downloads, Boosts, Spaces and History sprite sheets.

The original Motion distribution at `src/zen/vendor/motion.min.mjs` is included
unchanged as `src/vendor/zen-motion.cjs`, with Zen's retained notice. Zen's
`motion.dep` identifies it as Motion 13.2.0.

`scripts/import-zen-interface.mjs` generates the Library, download widget,
media preview and new-space styles with HTML selectors. It extracts
`ZenLibraryMediaPreview.#morph` and `ZenFolders.#animateItem` with only their
instance access adapted. Source dimensions, durations, keyframes, easing,
handover and animation cancellation behavior are retained. The source-based
files carry MPL notices; `LICENSES/Zen-MPL-2.0.txt` includes the full license.

`src/shared/motion.ts` adapts the library spring parameters, progress damping,
edge action thresholds and resize curve from `ZenLibrary.mjs`,
`ZenSpacesSwipe.mjs`, `ZenSpaceAddSwipe.mjs`, and `zen-library.css`.

The Zen-derived portions of `src/renderer/styles.css` adapt layout, spacing,
selected/hover states, sprite timing, horizontal Spaces cards, and the compact
reveal curve from `zen-library.css`, `zen-workspaces.css`,
`zen-tabs/vertical-tabs.css`, and `zen-compact-mode.css`. Their MPL notice is
included in the file. The React components and Electron integration are an
implementation for this browser's existing architecture.

`useWorkspaceMotion.ts`, `useSpaceCardDrag.ts`, `FolderRow.tsx`,
`LibraryButton.tsx` and `MediaPreview.tsx` adapt Zen's corresponding lifecycles
to that integration. The native alignment haptic in `native/glass.mm` is based
on `src/zen/toolkit/common/cocoa/ZenHapticFeedback.mm`.
The packaged application includes interface sources and these notices.

`scripts/import-zen-chrome.mjs` additionally imports Zen's omnibox, gradient
picker, emoji picker and workspace creation styles; palette and emoji data;
and the color, opacity, gradient and harmony methods from
`ZenGradientGenerator.mjs`. It adapts XUL tags, preference media queries and
Gecko geometry access to HTML and Electron. The source manifest records hashes
for these inputs and the supplied glyphs.

The supplied Nucleo SVGs retain their original copyright terms. Their notice
is included at `LICENSES/Nucleo-copyright-notice.html`; these assets are not
relicensed under MPL. Selectable icons and emoji data are copied from the Zen
checkout with their source notices retained in the importer and source manifest.
