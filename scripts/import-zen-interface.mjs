// Offline importer: keep a reproducible connection to the user's Zen checkout.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { importChrome } from './import-zen-chrome.mjs';
const source = path.resolve(process.argv[2] ?? '../desktop-dev');
const files = [
  'src/zen/vendor/motion.min.mjs', 'src/zen/library/ZenLibrary.mjs',
  'src/zen/library/zen-library.css', 'src/zen/library/sections/ZenLibrarySearchSection.mjs',
  'src/zen/spaces/ZenSpacesSwipe.mjs', 'src/zen/spaces/ZenSpaceAddSwipe.mjs',
  'src/zen/spaces/ZenSpaceManager.mjs', 'src/zen/spaces/zen-workspaces.css',
  'src/zen/compact-mode/zen-compact-mode.css', 'src/zen/compact-mode/sidebar.inc.css',
  'src/zen/tabs/zen-tabs/vertical-tabs.css', 'src/zen/folders/zen-folders.css',
  'src/zen/common/modules/ZenVerticalTabsManager.mjs',
  'src/zen/library/sections/ZenLibrarySpacesSection.mjs',
  'src/zen/library/ZenLibraryMediaPreview.mjs',
  'src/zen/common/styles/zen-library-media-preview.css',
  'src/zen/common/styles/zen-library-widget.css',
  'src/zen/common/styles/zen-animations.css',
  'src/zen/common/styles/zen-single-components.css',
  'src/zen/library/ZenLibraryWidget.sys.mjs',
  'src/zen/folders/ZenFolders.mjs',
  'src/zen/toolkit/common/cocoa/ZenHapticFeedback.mm',
];
mkdirSync('src/vendor', { recursive: true });
mkdirSync('src/renderer/zen', { recursive: true });
copyFileSync(path.join(source, files[0]), 'src/vendor/zen-motion.cjs');
let css = readFileSync(path.join(source, files[2]), 'utf8');
const selectors = {
  '#zen-library-panel': '.library-panel', '#zen-library-side': '.library-side',
  '#zen-library-header': '.library-window-header', '#zen-library-sidebar-tabs': '.library-tabs',
  '#zen-library-footer': '.library-footer', '#zen-library-content': '.library-section-host',
  '.zen-library-tab-icon-image': '.library-sprite img', '.zen-library-tab-icon': '.library-sprite',
  '.zen-library-tab': '.library-tab', '.zen-library-section': '.library-content',
  '.zen-library-search-top': '.library-search-top', '.zen-library-search-header': '.library-search-header',
  '.zen-library-filter-header': '.library-filter-header', '.zen-library-search-box': '.library-search-box',
  '.zen-library-filter-button': '.library-filter-button', '.zen-library-filter-done': '.library-filter-done',
  '.zen-library-filter-panel-inner': '.library-filter-panel-inner', '.zen-library-filter-panel': '.library-filter-panel',
  '.zen-library-filter-group': '.library-filter-group', '.zen-library-filter-options': '.library-filter-options',
  '.zen-library-filter-chip': '.library-filter-chip', '.zen-library-search-results': '.library-results',
  '.zen-library-spaces': '.library-spaces', '.zen-library-space-header': '.library-space-title',
  '.zen-library-space-footer': '.library-space-summary', '.zen-library-space-body': '.library-space-pins',
  '.zen-library-space': '.library-space-card', '.zen-library-group': '.library-history-group',
  '.zen-library-search-sentinel': '.library-load-more', '.zen-library-empty': '.library-empty',
  '.zen-library-row': '.library-row', '.zen-library-row-icon': '.library-row-icon',
  '.zen-library-row-text': '.library-row-text', '.zen-library-row-title': '.library-row-title',
  '.zen-library-row-subtitle': '.library-row-subtitle', '.zen-library-row-icon-box': '.library-row-icon-box',
  '.zen-library-row-progress': '.library-row-progress', '.zen-library-row-progress-track': '.library-row-progress-track',
  '.zen-library-row-progress-arc': '.library-row-progress-arc',
  '.zen-library-visit-url': '.library-visit-url', '.zen-library-visit-date': '.library-visit-date',
  '.zen-library-download-url': '.library-download-url', '.zen-library-download-status': '.library-download-status',
  '.zen-library-boost-row': '.library-boost-row', '.zen-library-boost-icon': '.library-boost-icon',
  '.zen-library-media-grid': '.library-media-grid', '.zen-library-media-item': '.library-media-item',
  '.zen-library-media-frame': '.library-media-frame', '.zen-library-media-thumb': '.library-media-thumb',
  '.zen-library-space-handle': '.library-space-drag', '.zen-library-space-icon': '.space-card-icon',
  '.zen-library-space-name': '.space-title-button', '.zen-library-space-name-input': '.space-name-input',
};
css = css.replace(/#[\w-]+|\.[\w-]+/g, selector => selectors[selector] ?? selector);
css = css.replace(/zen-library-(history|downloads|media|boosts|spaces)-section/g, '.library-section-$1');
css = css.replaceAll('.library-boost-row[disabled]', '.library-boost-row.disabled');
css = css.replace(/\[(paused|indeterminate|pending)\]/g, (_, name) => '.' + name);
css = css.replaceAll('[preview]', '[data-preview="true"]');
css = css.replace(/(?<![\w.-])zen-library(?![\w-])/g, '.zen-library');
css = css.replace(/\[(open|active|animate|transitioning|sizing|fade-in|scrolled|dragging|no-transition)\]/g, (_, name) => '.' + name);
css = css.replaceAll('[zen-library-downloading]', '[data-downloading="true"]');
css = css.replaceAll('-moz-window-dragging', '-webkit-app-region');
css = css.replaceAll('@media not (-moz-platform: macos)', '@media (max-width: -1px)');
css = css.replaceAll('@media (-moz-platform: macos)', '@media (min-width: 0px)');
css = css.replace(/background-image: url\("chrome:\/\/browser\/skin\/zen-icons\/library\/library-(history|downloads|boosts|spaces|media)-sprite.svg"\);/g, '/* Sprite URL is supplied by the React image; context paints are resolved in imported SVGs. */');
css = css.replaceAll('chrome://browser/skin/zen-icons/library/library-tile.svg', '../assets/zen/library-tile.svg');
css = css.replaceAll('chrome://browser/skin/zen-icons/blank.svg', '../assets/zen/blank.svg');
mkdirSync('src/renderer/assets/zen', { recursive: true });
const notice = '<!-- This Source Code Form is subject to the terms of the Mozilla Public\n   - License, v. 2.0. If a copy of the MPL was not distributed with this\n   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->\n';
for (const name of ['library.svg', 'library-tile.svg', 'blank.svg']) {
  const original = 'src/browser/themes/shared/zen-icons/common/' + (name === 'blank.svg' ? '' : 'library/') + name;
  const svg = readFileSync(path.join(source, original), 'utf8').replace(/^#.*$/gm, '').trim().replaceAll('context-fill-opacity', '1').replaceAll('context-fill', '#ded8ed').replaceAll('context-stroke', '#baa6e6');
  writeFileSync('src/renderer/assets/zen/' + name, notice + svg);
  files.push(original);
}
const moveIcon = 'src/browser/themes/shared/zen-icons/nucleo/move-cursor.svg';
writeFileSync('src/renderer/assets/zen/move-cursor.svg', notice + readFileSync(path.join(source, moveIcon), 'utf8').replace(/^#.*$/gm, '').trim().replaceAll('context-fill-opacity', '1').replaceAll('context-fill', '#ded8ed'));
files.push(moveIcon);
for (const [original, name] of [
  ['src/browser/themes/shared/zen-icons/common/library/library-sprite.svg', 'library-sprite.svg'],
  ['src/browser/themes/shared/zen-icons/nucleo/forward.svg', 'forward.svg'],
  ['src/browser/themes/shared/zen-icons/nucleo/plus.svg', 'plus.svg'],
]) {
  writeFileSync('src/renderer/assets/zen/' + name, notice + readFileSync(path.join(source, original), 'utf8').replace(/^#.*$/gm, '').trim().replaceAll('context-fill-opacity', '1').replaceAll('context-fill', '#ded8ed').replaceAll('context-stroke', '#baa6e6'));
  files.push(original);
}
for (const section of ['media', 'downloads', 'boosts', 'spaces', 'history']) {
  const original = `src/browser/themes/shared/zen-icons/common/library/library-${section}-sprite.svg`;
  const svg = readFileSync(path.join(source, original), 'utf8').replace(/^#.*$/gm, '').trim();
  for (const active of [false, true]) {
    writeFileSync(`src/renderer/assets/zen/${section}${active ? '-active' : ''}.svg`, notice + svg.replaceAll('context-fill-opacity', '1').replaceAll('context-stroke-opacity', '1').replaceAll('context-fill', active ? '#4a425c' : 'transparent').replaceAll('context-stroke', '#baa6e6'));
  }
  files.push(original);
}
writeFileSync('src/renderer/zen/library-source.css', '/* Generated by scripts/import-zen-interface.mjs. Edit the Electron adapter separately. */\n' + css);
const previewSource = readFileSync(path.join(source, 'src/zen/library/ZenLibraryMediaPreview.mjs'), 'utf8');
const constants = previewSource.slice(previewSource.indexOf('const MORPH_MS'), previewSource.indexOf('\n\n/**', previewSource.indexOf('const MORPH_MS')));
const morph = previewSource.slice(previewSource.indexOf('  #morph(thumbnail, opening) {'), previewSource.indexOf('\n  #step(delta) {'))
  .replace('  #morph(thumbnail, opening)', 'export function morphMedia(parts, origin, opening)')
  .replace('this.#parts', 'parts')
  .replace('    const source = thumbnail?.querySelector(".zen-library-media-thumb");\n', '')
  .replace('const from = source?.getBoundingClientRect();', 'const from = origin && { ...origin, left: origin.x, top: origin.y };')
  .replaceAll('this.#window', 'window');
writeFileSync('src/renderer/zen/media-morph.js', '/* MPL-2.0. Generated from ZenLibraryMediaPreview.mjs; only origin/parts and window access are adapted. */\n' + constants + '\n\n' + morph);
copyFileSync(path.join(source, 'src/zen/common/styles/zen-library-media-preview.css'), 'src/renderer/zen/media-preview-source.css');
let widget = readFileSync(path.join(source, 'src/zen/common/styles/zen-library-widget.css'), 'utf8');
const animations = readFileSync(path.join(source, 'src/zen/common/styles/zen-animations.css'), 'utf8');
widget += '\n' + animations.slice(animations.indexOf('@keyframes zen-swipe-add-icon-jump'), animations.indexOf('@keyframes zen-back-and-forth-text'));
const components = readFileSync(path.join(source, 'src/zen/common/styles/zen-single-components.css'), 'utf8');
widget += '\n' + components.slice(components.indexOf('#TabsToolbar-customization-target:is([zen-library-stack-open]'), components.indexOf('%include zen-library-widget.css'));
widget = widget.replaceAll('#zen-sidebar-foot-buttons', '.sidebar-footer').replaceAll('#TabsToolbar-customization-target', '.workspace-strip').replaceAll('#zen-library-button', '.library-button').replaceAll('#library-button-badge', '.library-button-badge').replaceAll('#zen-library-download-list', '.zen-library-download-list');
widget = widget.replaceAll(':root:not([zen-sidebar-expanded="true"])', '.zen-sidebar:not(.expanded)').replaceAll(':root:not([inDOMFullscreen="true"])', ':root');
widget = widget.replaceAll('[zen-library-stack-open]', '.library-stack-open').replaceAll('[zen-library-stack-closing]', '.library-stack-closing').replaceAll('[zen-library-badge]', '.library-has-badge');
widget = widget.replaceAll('[downloading]', '[data-downloading="true"]').replaceAll('[show-in-folder]', '[data-show-in-folder="true"]');
widget = widget.replaceAll('-moz-window-dragging', '-webkit-app-region');
widget = widget.replaceAll('@media not (-moz-platform: macos)', '@media (max-width: -1px)').replaceAll('@media (-moz-platform: macos)', '@media (min-width: 0px)');
widget = widget.replaceAll('chrome://browser/skin/zen-icons/library/library-sprite.svg', '../assets/zen/library-sprite.svg').replaceAll('chrome://browser/skin/zen-icons/forward.svg', '../assets/zen/forward.svg');
widget = widget.replace(/list-style-image: url\("chrome:[^"]+"\);/g, '/* The HTML button supplies its platform icon. */');
writeFileSync('src/renderer/zen/library-widget-source.css', '/* MPL-2.0. Generated from Zen Library widget/animation/mask styles with HTML selectors. */\n' + widget);
const addStyles = components.slice(components.indexOf('.zen-swipe-add-space-container {'))
  .replaceAll('[readytoadd]', '.ready').replaceAll('chrome://browser/skin/zen-icons/plus.svg', '../assets/zen/plus.svg');
writeFileSync('src/renderer/zen/spaces-add-source.css', '/* MPL-2.0. Imported Zen new-space indicator styles. */\n' + addStyles);
const folders = readFileSync(path.join(source, 'src/zen/folders/ZenFolders.mjs'), 'utf8');
const folderAnimate = folders.slice(folders.indexOf('  async #animateItem(item, targetState,'), folders.indexOf('\n  /**\n   * Stops the animation'))
  .replace('  async #animateItem(', 'export async function animateFolderRow(').replaceAll('this.#itemAnimations', 'folderAnimations');
writeFileSync('src/renderer/zen/folder-motion.js', '/* MPL-2.0. Generated from ZenFolders.#animateItem, with a shared animation registry. */\nconst folderAnimations = new WeakMap();\nexport function cancelFolderRow(item) { folderAnimations.get(item)?.cancel(); folderAnimations.delete(item); }\n' + folderAnimate);
const metadata = JSON.parse(readFileSync(path.join(source, 'surfer.json'), 'utf8'));
importChrome(source, files);
writeFileSync('src/vendor/zen-source.json', JSON.stringify({ version: metadata.brands.release.release.displayVersion, files: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(path.join(source, file))).digest('hex')])) }, null, 2) + '\n');
console.log('Imported Zen ' + metadata.brands.release.release.displayVersion + ' Motion, Library stylesheet and source hashes.');
