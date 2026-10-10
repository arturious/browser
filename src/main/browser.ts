import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeImage,
  screen,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { clampSidebarWidth, SIDEBAR_WIDTH, type Appearance, type AppState, type ChromeCommand, type Rect, type UIState } from '../shared/types';
import { resolveInput } from '../shared/url';
import type { AdBlocker } from './adblock';
import { showPageContextMenu } from './context-menu';
import { applyGlass, setGlassFullscreen } from './glass';
import { CHROME_PRELOAD, RENDERER_HTML } from './paths';
import { sessionStore, settingsStore, windowStore } from './store';
import { Tab, type TabHost } from './tab';

/** A background tab untouched this long is unloaded to free its renderer. */
const IDLE_SUSPEND_TIMEOUT = 20 * 60 * 1000;
const NEW_TAB_URL = 'https://www.google.com';

/** The browser's own interface runs in its own session, apart from web pages (and their ad blocking). */
export function chromeWebPreferences(): WebPreferences {
  return {
    preload: CHROME_PRELOAD,
    partition: 'chrome',
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    // Keeps drawing while the window is minimized, so it's all there the
    // moment the window comes back.
    backgroundThrottling: false,
  };
}

/**
 * The last window size and position, unless it's no longer on any screen
 * (say, a monitor was unplugged).
 */
function savedWindowBounds() {
  const { bounds } = windowStore.get();
  if (!bounds) return null;
  const visible = screen.getAllDisplays().some(({ workArea: area }) =>
    bounds.x < area.x + area.width && bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height && bounds.y + bounds.height > area.y,
  );
  return visible ? bounds : null;
}

/**
 * The one browser window: the chrome (React, filling the window), one
 * WebContentsView per tab placed where the chrome leaves room for the page,
 * and, in compact mode, a transparent view on top for the sidebar sliding
 * out over the page.
 */
export class Browser implements TabHost {
  readonly win: BrowserWindow;
  private readonly peekView: WebContentsView;
  private peekHideTimer: NodeJS.Timeout | null = null;
  private readonly extraRenderers = new Set<WebContents>();

  tabs: Tab[] = [];
  activeTabId: string | null = null;
  private ui: UIState = { sidebarPeek: false, isHtmlFullscreen: false, isWindowFullscreen: false };
  private pageBounds: Rect = { x: 64, y: 42, width: 1028, height: 700 };
  private pipTabId: string | null = null;
  private fullscreenForHtml = false;
  private broadcastScheduled = false;
  private closing = false;
  private readonly idleTimer: NodeJS.Timeout;

  constructor(private readonly adBlocker: AdBlocker) {
    const saved = savedWindowBounds();
    this.win = new BrowserWindow({
      ...(saved ?? { width: 1100, height: 750, center: true }),
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'Browser',
      // Keeps a real titled window (native edge resizing) with the title
      // bar hidden; the top bar is the drag area. The traffic lights sit in
      // it (placed by placeTrafficLights), and the overlay tells the
      // interface where they end.
      titleBarStyle: 'hidden',
      titleBarOverlay: true,
      // See-through, with Liquid Glass put behind the content by
      // applyGlass below.
      transparent: true,
      backgroundColor: '#00000000',
      // In dark mode macOS draws a light hairline around every window as
      // part of its shadow; it can't be recolored, only dropped with it.
      hasShadow: false,
      webPreferences: chromeWebPreferences(),
    });
    this.placeTrafficLights();
    applyGlass(this.win);
    void this.win.loadFile(RENDERER_HTML, { query: { view: 'chrome' } });
    this.win.once('ready-to-show', () => this.win.show());

    this.peekView = new WebContentsView({ webPreferences: chromeWebPreferences() });
    this.peekView.setBackgroundColor('#00000000');
    this.peekView.setVisible(false);
    void this.peekView.webContents.loadFile(RENDERER_HTML, { query: { view: 'sidebar' } });
    this.win.contentView.addChildView(this.peekView);


    this.win.on('resize', () => {
      this.layout();
      this.saveWindowBounds();
    });
    this.win.on('move', () => this.saveWindowBounds());
    this.win.on('close', () => {
      this.closing = true;
    });
    // Fullscreen hides the traffic lights (the toolbar moves back left) and
    // changes the content size.
    this.win.on('enter-full-screen', () => {
      setGlassFullscreen(this.win, true);
      this.setUI({ isWindowFullscreen: true });
    });
    this.win.on('leave-full-screen', () => {
      setGlassFullscreen(this.win, false);
      this.setUI({ isWindowFullscreen: false });
    });

    this.restoreSession();
    // Not time-critical (idle is measured in tens of minutes), so a coarse
    // timer that doesn't keep the process awake is plenty.
    this.idleTimer = setInterval(() => this.suspendIdleTabs(), 60_000);
    this.idleTimer.unref();
  }

