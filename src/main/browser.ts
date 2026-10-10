import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeImage,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type WebContents,
  type WebPreferences,
} from 'electron';
import type { AppState, ChromeCommand, HoveredTab, Popover, Rect, UIState } from '../shared/types';
import { resolveInput } from '../shared/url';
import type { AdBlocker } from './adblock';
import { showPageContextMenu } from './context-menu';
import type { Downloads } from './downloads';
import { CHROME_PRELOAD, RENDERER_HTML } from './paths';
import { sessionStore } from './store';
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
  };
}

/**
 * The one browser window: the chrome (React, filling the window), one
 * WebContentsView per tab placed where the chrome leaves room for the page,
 * and a transparent overlay view on top for popovers and tooltips, which
 * have to float over the page.
 */
export class Browser implements TabHost {
  readonly win: BrowserWindow;
  private readonly overlay: WebContentsView;
  private readonly extraRenderers = new Set<WebContents>();

  tabs: Tab[] = [];
  activeTabId: string | null = null;
  private ui: UIState = { popover: null, popoverAnchor: null, hoveredTab: null, isHtmlFullscreen: false };
  private pageBounds: Rect = { x: 64, y: 42, width: 1028, height: 700 };
  private pipTabId: string | null = null;
  private fullscreenForHtml = false;
  private broadcastScheduled = false;
  private closing = false;
  private readonly idleTimer: NodeJS.Timeout;

  constructor(
    private readonly downloads: Downloads,
    private readonly adBlocker: AdBlocker,
  ) {
    this.win = new BrowserWindow({
      width: 1100,
      height: 750,
      minWidth: 900,
      minHeight: 600,
      center: true,
      show: false,
      title: 'Browser',
      // Keeps a real titled window (native edge resizing) with the title
      // bar and traffic lights hidden; the top bar is the drag area.
      titleBarStyle: 'hidden',
      vibrancy: 'hud',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      webPreferences: chromeWebPreferences(),
    });
    this.win.setWindowButtonVisibility(false);
    void this.win.loadFile(RENDERER_HTML, { query: { view: 'chrome' } });
    this.win.once('ready-to-show', () => this.win.show());

    this.overlay = new WebContentsView({ webPreferences: chromeWebPreferences() });
    this.overlay.setBackgroundColor('#00000000');
    this.overlay.setVisible(false);
    void this.overlay.webContents.loadFile(RENDERER_HTML, { query: { view: 'overlay' } });
    this.win.contentView.addChildView(this.overlay);

    this.win.on('resize', () => this.layout());
    this.win.on('close', () => {
      this.closing = true;
    });
    // Window-level fullscreen changes the content size too.
    this.win.on('enter-full-screen', () => this.layout());
    this.win.on('leave-full-screen', () => this.layout());

    this.restoreSession();
    // Not time-critical (idle is measured in tens of minutes), so a coarse
    // timer that doesn't keep the process awake is plenty.
    this.idleTimer = setInterval(() => this.suspendIdleTabs(), 60_000);
    this.idleTimer.unref();
  }

  get activeTab(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeTabId);
  }

  /** Renderers allowed to drive the browser over IPC: the chrome, the overlay, settings. */
  isTrustedSender(sender: WebContents): boolean {
    return sender === this.win.webContents || sender === this.overlay.webContents || this.extraRenderers.has(sender);
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
      downloads: this.downloads.list(),
      hasUnseenFinishedDownloads: this.downloads.hasUnseenFinished,
      adBlockEnabled: this.adBlocker.enabled,
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
      for (const wc of [this.win.webContents, this.overlay.webContents, ...this.extraRenderers]) {
        if (!wc.isDestroyed()) wc.send('state', state);
      }
      this.layout();
      // Addresses and titles change all the time; the store debounces writes.
      this.persistSession();
    });
  }

  command(command: ChromeCommand): void {
    if (command !== 'download-started') this.win.webContents.focus();
    this.win.webContents.send('command', command);
  }

  private setUI(patch: Partial<UIState>): void {
    this.ui = { ...this.ui, ...patch };
    this.changed();
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

    // The overlay only covers what it has to: the whole window while a
    // popover is open (a click outside closes it), or just the tooltip.
    const { popover, hoveredTab, isHtmlFullscreen } = this.ui;
    if (popover) {
      this.overlay.setBounds(full);
      this.overlay.setVisible(true);
    } else if (hoveredTab && !isHtmlFullscreen) {
      const { x, y, width: w } = hoveredTab.rect;
      this.overlay.setBounds({ x: Math.round(x + w + 2), y: Math.round(y + 27), width: 360, height: 40 });
      this.overlay.setVisible(true);
    } else {
      this.overlay.setVisible(false);
    }
  }

  attach(_tab: Tab, view: WebContentsView): void {
    this.win.contentView.addChildView(view);
    // Re-adding moves the overlay back above the new page.
    this.win.contentView.addChildView(this.overlay);
    this.layout();
  }

  detach(view: WebContentsView): void {
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
  }

  private updateVisibility(): void {
    for (const tab of this.tabs) tab.view?.setVisible(tab.id === this.activeTabId);
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

  /** A link that opened a blank tab only to start a download leaves nothing to look at. */
  downloadStarted(source: WebContents): void {
    this.command('download-started');
    const tab = this.tabFor(source);
    if (tab && !tab.isPinned && !tab.canGoBack && (!source.getURL() || source.getURL() === 'about:blank')) {
      this.closeTab(tab);
    }
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
    const pinIcon = nativeImage.createFromNamedImage('pin').resize({ height: 15 });
    pinIcon.setTemplateImage(true);
    Menu.buildFromTemplate([
      { label: tab.isPinned ? 'Unpin' : 'Pin', icon: pinIcon, click: () => this.togglePin(tab) },
      { label: 'Close Tab', click: () => this.closeTab(tab) },
    ]).popup({ window: this.win });
  }

  showContextMenu(tab: Tab, params: ContextMenuParams): void {
    showPageContextMenu(tab, params, { openTab: (url, background) => this.openTab(url, background) });
  }

  showDownloadMenu(id: string): void {
    const item = this.downloads.find(id);
    if (!item?.isFinished || item.failed) return;
    Menu.buildFromTemplate([{ label: 'Show in Finder', click: () => this.downloads.reveal(id) }]).popup({
      window: this.win,
    });
  }

  copyText(text: string): void {
    clipboard.writeText(text);
  }

  // MARK: Popovers and tooltips

  setPopover(popover: Popover | null, anchor?: Rect): void {
    if (popover === 'downloads') this.downloads.markSeen();
    this.setUI({ popover, popoverAnchor: popover ? (anchor ?? null) : null });
  }

  setHoveredTab(hoveredTab: HoveredTab | null): void {
    this.setUI({ hoveredTab });
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
