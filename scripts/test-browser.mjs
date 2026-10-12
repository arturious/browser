import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const directory = mkdtempSync(path.join(tmpdir(), 'browser-state-test-'));
const mock = `
const { EventEmitter } = require('node:events');
let richMotion = true;
const sessionEvents = new EventEmitter();
class WC extends EventEmitter {
  url = ''; messages = []; navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} };
  isDestroyed() { return !!this.destroyed; }
  send(channel, ...args) { this.messages.push([channel, ...args]); }
  css = []; async insertCSS(css) { this.css.push(css); return 'key-' + this.css.length; } async removeInsertedCSS(key) { this.css[Number(key.slice(4)) - 1] = null; }
  focus() {} setBackgroundThrottling() {} setWindowOpenHandler() {} setZoomFactor() {}
  loadFile() { return Promise.resolve(); }
  loadURL(url) { this.url = url; this.emit('did-navigate', {}, url); return Promise.resolve(); }
  getURL() { return this.url; }
  close() { this.destroyed = true; this.emit('destroyed'); }
}
class WebContentsView {
  webContents = new WC(); visible = false; bounds = {}; boundsCalls = 0; radiusCalls = 0; visibilityCalls = 0;
  setBackgroundColor() {} setBorderRadius() { this.radiusCalls++; } setVisible(value) { this.visible = value; this.visibilityCalls++; } setBounds(value) { this.bounds = value; this.boundsCalls++; }
}
class BrowserWindow extends EventEmitter {
  webContents = new WC(); views = [];
  contentView = { addChildView: view => { this.views = this.views.filter(item => item !== view); this.views.push(view); }, removeChildView: view => { this.views = this.views.filter(item => item !== view); } };
  setWindowButtonPosition() {} loadFile() { return Promise.resolve(); } show() {} focus() {} isDestroyed() { return false; }
  getContentSize() { return [1100, 750]; } getNormalBounds() { return { x: 0, y: 0, width: 1100, height: 750 }; } isFullScreen() { return false; }
}
exports.app = { getPath: () => ${JSON.stringify(directory)}, focus() {} };
exports.BrowserWindow = BrowserWindow; exports.WebContentsView = WebContentsView;
exports.screen = { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] };
exports.session = { defaultSession: sessionEvents };
exports.mediaRequests = []; exports.mediaHandler = null;
exports.session.fromPartition = partition => { if (partition !== 'chrome') throw new Error('Wrong media session'); return { protocol: { handle: (_scheme, handler) => { exports.mediaHandler = handler; } } }; };
exports.protocol = { registerSchemesAsPrivileged() {} };
exports.net = { fetch: async (url, options) => { exports.mediaRequests.push([url, options]); return new Response('image bytes'); } };
exports.systemPreferences = { getAnimationSettings: () => ({ prefersReducedMotion: !richMotion }) };
exports.setRichMotion = value => { richMotion = value; };
exports.Menu = { getApplicationMenu: () => null, buildFromTemplate: items => ({ popup() {}, items }) };
exports.nativeImage = { createMenuSymbol: () => null, createThumbnailFromPath: async () => ({ isEmpty: () => true }) };
exports.shell = { opened: [], openPath(file) { this.opened.push(file); return Promise.resolve(''); }, showItemInFolder(file) { this.opened.push(file); } };
exports.clipboard = { writeText() {} };
exports.ipcRenderer = new EventEmitter(); exports.ipcRenderer.send = () => {};
exports.ipcRenderer.sendSync = channel => channel === 'state:get' ? exports.bridgeState : {};
exports.setBridgeState = state => { exports.bridgeState = state; };
exports.browserBridge = null;
exports.contextBridge = { exposeInMainWorld: (_name, api) => { exports.browserBridge = api; } };
`;
try {
  await build({
    stdin: { contents: `export { Browser } from './src/main/browser'; export { workspaceStore, sessionStore, libraryStore, settingsStore, flushAllStores } from './src/main/store'; export * as motion from './src/shared/motion'; export * as electron from 'electron'; export { registerMediaProtocol } from './src/main/media'; export { useSidebarGestures } from './src/renderer/useSidebarGestures'; export { useLibraryMotion } from './src/renderer/useLibraryMotion'; export { workspaceSlot } from './src/renderer/useWorkspaceMotion'; export { useSpaceCardDrag } from './src/renderer/useSpaceCardDrag'; export { morphMedia } from './src/renderer/zen/media-morph.js'; export { animateFolderRow } from './src/renderer/zen/folder-motion.js'; export * as gestureTest from 'sidebar-gesture-test'; import './src/preload/chrome';`, resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(directory, 'test.cjs'),
    plugins: [{ name: 'mock-electron', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: mock, loader: 'js' }));
      builder.onResolve({ filter: /^\.\/glass$/ }, () => ({ path: 'glass', namespace: 'glass' }));
      builder.onLoad({ filter: /.*/, namespace: 'glass' }, () => ({ contents: 'export function applyGlass() {} export function setGlassFullscreen() {} export function watchSidebarWheelPhases() { return () => {}; }', loader: 'js' }));
      builder.onResolve({ filter: /^sidebar-gesture-test$/ }, () => ({ path: 'gestures', namespace: 'gestures' }));
      builder.onLoad({ filter: /.*/, namespace: 'gestures' }, () => ({ contents: 'export const calls = []; export const cleanups = []; export const phases = new Set(); export const api = { playHapticFeedback() {}, setLibraryGesture: (...args) => calls.push(args), onSidebarWheelPhase: callback => { phases.add(callback); return () => phases.delete(callback); } };', loader: 'js' }));
      builder.onResolve({ filter: /^\.\/state$/ }, () => ({ path: 'gestures', namespace: 'gestures' }));
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'react' }));
      builder.onLoad({ filter: /.*/, namespace: 'react' }, () => ({ contents: `import { cleanups } from 'sidebar-gesture-test'; export const useRef = current => ({ current }); export const useState = initial => [initial, () => {}]; export const useEffect = callback => { cleanups.push(callback()); }; export const useLayoutEffect = useEffect;`, loader: 'js' }));
    } }],
  });
  const require = createRequire(import.meta.url);
  const { Browser, workspaceStore, sessionStore, libraryStore, settingsStore, flushAllStores, motion, electron, registerMediaProtocol, useSidebarGestures, useLibraryMotion, workspaceSlot, useSpaceCardDrag, morphMedia, animateFolderRow, gestureTest } = require(path.join(directory, 'test.cjs'));
  const sourceManifest = JSON.parse(readFileSync('src/vendor/zen-source.json', 'utf8'));
  assert.equal(createHash('sha256').update(readFileSync('src/vendor/zen-motion.cjs')).digest('hex'), sourceManifest.files['src/zen/vendor/motion.min.mjs'], 'the copied Motion distribution stays byte-identical to the supplied source');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const browser = new Browser({ enabled: true });
  const browsers = [browser];
  const personal = workspaceStore.get().activeWorkspaceId;
  const first = browser.addNewTab('https://example.com/first');
  const essential = browser.addNewTab('https://example.com/essential');
  browser.toggleEssential(essential);
  assert.equal(essential.isEssential, true);
  assert.equal(essential.isPinned, true);
  browser.selectTab(first);
  browser.createWorkspace('Work', '⌘', '#82b5cf');
  const work = workspaceStore.get().activeWorkspaceId;
  browser.reorderWorkspace(work, 0);
  assert.equal(workspaceStore.get().workspaces[0].id, work);
  assert.equal(workspaceStore.get().activeWorkspaceId, work, 'reordering preserves the selected workspace');
  browser.reorderWorkspace(work, -1); browser.reorderWorkspace(work, 0.5); browser.reorderWorkspace('missing', 0);
  assert.equal(workspaceStore.get().workspaces[0].id, work, 'invalid reorder requests cannot change workspace order');
  browser.reorderWorkspace(work, 1);
  assert.equal(workspaceSlot(0, 2, 3), 1, 'the next workspace wraps around the strip');
  assert.equal(workspaceSlot(2, 0, 3), -1, 'the previous workspace stays adjacent at the other edge');
  const workTab = browser.addNewTab('https://example.com/work');
  browser.createFolder('Research');
  const folder = workspaceStore.get().folders[0];
  browser.moveTab(workTab.id, null, work, folder.id);
  assert.equal(workTab.isPinned, true);
  assert.equal(workTab.folderId, folder.id);
  browser.toggleFolder(folder.id);
  assert.equal(workspaceStore.get().folders[0].collapsed, true);
  browser.selectWorkspace(personal);
  assert.equal(browser.activeTabId, first.id, 'each space remembers its active tab');
  browser.selectTab(essential);
  assert.equal(workspaceStore.get().activeWorkspaceId, personal, 'Essentials do not change spaces');
  browser.selectWorkspace(work);
  assert.equal(browser.activeTabId, workTab.id);
  browser.selectTab(essential);
  assert.equal(workspaceStore.get().activeWorkspaceId, work);
  browser.selectTab(workTab);
  browser.closeTab(workTab);
  assert.equal(workTab.isUnloaded, true, 'closing pinned tabs keeps them in the sidebar');
  assert.equal(browser.activeTabId, essential.id, 'closing never selects a tab from a hidden space');
  browser.selectTab(workTab);
  assert.equal(workTab.isUnloaded, false);
  browser.moveTab(workTab.id, null, personal, null);
  assert.equal(browser.activeTabId, essential.id, 'moving the active tab hides its old page');
  assert.equal(workTab.view.visible, false);
  assert.equal(browser.isTrustedSender(workTab.webContents), false);
  assert.equal(browser.isTrustedSender(browser.win.webContents), true);

  electron.setRichMotion(false);
  browser.setAppearance({ sidebarExpanded: true, sidebarWidth: 240, compactMode: false });
  browser.setPageBounds({ x: 240, y: 42, width: 852, height: 700 });
  browser.toggleLibrary('history');
  assert.equal(browser.snapshot().ui.libraryProgress, 1);
  assert.equal(browser.snapshot().ui.libraryWidth, 418);
  assert.equal(essential.view.bounds.x, 418, 'native page starts exactly at the library edge');
  assert.equal(essential.view.bounds.width, 852, 'Zen moves the web surface without resizing it');
  browser.selectLibrarySection('spaces');
  assert.equal(browser.snapshot().ui.libraryWidth, 742, "spaces expand into Zen's horizontal card strip");
  browser.selectLibrarySection('history');
  assert.equal(browser.snapshot().ui.libraryWidth, 418);
  browser.animateLibrary(false);
  assert.equal(essential.view.bounds.x, 240);
  browser.setAppearance({ compactMode: true });
  browser.setPageBounds({ x: 8, y: 42, width: 1084, height: 700 });
  browser.setSidebarPeek(true);
  await tick();
  assert.equal(browser.peekView.visible, true);
  browser.setSidebarPeek(false); browser.setSidebarPeek(false);
  await new Promise(resolve => setTimeout(resolve, 190));
  assert.equal(browser.peekView.visible, false, 'the compact native hit surface is released after the 150ms closing transition, including repeated close requests');
  browser.setSidebarPeek(true); await tick();
  browser.setLibraryGesture(0.4);
  assert.equal(browser.peekView.visible, true, 'compact swipe keeps receiving gesture events');
  const nativeCalls = { bounds: essential.view.boundsCalls, radius: essential.view.radiusCalls, visibility: browser.peekView.visibilityCalls };
  browser.setLibraryGesture(0.4);
  assert.equal(essential.view.boundsCalls, nativeCalls.bounds, 'duplicate motion frames do not rebuild native bounds');
  assert.equal(essential.view.radiusCalls, nativeCalls.radius, 'moving a page does not rebuild its corner mask');
  assert.equal(browser.peekView.visibilityCalls, nativeCalls.visibility, 'a visible compact layer is not re-shown on every frame');
  browser.setLibraryGesture(0.4, true);
  assert.equal(browser.peekView.visible, false, 'the compact hit surface disappears after the gesture');
  assert.equal(essential.view.bounds.x, 418);
  browser.animateLibrary(false);
  assert.equal(browser.snapshot().ui.libraryProgress, 0);
  assert.equal(browser.peekView.visible, false);
  browser.setSidebarPeek(true);
  browser.setLibraryGesture(0.12);
  browser.setLibraryGesture(0.12, false);
  assert.equal(browser.snapshot().ui.sidebarPeek, true, 'a cancelled opening restores the compact sidebar it started from');
  assert.equal(browser.peekView.visible, true, 'the restored compact sidebar still has its native hit surface');
  browser.setSidebarPeek(false);

  electron.setRichMotion(true);
  browser.setSidebarPeek(true);
  browser.setLibraryGesture(0.25);
  browser.setLibraryGesture(0.25, false);
  assert.equal(browser.peekView.visible, true, 'the compact sidebar stays mounted while a cancelled reveal springs back');
  browser.animateLibrary(true);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.ok(browser.snapshot().ui.libraryProgress > 0);
  browser.animateLibrary(false);
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(browser.snapshot().ui.libraryProgress, 0, 'interrupted springs settle and release the layer');
  assert.equal(browser.snapshot().ui.libraryAnimating, false);
  assert.equal(browser.peekView.visible, false);

  browser.recordVisit(first);
  first.title = 'A new title'; browser.recordVisit(first);
  assert.equal(libraryStore.get().history[0].title, 'A new title');
  assert.ok(libraryStore.get().history.length > 0);
  const { EventEmitter } = require('node:events');
  const item = new EventEmitter();
  Object.assign(item, { getFilename: () => 'test.txt', getURL: () => 'https://example.com/test.txt', getTotalBytes: () => 100,
    isPaused: () => false, pause() {}, resume() {}, canResume: () => true, cancel() {}, getSavePath: () => '/tmp/test.txt', getReceivedBytes: () => 100 });
  electron.session.defaultSession.emit('will-download', {}, item);
  item.emit('updated', {}, 'progressing');
  item.emit('done', {}, 'completed');
  const download = libraryStore.get().downloads[0];
  assert.equal(download.status, 'completed');
  assert.equal(download.receivedBytes, 100);
  browser.openDownload(download.id, true);
  assert.deepEqual(electron.shell.opened, ['/tmp/test.txt']);
  browser.openDownload('untrusted-path');
  assert.equal(electron.shell.opened.length, 1);

  const savedDownloads = libraryStore.get().downloads;
  libraryStore.set({ ...libraryStore.get(), downloads: [
    { ...download, id: 'image-a', name: 'a.png', path: '/tmp/a.png' },
    { ...download, id: 'image-b', name: 'b.png', path: '/tmp/b.png' },
    { ...download, id: 'pending', name: 'c.png', path: '/tmp/c.png', status: 'progressing' },
    ...savedDownloads,
  ] });
  electron.setRichMotion(false); browser.animateLibrary(true);
  const origin = { x: 130, y: 140, width: 100, height: 80 };
  browser.previewDownload('pending', origin); browser.previewDownload('image-a', { ...origin, x: NaN });
  assert.equal(browser.snapshot().ui.mediaPreview, null, 'incomplete downloads and invalid geometry cannot open a preview');
  const pageBeforePreview = { ...browser.activeTab.view.bounds };
  browser.previewDownload('image-a', origin);
  const preview = browser.mediaPreviewView;
  preview.webContents.emit('did-finish-load');
  assert.equal(preview.visible, true); assert.equal(browser.isTrustedSender(preview.webContents), true);
  assert.deepEqual(preview.bounds, { x: 0, y: 0, width: 1100, height: 750 }, 'the preview is above all page/library layers and centered in the whole window');
  assert.deepEqual(browser.activeTab.view.bounds, pageBeforePreview, 'opening Media preview preserves the native webpage geometry');
  browser.stepMediaPreview(1); browser.stepMediaPreview(1); browser.stepMediaPreview(0);
  assert.equal(browser.snapshot().ui.mediaPreview.id, 'image-b', 'media navigation stops at the last completed media file');
  browser.closeMediaPreview();
  assert.equal(preview.webContents.isDestroyed(), true, 'closing a preview frees its renderer');
  assert.equal(browser.isTrustedSender(preview.webContents), false, 'the closed preview loses bridge access');
  assert.equal(browser.mediaPreviewView, null);
  browser.previewDownload('image-a', origin); browser.animateLibrary(false);
  assert.equal(browser.snapshot().ui.mediaPreview, null, 'closing Library also removes any preview overlay');
  electron.setRichMotion(true);

  registerMediaProtocol();
  const request = url => electron.mediaHandler({ url, headers: new Headers() });
  assert.equal((await request('browser-media://download/image-a')).status, 200);
  assert.equal(electron.mediaRequests[0][0], 'file:///tmp/a.png');
  for (const url of ['browser-media://download/pending', 'browser-media://download/missing', 'browser-media://download/%2Ftmp%2Fsecret.png', 'browser-media://elsewhere/image-a', 'browser-media://download/image-a?path=/tmp/secret.png']) assert.equal((await request(url)).status, 404);
  assert.equal(electron.mediaRequests.length, 1, 'the internal protocol only serves completed media by trusted download ID');
  libraryStore.set({ ...libraryStore.get(), downloads: savedDownloads });

  const autoItem = new EventEmitter();
  for (const [key, value] of Object.entries(item)) if (typeof value === 'function') autoItem[key] = value;
  Object.assign(autoItem, { getFilename: () => 'auto.txt', getSavePath: () => '/tmp/auto.txt' });
  electron.session.defaultSession.emit('will-download', {}, autoItem); autoItem.emit('updated', {}, 'progressing');
  const autoId = libraryStore.get().downloads[0].id;
  browser.openDownload(autoId);
  assert.equal(libraryStore.get().downloads[0].openWhenDone, true);
  assert.equal(electron.shell.opened.length, 1, 'an incomplete file is never launched');
  autoItem.emit('done', {}, 'completed');
  assert.equal(electron.shell.opened.at(-1), '/tmp/auto.txt', 'a download marked for opening launches after completion');
  libraryStore.set({ ...libraryStore.get(), downloads: savedDownloads });

  browser.selectWorkspace(personal);
  browser.selectTab(first);
  browser.saveBoost({ name: 'Dark reading', domain: 'example.com', css: 'body { background: black !important; }', enabled: true });
  await tick();
  const boost = libraryStore.get().boosts[0];
  assert.equal(boost.domain, 'example.com');
  assert.ok(first.webContents.css.some(css => css?.includes('background: black')));
  browser.toggleBoost(boost.id);
  await tick();
  assert.equal(libraryStore.get().boosts[0].enabled, false);
  assert.ok(first.webContents.css.every(css => css === null), 'disabling a boost removes its CSS from loaded pages');
  browser.saveBoost({ name: 'Invalid', domain: '', css: '', enabled: true });
  assert.equal(libraryStore.get().boosts.length, 1);
  browser.saveBoost({ name: 'Blue reading', domain: 'example.com', css: 'body { color: blue !important; }', enabled: true });
  assert.equal(libraryStore.get().boosts.filter(boost => boost.enabled).length, 1);
  await tick();
  const contentBounds = { ...browser.activeTab.view.bounds };
  browser.openInterfacePanel('address', origin);
  const interfaceView = browser.interfaceView;
  interfaceView.webContents.emit('did-finish-load');
  assert.deepEqual(interfaceView.bounds, { x: 0, y: 0, width: 1100, height: 750 }, 'address and menu panels cover the window above native webpages');
  assert.equal(interfaceView.visible, true);
  assert.equal(browser.isTrustedSender(interfaceView.webContents), true);
  assert.deepEqual(browser.activeTab.view.bounds, contentBounds, 'opening a popover does not resize or reload its page');
  browser.openInterfacePanel('theme');
  assert.equal(browser.interfaceView, interfaceView, 'switching popover content reuses its renderer');
  browser.closeInterfacePanel();
  assert.equal(interfaceView.webContents.isDestroyed(), true, 'dismissed popovers release the renderer');
  assert.equal(browser.isTrustedSender(interfaceView.webContents), false);
  browser.openInterfacePanel('address'); browser.animateLibrary(true);
  assert.equal(browser.snapshot().ui.interfacePanel, null, 'Library replaces address/menu popovers');
  browser.openInterfacePanel('unsafe'); assert.equal(browser.snapshot().ui.interfacePanel, null, 'unknown panels cannot be opened');
  browser.updateWorkspace(personal, { icon: 'zen:game-controller.svg' });
  assert.equal(browser.snapshot().workspaces.find(space => space.id === personal).icon, 'zen:game-controller.svg', 'source SVG IDs survive the old emoji-length limit');
  const sourceTheme = { colors: [{ c: [75, 231, 210], position: { x: 147, y: 195 }, isPrimary: true, algorithm: 'floating' }], opacity: .6, texture: .2, scheme: 'dark' };
  browser.setWorkspaceTheme(personal, sourceTheme);
  assert.deepEqual(browser.snapshot().workspaces.find(space => space.id === personal).theme, { ...sourceTheme, colors: [{ ...sourceTheme.colors[0], isCustom: false, type: undefined, lightness: 50 }] });
  browser.setWorkspaceTheme(personal, { ...sourceTheme, colors: [{ ...sourceTheme.colors[0], c: 'url(file:///private/data)' }] });
  assert.equal(browser.snapshot().workspaces.find(space => space.id === personal).theme.colors[0].c[0], 75, 'theme colors cannot introduce arbitrary resources');
  browser.setAppearance({ toolbarItems: ['theme', 'menu', 'menu', 'unknown'] });
  assert.deepEqual(browser.snapshot().appearance.toolbarItems, ['theme', 'menu'], 'toolbar customization is ordered, deduplicated and validated');
  browser.prepareToQuit(); flushAllStores();
  assert.equal(sessionStore.get().tabs.find(tab => tab.id === essential.id).isEssential, true);
  const restored = new Browser({ enabled: true }); browsers.push(restored);
  assert.equal(restored.activeTabId, first.id, 'stable tab IDs survive restoration');
  assert.equal(restored.tabs.find(tab => tab.id === workTab.id).workspaceId, personal);
  assert.equal(restored.tabs.find(tab => tab.id === essential.id).isEssential, true);
  assert.equal(libraryStore.get().boosts.length, 2, 'site boosts survive restoration');
  assert.equal(workspaceStore.get().folders[0].collapsed, true);
  restored.clearHistory();
  assert.equal(libraryStore.get().history.length, 0);
  for (const entry of browsers) entry.prepareToQuit();
  await tick(); flushAllStores();
  for (const initial of [0, 0.3, 1.2]) {
    const spring = motion.createLibrarySpring(initial, 1);
    let position = initial;
    for (let frame = 0; frame < 180; frame++) {
      position = spring.next(frame * 1000 / 60).value;
    }
    assert.ok(Math.abs(position - 1) < 0.001);
  }
  assert.ok(Math.abs(motion.createLibrarySpring(0, 1).next(100).value - 0.7991326975217768) < 1e-12, 'Library uses the original Zen Motion spring distribution');
  assert.ok(motion.createLibrarySpring(0, 1).next(200).value > 1, 'the source spring retains its slight natural overshoot');
  assert.equal(motion.swipeAction(false, 0, 3, 30), 'library');
  assert.equal(motion.swipeAction(false, 1, 3, 30), 'space');
  assert.equal(motion.swipeAction(false, 2, 3, -30), 'add');
  assert.equal(motion.swipeAction(true, 1, 3, -30), 'library');
  assert.equal(motion.librarySwipeTarget(false, 0.1, 0), false, 'short library swipes cancel');
  assert.equal(motion.librarySwipeTarget(false, 0.3, 0), true);
  assert.equal(motion.librarySwipeTarget(true, -0.3, 0), false);
  assert.equal(motion.librarySwipeTarget(true, -0.3, 0, true), true);
  assert.equal(motion.librarySwipeTarget(false, 0.1, 1), true, 'fast flicks contribute to swipe success');
  assert.equal(motion.dampProgress(0.5), 0.5);
  assert.ok(motion.dampProgress(2) > 1 && motion.dampProgress(2) < 1.2);
  assert.ok(motion.dampProgress(-1) < 0 && motion.dampProgress(-1) > -0.2);

  let carry = 0, translation = 0;
  for (const delta of [20, 20, 12, 8, 4, 2, 1, 0]) {
    const next = motion.advanceSidebarSwipe(carry, delta, 240);
    assert.ok(next.translation >= translation, 'a decelerating one-direction wheel gesture never moves backwards or flickers opacity');
    ({ carry, translation } = next);
  }
  const reversed = motion.advanceSidebarSwipe(carry, -20, 240);
  assert.ok(reversed.translation < translation, 'reversing a swipe responds immediately');
  for (const initial of [-0.015, 0.43, 1.015]) {
    assert.ok(Math.abs(motion.librarySwipeProgress(initial, 0, 240) - initial) < 1e-12, 'taking over spring overshoot does not redamp its visible position');
    assert.ok(Math.abs(motion.librarySwipeProgress(initial, 0.001, 240) - initial) < 0.00001, 'the first moving frame also stays continuous');
  }
  for (const libraryWidth of [418, 742, 1045]) {
    let previous = 1;
    let lastStretch = 0;
    for (const drag of [10, 30, 60, 120, 240, 480, 960, 1920]) {
      const progress = motion.librarySwipeProgress(1, drag, 240, libraryWidth);
      const stretch = (progress - 1) * libraryWidth;
      assert.ok(stretch > 0 && stretch <= 12 + 1e-9, 'an open Library stretches at most 12px, including wide Spaces panels');
      assert.ok(progress >= previous, 'outward pull remains monotonic');
      if (drag >= 120) assert.ok(stretch - lastStretch < lastStretch, 'doubling a longer pull adds less stretch than the preceding pull');
      previous = progress; lastStretch = stretch;
    }
    assert.ok(motion.librarySwipeProgress(0, -1920, 240, libraryWidth) * libraryWidth >= -12, 'the closed edge has the same bounded resistance');
    const spring = motion.createLibrarySpring(previous, 1);
    let position = previous;
    for (let frame = 0; frame < 90; frame++) position = spring.next(frame * 1000 / 60).value;
    assert.ok(Math.abs(position - 1) < 0.001, 'releasing outward stretch returns to the open edge');
  }
  assert.equal(motion.librarySwipeProgress(1, -120, 240), 0.6, 'closing an open Library follows the gesture without outward-edge resistance');

  // Exercise the actual gesture handler while Library is halfway through
  // opening. Restarting from libraryOpen=1 would visibly jump to its edge.
  const previousGlobals = Object.fromEntries(['window', 'Element', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  const frames = new Map(); let frameId = 0;
  const listeners = new Map();
  globalThis.Element = class { closest() { return null; } };
  const target = new Element();
  target.addEventListener = (name, callback) => listeners.set(name, callback);
  target.removeEventListener = name => listeners.delete(name);
  target.setPointerCapture = () => {};
  globalThis.window = { innerWidth: 1100, addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  try {
    const state = browser.snapshot();
    state.ui = { ...state.ui, libraryOpen: true, libraryProgress: 0.43, libraryAnimating: true };
    gestureTest.api.getState = () => state;
    useSidebarGestures({ current: target }, state);
    listeners.get('wheel')({ ctrlKey: false, target, deltaX: -10, deltaY: 0, deltaMode: 0, preventDefault() {} });
    for (const callback of frames.values()) callback(); frames.clear();
    assert.ok(gestureTest.calls.at(-1)[0] > 0.43 && gestureTest.calls.at(-1)[0] < 0.48, 'an interrupted opening continues from its current visible position');
    await new Promise(resolve => setTimeout(resolve, 135));
    gestureTest.calls.length = 0;
    listeners.get('pointerdown')({ pointerType: 'touch', clientX: 0, pointerId: 1 });
    listeners.get('pointermove')({ clientX: 10 });
    for (const callback of frames.values()) callback(); frames.clear();
    await new Promise(resolve => setTimeout(resolve, 135));
    assert.equal(gestureTest.calls.length, 1, 'a held touch does not settle after a pause in movement');
    listeners.get('pointerup')();
    assert.equal(typeof gestureTest.calls.at(-1)[1], 'boolean', 'release settles the held touch');
    gestureTest.calls.length = 0;
    state.ui = { ...state.ui, libraryOpen: true, libraryProgress: 1, libraryWidth: 742 };
    window.innerWidth = 264; // Compact Peek's native view is narrower than Library.
    for (const deltaX of [-60, -120, -240, -500]) {
      listeners.get('wheel')({ ctrlKey: false, target, deltaX, deltaY: 0, deltaMode: 0, preventDefault() {} });
      for (const callback of frames.values()) callback(); frames.clear();
      const progress = gestureTest.calls.at(-1)[0];
      assert.ok(progress > 1 && (progress - 1) * 742 <= 12 + 1e-9, 'the wheel handler uses the actual Library width to bound outward stretch');
    }
    const pulled = gestureTest.calls.at(-1)[0];
    listeners.get('wheel')({ ctrlKey: false, target, deltaX: 80, deltaY: 0, deltaMode: 0, preventDefault() {} });
    for (const callback of frames.values()) callback(); frames.clear();
    assert.ok(gestureTest.calls.at(-1)[0] < pulled, 'reversing an outward pull responds immediately');
    await new Promise(resolve => setTimeout(resolve, 135));
    assert.equal(gestureTest.calls.at(-1)[1], true, 'an outward swipe keeps the already-open Library open');
    gestureTest.calls.length = 0;
    const phase = (value, momentum = false) => { for (const callback of gestureTest.phases) callback({ phase: value, momentum }); };
    const wheel = deltaX => listeners.get('wheel')({ ctrlKey: false, target, deltaX, deltaY: 0, deltaMode: 0, preventDefault() {} });
    phase('began'); wheel(60);
    for (const callback of frames.values()) callback(); frames.clear();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(gestureTest.calls.length, 1, 'a native trackpad gesture stays active while fingers pause');
    phase('ended');
    assert.equal(typeof gestureTest.calls.at(-1)[1], 'boolean', 'native finger release settles without a debounce delay');
    const settledCount = gestureTest.calls.length;
    phase('changed', true); wheel(400);
    for (const callback of frames.values()) callback(); frames.clear();
    assert.equal(gestureTest.calls.length, settledCount, 'trackpad inertia cannot start another Library pull');
    phase('began'); wheel(-80); phase('cancelled');
    assert.equal(gestureTest.calls.at(-1)[1], true, 'a cancelled native closing swipe restores its starting state');

    let haptics = 0;
    gestureTest.api.playHapticFeedback = () => haptics++;
    state.activeWorkspaceId = state.workspaces.at(-1).id;
    state.ui = { ...state.ui, libraryOpen: false, libraryProgress: 0 };
    phase('began'); wheel(150); wheel(100); wheel(-100); phase('cancelled');
    assert.equal(haptics, 2, 'new-space haptics fire only when readiness changes, including reversal');

    const reordered = [];
    gestureTest.api.reorderWorkspace = (...args) => reordered.push(args);
    const dragListeners = new Map();
    const cards = [0, 1, 2].map(index => {
      const attributes = new Map(), classes = new Set();
      return { dataset: { workspaceId: 'space-' + index }, style: {},
        classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
        getAttribute: key => attributes.get(key), getBoundingClientRect: () => ({ left: index * 266, width: 242 }) };
    });
    let scrolled = 0;
    const list = { get scrollLeft() { return scrolled; }, set scrollLeft(value) { scrolled = Math.max(0, Math.min(274, value)); }, classList: { add() {}, remove() {} }, querySelectorAll: () => cards,
      getBoundingClientRect: () => ({ left: 0, right: 500 }),
      addEventListener: (key, callback) => dragListeners.set(key, callback), removeEventListener: key => dragListeners.delete(key) };
    const handle = { closest: selector => selector === '.library-space-drag' ? handle : cards[0],
      setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true };
    const pointer = (type, x, id = 6) => dragListeners.get(type)({ type, clientX: x, pointerId: id, button: 0, target: handle, preventDefault() {}, stopPropagation() {} });
    useSpaceCardDrag({ current: list }, true, 'space-0,space-1,space-2');
    pointer('pointerdown', 20); pointer('pointermove', 600);
    assert.equal(cards[1].getAttribute('shift'), 'left'); assert.equal(cards[2].getAttribute('shift'), 'left', 'dragging across two spaces shifts both adjacent cards');
    pointer('pointermove', 900, 7);
    assert.equal(cards[0].style.translate, '580px 0', 'a second touch cannot take over a captured card');
    pointer('pointermove', 900);
    const batch = [...frames.values()]; frames.clear(); for (const callback of batch) callback();
    assert.equal(list.scrollLeft, 12, 'dragging near the strip edge auto-scrolls at the source speed');
    pointer('pointerup', 900);
    assert.deepEqual(reordered, [['space-0', 2]], 'pointer release commits one workspace reorder');
    assert.equal(cards[0].style.translate, '');
    pointer('pointerdown', 20); pointer('pointermove', 600); pointer('pointercancel', 600);
    assert.equal(reordered.length, 1, 'cancelling card drag restores layout without changing persisted order');
  } finally {
    for (const cleanup of gestureTest.cleanups) cleanup?.();
    Object.assign(globalThis, previousGlobals);
  }
  electron.setBridgeState(browser.snapshot());
  const bridge = electron.browserBridge;
  let renders = 0, motionFrames = 0;
  const stopState = bridge.onState(() => renders++);
  const stopMotion = bridge.onLibraryMotion(() => motionFrames++);
  const startUI = { ...bridge.getState().ui, libraryAnimating: true, libraryGestureActive: true };
  for (let frame = 0; frame < 30; frame++) {
    electron.ipcRenderer.emit('library:motion', {}, { ...startUI, libraryProgress: frame / 30 });
  }
  assert.equal(motionFrames, 30, 'every frame reaches the composited motion layers');
  assert.equal(renders, 1, 'thirty motion frames trigger one state render, not thirty history/tab list renders');
  assert.equal(bridge.getState().ui.libraryProgress, 29 / 30, 'gesture interruption reads the latest progress without a React render');
  electron.ipcRenderer.emit('library:motion', {}, { ...startUI, libraryGestureActive: false, libraryAnimating: false, libraryOpen: true, libraryProgress: 1 });
  assert.equal(renders, 2, 'settling updates interactive state');
  const resized = { ...bridge.getState(), ui: { ...bridge.getState().ui, libraryWidth: 560 } };
  electron.ipcRenderer.emit('state', {}, resized);
  assert.equal(motionFrames, 32, 'full state changes also reach motion layers, including manual library resizing');
  stopState(); stopMotion();

  const savedWindow = globalThis.window;
  try {
    const records = [];
    const node = (name, box) => ({ getBoundingClientRect: () => box,
      animate: (frames, options) => { records.push({ name, frames, options }); return { finished: Promise.resolve() }; } });
    const media = node('media', { left: 140, top: 130, width: 320, height: 200 });
    const parts = { panel: node('panel', { left: 100, top: 80, width: 400, height: 300 }), backdrop: node('backdrop', {}), header: node('header', {}), stage: node('stage', {}) };
    parts.stage.querySelector = () => media;
    globalThis.window = { getComputedStyle: () => ({ backgroundColor: '#18161b', borderTopColor: '#333', boxShadow: '0 8px 16px black' }) };
    const origin = { x: 10, y: 20, width: 80, height: 50 };
    morphMedia(parts, origin, true);
    const morph = records.find(record => record.name === 'panel' && record.frames[0].transform);
    assert.equal(morph.frames[0].transform, 'translate(-250px, -185px) scale(0.25)', 'the media morph starts at the thumbnail, relative to the full-window panel');
    assert.equal(morph.options.duration, 250); assert.equal(morph.options.easing, 'cubic-bezier(0.22, 1, 0.36, 1)');
    assert.equal(records.find(record => record.name === 'header').frames[1].offset, 0.3, 'preview chrome hands over after the source threshold');
    records.length = 0; morphMedia(parts, origin, false);
    assert.equal(records.find(record => record.name === 'backdrop').frames[1].offset, 0.25, 'closing removes the dialog surfaces before the image returns');

    const styles = new Map(); let interpolated = null;
    const animations = [];
    const row = { style: { removeProperty: key => styles.delete(key), setProperty: (key, value) => styles.set(key, value) }, getBoundingClientRect: () => ({ height: 36 }),
      animate(frames, options) {
        let resolve, reject;
        const animation = { frames, options, finished: new Promise((yes, no) => { resolve = yes; reject = no; }), finish: () => { interpolated = null; resolve(); }, cancel: () => { interpolated = null; reject(new Error('Replaced')); } };
        animations.push(animation); return animation;
      } };
    const natural = { height: '36px', opacity: '1', minHeight: '0px' };
    globalThis.window = { getComputedStyle: () => new Proxy({}, { get: (_target, key) => interpolated?.[key] ?? styles.get(key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())) ?? natural[key] }) };
    const collapsing = animateFolderRow(row, { height: 0, opacity: 0 }, { duration: 0.18, ease: 'easeInOut' });
    interpolated = { height: '18px', opacity: '0.5' };
    const expanding = animateFolderRow(row, { height: '', opacity: '' }, { duration: 0.18, ease: 'easeInOut' });
    assert.equal(animations[1].frames[0].height, '18px', 'reversing folder animation starts at its currently displayed height');
    assert.equal(animations[1].frames[1].height, '36px');
    assert.equal(animations[1].options.duration, 180); assert.equal(animations[1].options.easing, 'ease-in-out');
    animations[1].finish();
    assert.equal(await collapsing, false); assert.equal(await expanding, true);
    assert.equal(styles.has('height'), false, 'expanded rows return to natural layout after animation');
  } finally { globalThis.window = savedWindow; }

  const motionGlobals = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  const elements = Object.fromEntries(['.topbar', '.page', '.sidebar-slot', '.zen-library', '.peek'].map(selector => [selector, { style: {} }]));
  const paintFrames = new Map(); let paintId = 0;
  globalThis.window = { innerWidth: 1100, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { querySelector: selector => elements[selector] };
  globalThis.requestAnimationFrame = callback => { paintFrames.set(++paintId, callback); return paintId; };
  globalThis.cancelAnimationFrame = id => paintFrames.delete(id);
  try {
    gestureTest.api.getState = bridge.getState;
    gestureTest.api.onLibraryMotion = bridge.onLibraryMotion;
    const offset = useLibraryMotion(bridge.getState());
    for (let frame = 0; frame < 30; frame++) {
      electron.ipcRenderer.emit('library:motion', {}, { ...startUI, libraryWidth: 418, libraryProgress: frame / 30 });
    }
    assert.equal(paintFrames.size, 1, 'motion bursts schedule a single compositor update');
    for (const callback of paintFrames.values()) callback(); paintFrames.clear();
    const sidebarSize = resized.appearance.compactMode ? 8 : resized.appearance.sidebarExpanded ? resized.appearance.sidebarWidth : 56;
    const expected = Math.round((418 - sidebarSize) * 29 / 30);
    assert.equal(offset.current, expected);
    assert.equal(elements['.page'].style.transform, `translateX(${expected}px)`, 'chrome uses the same integer geometry as native views');
    assert.equal(elements['.zen-library'].style.width, '418px');
    electron.ipcRenderer.emit('state', {}, resized);
    for (const callback of paintFrames.values()) callback(); paintFrames.clear();
    assert.equal(elements['.zen-library'].style.width, '560px', 'manual resize reaches the rendered library');
  } finally {
    for (const cleanup of gestureTest.cleanups.splice(0)) cleanup?.();
    Object.assign(globalThis, motionGlobals);
  }
  assert.equal(settingsStore.get().sidebarWidth, 240);
  console.log('Passed: space isolation and restoration, Essentials, folders, native layer geometry, interrupted library springs and swipes, held touch gestures, compact gesture continuity, gesture resistance and thresholds, history, downloads and site boosts.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
