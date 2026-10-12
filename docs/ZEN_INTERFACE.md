# Sidebar and Library

The reference is the supplied `/Users/r/dev/desktop-dev` checkout, Zen Browser
1.23.2b. The existing Electron/React browser now imports the original Motion
distribution, Library/widget/preview/new-space styles and SVG sprites. The
media morph and folder animation function are generated from the actual Zen
methods. No Firefox runtime or Zen profile is required.

`npm run import:zen -- /path/to/desktop-dev` regenerates these files offline.
`src/vendor/zen-source.json` records version and SHA-256 of every referenced
source. Generated files live under `src/renderer/zen`; HTML/native-view
adjustments live separately in `electron.css`. Motion is copied byte-for-byte
to `src/vendor/zen-motion.cjs`, including its original notice.

## Controls

- Library: sidebar footer, or **⌘⇧L**. Close with Escape or the back button.
- New tab: **⌘T**. History: **⌘Y**. Downloads: **⌘J**.
- Compact sidebar: **Ctrl+Alt+C**; reveal from the left edge.
- Spaces: footer icons, or **Ctrl+Alt+Left/Right**.
- Swipe right in the first space to reveal Library. Swipe left/right between
  spaces. Swipe left beyond the last space to reveal the new-space ring.
- Short swipes return to the initial position; sufficiently long swipes commit.
  Fast flicks contribute to library activation. Pinch and vertical scrolling
  remain available. Page swipes retain the existing back/forward behavior.
- Drag tabs to reorder, into folders, or onto another space's footer icon.
  Right-click tabs for Pin, Essentials, Move to Space and Move to Folder.
- Folder rows expand/collapse. Right-click offers removal while keeping tabs.
- Space names can be renamed from Library. Space options can remove a space
  while moving its tabs to another space.
- Drag a Space by the move handle in its Library card. Other cards shift by
  266px, the dragged card scales to 1.03, and the strip auto-scrolls at the edge.
- Hover Library for the four latest downloads. The badge follows the original
  curved flight; rows enter with 12ms staggering and close after 200ms.
  Clicking an in-progress download toggles opening it when finished.
- Media thumbnails open a window-centered preview above the native webpage.
  Escape/backdrop closes it; arrow keys navigate. Open/Finder/copy actions are
  available from its native context menu.
- Browser interface DevTools: **⌘⇧⌥I**, in a separate window to preserve
  native page geometry. Page DevTools retain **⌘⌥I**.

## Data and layers

Every space remembers its selected tab. Essentials are global; other tabs and
folders belong to a space. Stable tab IDs, folders and spaces survive restarts,
including migration of the earlier session format.

Library contains Media, Downloads, Boosts, Spaces and History. History records
committed navigations and updates page titles. Downloads track real Electron
DownloadItems, provide pause/resume/cancel and Finder/open actions, and mark
unfinished downloads as interrupted after restarting. Media lists downloaded
media and playing tabs, with image thumbnails. Boosts store per-domain CSS;
only one boost is active per domain, and disabling it removes its CSS from
loaded pages. The boost editor is this browser's CSS editor, rather than Zen's
Firefox-specific detached Glance editor.

Library retains each visited section's query, filters and scroll position while
open. Search debounces for 250ms; history/downloads load in pages of 100 with
a 200px observer margin. Filters crossfade over 280ms and move results over
300ms using measured content height. Inactive sections are hidden; closing
retains only the current one and clears its content after 30 seconds idle.
Space tab lists fill as cards enter a 300px observer margin and empty on close.
Folder expansion inside Library has independent state, as in Zen; the active
tab remains visible in a collapsed folder. Interrupted per-item folder
animations measure the current position before cancelling their predecessor.

Media uses the source 250ms thumbnail morph, easing `.22,1,.36,1`, 30% chrome
handover and 25% chrome exit. A transparent native overlay keeps the preview
above both the Library and webpage without hiding/resizing the page. Its
renderer is destroyed on close. Only the isolated chrome session can request
`browser-media://download/<id>`; the protocol resolves completed media from the
download store and never accepts arbitrary filesystem paths.

Library follows gesture progress with rubber banding, then settles with the
original Motion analytical spring (stiffness 720, damping 47, mass 1.2).
Workspace panels use Motion's bounce-zero 250ms spring and wrapped slot layout.
Tab closing uses its original 100ms fade/scale-to-0.95; folders use the source
180ms ease-in-out per-item animation. The original compact reveal curve lasts
250ms, closing takes 150ms, library icon animation uses 36 frames over 583ms,
and the Spaces view expands with the original 300ms resize curve. Reduced
motion uses immediate settling.

Workspace and Library wheel gestures accumulate pixel deltas with monotonic
rubber-band resistance. Applying Gecko's native per-update feedback to wheel
deltas made a slowing swipe reverse direction and flicker sidebar opacity.
Beyond the open/closed edges, the exponential resistance uses Zen's 0.08
constant with a 12px travel envelope instead of 20% of the Library width.
This retains the previously requested small elastic pull; normal reveal/close movement
is unchanged. The panel settles back to its edge with the same spring.
A swipe interrupting an opening/closing spring continues from the currently displayed position,
including its small overshoot. Touch gestures settle only on release/cancel,
not during a pause while the finger is still held down.