  get activeTab(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeTabId);
  }

  /** Renderers allowed to drive the browser over IPC: the chrome, the compact sidebar, settings. */
  isTrustedSender(sender: WebContents): boolean {
    return sender === this.win.webContents || sender === this.peekView.webContents || this.extraRenderers.has(sender);
  }

  addRenderer(wc: WebContents): void {
    this.extraRenderers.add(wc);
    wc.once('destroyed', () => this.extraRenderers.delete(wc));
  }

  tabFor(sender: WebContents): Tab | undefined {
    return this.tabs.find((tab) => tab.view?.webContents === sender);
  }

  // MARK: State

  snapshot(): AppState {
    return {
      tabs: this.tabs.map((tab) => tab.state()),
      activeTabId: this.activeTabId,
      adBlockEnabled: this.adBlocker.enabled,
      appearance: this.appearance,
      ui: this.ui,
    };
  }

  /** Coalesces every change made in the same tick into one state broadcast. */
  changed(): void {
    if (this.broadcastScheduled) return;
    this.broadcastScheduled = true;
    setImmediate(() => {
      this.broadcastScheduled = false;
      const state = this.snapshot();
      for (const wc of [this.win.webContents, this.peekView.webContents, ...this.extraRenderers]) {
        if (!wc.isDestroyed()) wc.send('state', state);
      }
      this.layout();
      // Addresses and titles change all the time; the store debounces writes.
      this.persistSession();
    });
  }

  command(command: ChromeCommand): void {
    this.win.webContents.focus();
    this.win.webContents.send('command', command);
  }

  private setUI(patch: Partial<UIState>): void {
    this.ui = { ...this.ui, ...patch };
    this.changed();
  }

  private saveWindowBounds(): void {
    // Normal bounds: what the window returns to when it leaves fullscreen.
    if (!this.win.isDestroyed()) windowStore.set({ bounds: this.win.getNormalBounds() });
  }

  // MARK: Layout

  setPageBounds(rect: Rect): void {
    this.pageBounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.layout();
  }

  private layout(): void {
    if (this.win.isDestroyed()) return;
    const [width, height] = this.win.getContentSize();
    const full = { x: 0, y: 0, width, height };
    for (const tab of this.tabs) {
      if (!tab.view) continue;
      const fullscreen = this.ui.isHtmlFullscreen && tab.id === this.activeTabId;
      tab.view.setBounds(fullscreen ? full : this.pageBounds);
      tab.view.setBorderRadius(fullscreen ? 0 : 8);
    }

    // Compact mode's sidebar floats over the page's left edge, in line with
    // it; the view leaves room on the right for the panel's shadow.
    const { sidebarExpanded, sidebarWidth, compactMode } = this.appearance;
    if (compactMode && this.ui.sidebarPeek && !this.ui.isHtmlFullscreen) {
      const width = sidebarExpanded ? sidebarWidth : SIDEBAR_WIDTH.collapsed;
      this.peekView.setBounds({ x: this.pageBounds.x, y: this.pageBounds.y, width: width + 24, height: this.pageBounds.height });
      this.peekView.setVisible(true);
    } else if (!compactMode || this.ui.isHtmlFullscreen || !this.peekHideTimer) {
      // Closed and not sliding away: never leave the (transparent) view
      // over the page, where it would block clicks.
      this.peekView.setVisible(false);
    }

  }

  attach(_tab: Tab, view: WebContentsView): void {
    this.win.contentView.addChildView(view);
    // Re-adding moves the compact sidebar back above the new page.
    this.win.contentView.addChildView(this.peekView);
    this.layout();
  }

  detach(view: WebContentsView): void {
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
  }

  private updateVisibility(): void {
    for (const tab of this.tabs) {
      const active = tab.id === this.activeTabId;
      tab.view?.setVisible(active);
      // Chromium stops rendering a page once its window is minimized, and
      // after restoring, video and animations stay blank for a moment until
      // it catches up. The active tab keeps rendering; background tabs are
      // still throttled.
      tab.webContents?.setBackgroundThrottling(!active);
    }
  }

  // MARK: Session

  private restoreSession(): void {
    const { tabs, activeIndex } = sessionStore.get();
    const active = activeIndex !== null && tabs[activeIndex] ? activeIndex : 0;
    tabs.forEach((saved, index) => {
      // A pinned tab always reopens at its pinned address. Only the tab
      // about to become active loads now; the rest load when selected.
      const url = saved.isPinned ? (saved.pinnedURL ?? saved.url) : saved.url;
      const tab = new Tab(this, url, { deferLoad: index !== active });
      if (saved.isPinned) {
        tab.isPinned = true;
        tab.pinnedURL = saved.pinnedURL ?? saved.url;
        tab.pinnedTitle = saved.pinnedTitle;
      }
      this.tabs.push(tab);
    });
    if (this.tabs[active]) this.activate(this.tabs[active]);
  }

  persistSession(): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    sessionStore.set({
      tabs: this.tabs.map((tab) => ({
        url: tab.url,
        isPinned: tab.isPinned,
        pinnedURL: tab.pinnedURL,
        pinnedTitle: tab.pinnedTitle,
      })),
      activeIndex: index >= 0 ? index : null,
    });
  }

  // MARK: Tabs

  addNewTab(url = NEW_TAB_URL, activate = true): Tab {
    const tab = new Tab(this, url);
    this.tabs.unshift(tab);
    if (activate) this.selectTab(tab);
    this.persistSession();
    this.changed();
    return tab;
  }

  openTab(url: string, background: boolean): void {
    this.addNewTab(url, !background);
  }

  adoptPopup(opener: Tab, options: BrowserWindowConstructorOptions): WebContents {
    const tab = new Tab(this, 'about:blank', { popup: options });
    const index = this.tabs.indexOf(opener);
    this.tabs.splice(index >= 0 ? index : 0, 0, tab);
    this.selectTab(tab);
    return tab.view!.webContents;
  }

  closeTab(tab: Tab): void {
    const index = this.tabs.indexOf(tab);
    if (index < 0) return;
    this.exitPiPIfShowing(tab);

    // Closing a pinned tab only unloads the page; its sidebar icon stays.
    if (tab.isPinned) {
      tab.unload();
      if (this.activeTabId === tab.id) {
        const next = this.tabs.find((other) => other !== tab);
        if (next) this.selectTab(next);
        else this.activeTabId = null;
      }
      this.persistSession();
      this.changed();
      return;
    }

    tab.destroyView();
    this.tabs.splice(index, 1);
    if (this.activeTabId === tab.id) {
      if (this.tabs.length) this.selectTab(this.tabs[Math.min(index, this.tabs.length - 1)]);
      else this.activeTabId = null;
    }
    this.persistSession();
    this.changed();
  }

  closedByPage(tab: Tab): void {
    // Every page is torn down while the window closes or the app quits;
    // that must not wipe the session.
    if (this.closing) return;
    this.closeTab(tab);
  }

  /** Pinning moves the tab to the very top, above the sidebar's "+" button. */
  togglePin(tab: Tab): void {
    tab.isPinned = !tab.isPinned;
    if (tab.isPinned) {
      tab.pinnedURL = tab.url;
      tab.pinnedTitle = tab.title;
      tab.pinnedFavicon = tab.favicon;
      this.tabs.splice(this.tabs.indexOf(tab), 1);
      this.tabs.unshift(tab);
    } else {
      tab.pinnedURL = null;
      tab.pinnedTitle = null;
      tab.pinnedFavicon = null;
    }
    this.persistSession();
    this.changed();
  }

  selectTab(tab: Tab): void {
    if (this.pipTabId === tab.id) this.exitPiPIfShowing(tab);
    this.activate(tab);
  }

  selectTabAt(index: number): void {
    const tab = this.tabs[index];
    if (tab) this.selectTab(tab);
  }

  private activate(tab: Tab): void {
    tab.reloadIfUnloaded();
    tab.lastAccessedAt = Date.now();
    this.activeTabId = tab.id;
    this.updateVisibility();
    tab.webContents?.focus();
    this.persistSession();
    this.changed();
  }

  navigate(input: string, inNewTab: boolean): void {
    const url = resolveInput(input);
    if (!url) return;
    const tab = this.activeTab;
    if (inNewTab || !tab) this.addNewTab(url);
    else tab.navigate(url);
    this.persistSession();
  }

  private suspendIdleTabs(): void {
    const now = Date.now();
    for (const tab of this.tabs) {
      if (
        tab.id !== this.activeTabId &&
        !tab.isUnloaded &&
        !tab.isPlayingMedia &&
        tab.id !== this.pipTabId &&
        now - tab.lastAccessedAt > IDLE_SUSPEND_TIMEOUT
      ) {
        tab.unload();
      }
    }
  }

  showTabMenu(tab: Tab): void {
    Menu.buildFromTemplate([
      {
        label: tab.isPinned ? 'Unpin' : 'Pin',
        icon: nativeImage.createMenuSymbol('pin'),
        click: () => this.togglePin(tab),
      },
      { label: 'Close Tab', click: () => this.closeTab(tab) },
    ]).popup({ window: this.win });
  }

  showContextMenu(tab: Tab, params: ContextMenuParams): void {
    showPageContextMenu(tab, params, { openTab: (url, background) => this.openTab(url, background) });
  }

  copyText(text: string): void {
    clipboard.writeText(text);
  }

  // MARK: Appearance

  get appearance(): Appearance {
    const { showBorder, sidebarExpanded, sidebarWidth, compactMode } = settingsStore.get();
    return { showBorder, sidebarExpanded, sidebarWidth: clampSidebarWidth(sidebarWidth), compactMode };
  }

  setAppearance(patch: Partial<Appearance>): void {
    const next = { ...this.appearance };
    for (const key of ['showBorder', 'sidebarExpanded', 'compactMode'] as const) {
      if (typeof patch[key] === 'boolean') next[key] = patch[key];
    }
    if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) {
      next.sidebarWidth = clampSidebarWidth(patch.sidebarWidth);
    }
    settingsStore.set({ ...settingsStore.get(), ...next });
    if (!next.compactMode) this.setSidebarPeek(false);
    this.placeTrafficLights();
    // Keep the View menu's checkmarks in step.
    const menu = Menu.getApplicationMenu();
    const expand = menu?.getMenuItemById('expand-sidebar');
    const compact = menu?.getMenuItemById('compact-mode');
    if (expand) expand.checked = next.sidebarExpanded;
    if (compact) compact.checked = next.compactMode;
    this.changed();
  }

  /**
   * Centers the traffic lights in the top bar, which sits inside the frame —
   * inset 8px from the window when the border shows.
   */
  private placeTrafficLights(): void {
    const inset = this.appearance.showBorder ? 8 : 0;
    this.win.setWindowButtonPosition({ x: inset + 12, y: inset + 10 });
  }

  /**
   * Compact mode's sidebar sliding out (or back). It stays mounted a moment
   * after closing, while it slides away.
   */
  setSidebarPeek(open: boolean): void {
    if (open && !this.appearance.compactMode) return;
    // Repeats (a second "close" while it slides away) change nothing — and
    // mustn't cancel the pending hide, or the invisible view would stay over
    // the page and swallow its clicks.
    if (open === this.ui.sidebarPeek) return;
    if (this.peekHideTimer) clearTimeout(this.peekHideTimer);
    this.peekHideTimer = null;
    this.setUI({ sidebarPeek: open });
    if (!open) {
      this.peekHideTimer = setTimeout(() => {
        this.peekHideTimer = null;
        if (!this.ui.sidebarPeek) this.peekView.setVisible(false);
      }, 260);
    }
  }

  showTopBarMenu(): void {
    const { showBorder, sidebarExpanded, compactMode } = this.appearance;
    Menu.buildFromTemplate([
      {
        label: 'Expand Sidebar',
        type: 'checkbox',
        checked: sidebarExpanded,
        click: () => this.setAppearance({ sidebarExpanded: !sidebarExpanded }),
      },
      {
        label: 'Compact Mode',
        type: 'checkbox',
        accelerator: 'Ctrl+Alt+C',
        checked: compactMode,
        click: () => this.setAppearance({ compactMode: !compactMode }),
      },
      { type: 'separator' },
      {
        label: 'Show Border',
        type: 'checkbox',
        checked: showBorder,
        click: () => this.setAppearance({ showBorder: !showBorder }),
      },
    ]).popup({ window: this.win });
  }

  // MARK: Fullscreen

  htmlFullscreenChanged(tab: Tab, on: boolean): void {
    if (tab.id !== this.activeTabId) return;
    this.setUI({ isHtmlFullscreen: on });
    if (on) {
      // Electron usually takes the window fullscreen itself; make sure.
      setTimeout(() => {
        if (this.ui.isHtmlFullscreen && !this.win.isFullScreen()) {
          this.fullscreenForHtml = true;
          this.win.setFullScreen(true);
        }
      }, 100);
    } else if (this.fullscreenForHtml) {
      this.fullscreenForHtml = false;
      this.win.setFullScreen(false);
    }
  }


  // MARK: Picture in Picture

  togglePiP(): void {
    const tab = this.activeTab;
    if (!tab) return;
    if (this.pipTabId === tab.id) {
      this.exitPiPIfShowing(tab);
      return;
    }
    if (this.pipTabId) return;
    const script = `(async () => {
      const v = document.querySelector('video');
      if (!v) return 'no-video-element';
      if (!document.pictureInPictureEnabled) return 'pip-disabled';
      if (document.pictureInPictureElement) return 'already-pip';
      v.disablePictureInPicture = false;
      try { await v.requestPictureInPicture(); return 'ok'; }
      catch (e) { return 'error: ' + e.name + ': ' + e.message; }
    })()`;
    // userGesture: requestPictureInPicture() needs one.
    tab.webContents
      ?.executeJavaScript(script, true)
      .then((result) => {
        if (result === 'ok') this.pipTabId = tab.id;
      })
      .catch(() => {});
  }

  private exitPiPIfShowing(tab: Tab): void {
    if (this.pipTabId !== tab.id) return;
    this.pipTabId = null;
    tab.webContents
      ?.executeJavaScript('document.pictureInPictureElement && document.exitPictureInPicture()')
      .catch(() => {});
  }

  /**
   * The video left Picture in Picture (including the PiP window's "back to
   * tab" button): bring the window and that tab back to the front.
   */
  pipExited(tab: Tab): void {
    if (this.pipTabId === tab.id) this.pipTabId = null;
    if (!this.tabs.includes(tab)) return;
    app.focus({ steal: true });
    this.win.show();
    this.selectTab(tab);
  }

  // MARK: Teardown

  prepareToQuit(): void {
    this.closing = true;
    clearInterval(this.idleTimer);
    this.persistSession();
  }
}
