import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// XUL widgets are rendered as HTML; source geometry and algorithms stay here.
export function importChrome(source, files) {
  const read = file => { files.push(file); return readFileSync(path.join(source, file), 'utf8'); };
  const notice = '/* This Source Code Form is subject to the terms of the Mozilla Public\n * License, v. 2.0. https://mozilla.org/MPL/2.0/. Generated from the supplied Zen checkout. */\n';
  const adapt = css => css.replaceAll('hbox', '.zen-hbox').replaceAll('vbox', '.zen-vbox')
    .replace(/(?<![\w-])toolbarbutton(?![\w-])/g, 'button').replaceAll('xul|button', 'button')
    .replaceAll('::-moz-range-thumb', '::-webkit-slider-thumb')
    .replaceAll('::-moz-range-track', '::-webkit-slider-runnable-track')
    .replaceAll('(-moz-platform: macos)', '(min-width: 0px)')
    .replaceAll('(-prefers-color-scheme: dark)', '(prefers-color-scheme: dark)')
    .replace(/@media[^{}]*-moz-pref[^{}]*\{/g, '@media (max-width: -1px) {')
    .replace(/chrome:\/\/browser\/skin\/zen-icons\/(?:selectable\/)?([\w-]+\.svg)/g, '../assets/zen/chrome/$1')
    .replaceAll('chrome://browser/content/zen-images/grain-bg.png', '../assets/zen/grain-bg.png');
  const single = read('src/zen/common/styles/zen-single-components.css');
  const picker = single.slice(single.indexOf('#PanelUI-zen-emojis-picker {'), single.indexOf('.zen-interactive-button {'));
  writeFileSync('src/renderer/zen/pickers-source.css', notice + adapt(picker));
  let gradient = read('src/zen/spaces/zen-gradient-generator.css');
  gradient = gradient.replace(/@media not -moz-pref\("zen.theme.gradient.show-custom-colors"\) \{\s*#PanelUI-zen-gradient-generator-custom-colors \{\s*display: none !important;\s*\}\s*\}/, '');
  writeFileSync('src/renderer/zen/theme-picker-source.css', notice + adapt(gradient));
  writeFileSync('src/renderer/zen/workspace-form-source.css', notice + adapt(read('src/zen/spaces/create-workspace-form.css').replace(/^zen-workspace-creation \{/m, '.workspace-creation-source {')));
  writeFileSync('src/renderer/zen/omnibox-source.css', notice + adapt(read('src/zen/common/styles/zen-omnibox.css')));
  const animations = read('src/zen/common/styles/zen-animations.css');
  writeFileSync('src/renderer/zen/progress-source.css', notice + adapt(single.slice(single.indexOf('#zen-loading-progress-bar {'), single.indexOf('#TabsToolbar-customization-target:is('))) + '\n' + animations.slice(animations.indexOf('@keyframes zen-progress-bar-pulse')));
  const emojis = read('src/zen/common/emojis/ZenEmojisData.min.mjs');
  const data = JSON.parse(emojis.slice(emojis.indexOf('[{')).trim().replace(/;$/, ''));
  writeFileSync('src/renderer/zen/emojis.json', JSON.stringify(data));
  const icons = read('src/zen/common/emojis/ZenEmojiPicker.mjs');
  const names = [...icons.slice(icons.indexOf('const SVG_ICONS = ['), icons.indexOf('\n];')).matchAll(/"([\w-]+\.svg)"/g)].map(match => match[1]);
  writeFileSync('src/renderer/zen/selectable-icons.json', JSON.stringify(names));
  for (const [folder, target] of [['nucleo', 'chrome'], ['common', 'chrome'], ['common/selectable', 'selectable']]) {
    mkdirSync(`src/renderer/assets/zen/${target}`, { recursive: true });
    for (const name of readdirSync(path.join(source, 'src/browser/themes/shared/zen-icons', folder)).filter(name => name.endsWith('.svg'))) {
      if (folder === 'common' && existsSync(path.join(source, 'src/browser/themes/shared/zen-icons/nucleo', name))) continue;
      const svg = read(`src/browser/themes/shared/zen-icons/${folder}/${name}`).replace(/^#.*$/gm, '')
        .replaceAll('context-fill-opacity', '1').replaceAll('context-stroke-opacity', '1')
        .replaceAll('context-fill', '#ffffff').replaceAll('context-stroke', '#ffffff');
      writeFileSync(`src/renderer/assets/zen/${target}/${name}`, svg);
    }
  }
  copyFileSync(path.join(source, 'src/zen/images/grain-bg.png'), 'src/renderer/assets/zen/grain-bg.png');
  files.push('src/zen/images/grain-bg.png');
  const copyright = 'src/browser/themes/shared/zen-icons/nucleo/nucleo-copyright-notice.html';
  writeFileSync('LICENSES/Nucleo-copyright-notice.html', read(copyright));
  const themeMarkup = read('src/browser/base/content/zen-panels/theme-picker.inc');
  const presets = [...themeMarkup.matchAll(/<box[^>]*data-lightness="([^"]+)"[^>]*data-algo="([^"]+)"[^>]*data-num-dots="([^"]+)"[^>]*data-position="([^"]+)"[^>]*style="([^"]+)"/g)]
    .map(m => ({ lightness: +m[1], algorithm: m[2], count: +m[3], position: m[4].split(',').map(Number), style: m[5] }));
  for (const m of themeMarkup.matchAll(/<box[^>]*data-type="explicit-black-white"[^>]*data-position="([^"]+)"[^>]*style="([^"]+)"/g)) {
    presets.push({ lightness: 50, algorithm: 'float', count: 1, position: m[1].split(',').map(Number), style: m[2], type: 'explicit-black-white' });
  }
  writeFileSync('src/renderer/zen/theme-presets.json', JSON.stringify(presets));
  const generator = read('src/zen/spaces/ZenGradientGenerator.mjs');
  const between = (start, end) => generator.slice(generator.indexOf(start), generator.indexOf(end, generator.indexOf(start)));
  const methods = [between('  hslToRgb(', '  getJSONPos('), between('  calculateCompliments(', '  handleColorPositions('),
    between('  themedColors(', '  onOpacityChange('), between('  getToolbarModifiedBaseRaw(', '  get isMica()'),
    between('  blendWithWhiteOverlay(', '  shouldBeDarkMode('), between('  hexToRgb(', '  /**')].join('\n')
    .replace(/    const (?:gradient|dotPad) = this.panel.querySelector\(".zen-theme-picker-gradient"\);\n    const rect = window.windowUtils.getBoundsWithoutFlushing\((?:gradient|dotPad)\);/g, '    const rect = { width: 360, height: 360 };');
  const harmonies = between('  get colorHarmonies()', '  initContextMenu()');
  writeFileSync('src/renderer/zen/theme-colors.js', notice + `const AppConstants = { platform: 'macosx' };\nconst lazy = { MIN_OPACITY: .30 };\nconst EXPLICIT_LIGHTNESS_TYPE = 'explicit-lightness';\nconst EXPLICIT_BLACKWHITE_TYPE = 'explicit-black-white';\nexport class ZenThemeColors {\n  #currentLightness = 50;\n  #allowTransparencyOnSidebar = false;\n  isDarkMode = true; isMica = false; canBeTransparent = true; isLegacyVersion = false; currentOpacity = .5; useAlgo = ''; dots = [];\n  constructor(dark = true, opacity = .5) { this.isDarkMode = dark; this.currentOpacity = opacity; }\n${harmonies}\n${methods}\n}\n`);
  for (const file of ['src/zen/common/styles/zen-theme.css', 'src/zen/common/styles/zen-toolbar.css', 'src/browser/themes/shared/zen-icons/icons.css', 'src/zen/common/styles/zen-overflowing-addons.css', 'src/browser/base/content/zen-panels/emojis-picker.inc']) read(file);
}