The webpage moves by `(library width - sidebar width) × progress` without
resizing. Electron's native WebContentsView geometry follows the same state as
the chrome surface, with both rounded to the same pixel grid. Native bounds,
corner masks and compact-view visibility are updated only when they change;
hidden tabs do not receive geometry updates during motion.
The compact native view stays alive during a gesture and is
hidden on completion. During Library reveal, the compact sidebar translates
off-screen at three times Library progress, as in Zen; the permanent sidebar
fades and scales to 0.96 instead. Per-frame updates send only UI motion state, rather than
retransmitting history, thumbnails or saved tab data. Motion frames update
composited transforms once per animation frame without rerendering React's
tab/history lists; React receives changes to interaction state. Library has
an opaque background so the moving page does not tint it through alpha.
Cancelling a reveal restores the previously visible compact sidebar and its
native hit surface throughout the return animation.

The macOS addon forwards native scroll began/changed/ended/cancelled phases
and separates momentum. Finger release settles immediately; pauses while
fingers stay on the trackpad do not end the gesture, and momentum cannot start
a second pull. Ordinary wheels retain the debounce fallback. New-space
readiness uses Zen's native macOS alignment haptic pulse.

Zen's Gecko native swipe tracker and Firefox/XUL widgets are adapted to
Chromium wheel distances, React HTML and native WebContentsViews. This is a
source-based interface port, not a byte-identical Firefox runtime. Physical
trackpad equivalence remains unverified. Firefox container profiles, nested
tab groups/split views, Places' advanced visit/closed-tab queries, system-wide
media indexing, the Zen mods catalog and detached Glance are outside the
existing Electron data model. Media here comes from this browser's downloads.

## Toolbar, menus and pickers

The old centered hostname bar, SF Symbols and their replace/wiggle effects,
stand-in icons, Glass Gradient/Solid Color theme window, and small custom Space
icon/color palettes have been retired. A one-time interface revision resets
the old chrome style to Zen's workspace theme and window padding; sessions,
history, downloads, Spaces and site settings are preserved.

The toolbar uses supplied Zen glyphs and the source 38px toolbar, 16px icon,
6px inner padding and 8px button radius. Back/forward, reload/stop, copy URL,
site information, PiP, extensions and menu controls have accessible native
HTML buttons. The reading URL preserves the path instead of the previous
custom shortening rule. Cmd+L/Cmd+T use a native overlay with suggestions and
keyboard navigation. Its 333px positioning minimum and 750px width cap follow
`ZenUIManager.updateTabsToolbar`; suggestions use this browser's tabs/history.

Edit Theme now opens an in-window source-based picker with draggable color
points, source palettes and harmony math, auto/light/dark appearance, opacity,
grain texture, and custom colors. Themes persist separately for each Space.
The source emoji/SVG picker supports tag search, clear selection and sliding
pages. New/Edit Space uses the imported creation form and saves the chosen
icon/theme. Customize Toolbar supports reorder, add/remove and restore defaults.

The extensions button is beside the browser menu; pinned extension icons sit
before it. The manager loads user-selected unpacked Chromium extensions into
the persistent webpage session, remembers them across restarts, and offers
enable/disable, pin/unpin and remove. Popup views run in the webpage session
without the privileged browser preload. Files stay on disk when removed.
Electron supports only a subset of the Chrome extension API; Firefox add-ons
and store installation are not provided. Declared default popups are supported;
full Chrome action/tab/side-panel behavior cannot be assumed.

Menu/address/theme native overlays reuse a renderer while switching panels
and destroy it on dismissal. They stay above newly attached pages without
resizing or navigating the page, and lose privileged IPC access on destruction.
Interface panel contents are lazy-loaded separately from the main chrome.
The native layer becomes visible after the panel commits, and popup placement
tracks viewport changes. The picker follows system appearance in Auto mode;
moving or adding gradient points preserves manually added colors.

## Validation

`npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
The tests mock Electron's window and native views to check space isolation,
session migration/restoration, Essentials, folders, gesture outcomes, width and
page geometry, cancelled/interrupted springs, compact gesture continuity,
decelerating wheel input, frame batching and motion/state subscription delivery,
history, download tracking and boost application/removal.
Additional checks cover native release/momentum handling, persisted Space
reordering and card cancellation/auto-scroll, original spring samples, media
morph coordinates/handover, interrupted folder animation, preview geometry
and renderer teardown, download-ID protocol isolation, and open-when-done.

For packaging with the installed Electron distribution (without downloading it
again), run:

```sh
npm run build
node_modules/.bin/electron-builder --mac --dir --config.electronDist=node_modules/electron/dist
```

The application is at `dist/mac-arm64/Browser.app`. Creating a DMG requires
an environment where `hdiutil create` is available; the sandbox used for this
change rejected that step with `Device not configured`.
