import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  nativeImage,
  systemPreferences,
  screen,
  session,
  shell,
  type DownloadItem,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { clampSidebarWidth, SIDEBAR_WIDTH, type Appearance, type AppState, type ChromeCommand, type Rect, type UIState, type LibrarySection, type Workspace, type SiteBoost, type InterfacePanel, type BrowserExtension, type WorkspaceTheme } from '../shared/types';
import { DEFAULT_TOOLBAR_ITEMS, TOOLBAR_ITEMS, normalizeWorkspaceIcon, normalizeTheme } from '../shared/theme';
import { createLibrarySpring, libraryResizeEase } from '../shared/motion';
import { previewableDownload } from '../shared/media';
import { resolveInput, hostOf } from '../shared/url';
import type { AdBlocker } from './adblock';
import { showPageContextMenu } from './context-menu';
import { applyGlass, setGlassFullscreen, watchSidebarWheelPhases } from './glass';
import { CHROME_PRELOAD, RENDERER_HTML } from './paths';
import { sessionStore, settingsStore, windowStore, workspaceStore, libraryStore } from './store';
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
  private ui: UIState = {
    sidebarPeek: false, isHtmlFullscreen: false, isWindowFullscreen: false,
    libraryOpen: false, libraryProgress: 0, libraryAnimating: false, libraryGestureActive: false,
    librarySizing: false,
    librarySection: libraryStore.get().section,
    libraryWidth: libraryStore.get().width,
    mediaPreview: null,
    interfacePanel: null,
  };
  private libraryTimer: NodeJS.Timeout | null = null;
  private librarySidebarPeek = false;
  private libraryWidthTimer: NodeJS.Timeout | null = null;
  private nativeLayouts = new WeakMap<WebContentsView, { bounds: Rect; radius?: number }>();
  private peekVisible = false;
  private mediaPreviewView: WebContentsView | null = null;
  private interfaceView: WebContentsView | null = null;
  private extensionPopupView: WebContentsView | null = null;
  private extensionEntries: BrowserExtension[] = [];
  private interfaceRequestId = 0;
  private readonly downloads = new Map<string, DownloadItem>();
  private readonly onDownload = (_event: Electron.Event, item: DownloadItem) => this.trackDownload(item);
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

    const stopWheelPhases = watchSidebarWheelPhases(this.win, phase => {
      for (const contents of [this.win.webContents, this.peekView.webContents]) {
        if (!contents.isDestroyed()) contents.send('sidebar:wheel-phase', phase);
      }
    });
    this.win.once('closed', stopWheelPhases);


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

    // A previous process cannot resume Electron's DownloadItem objects.
    libraryStore.set({ ...libraryStore.get(), downloads: libraryStore.get().downloads.map((entry) =>
      entry.status === 'progressing' ? { ...entry, status: 'interrupted' } : entry) });
    session.defaultSession.on('will-download', this.onDownload);
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
      workspaces: workspaceStore.get().workspaces,
      activeWorkspaceId: workspaceStore.get().activeWorkspaceId,
      folders: workspaceStore.get().folders,
      history: libraryStore.get().history,
      downloads: libraryStore.get().downloads,
      boosts: libraryStore.get().boosts,
      extensions: this.extensionEntries,
    };
  }

  private publish(): void {
    const state = this.snapshot();
    for (const wc of [this.win.webContents, this.peekView.webContents, ...this.extraRenderers]) {
      if (!wc.isDestroyed()) wc.send('state', state);
    }
    this.layout();
  }

  private publishMotion(): void {
    for (const wc of [this.win.webContents, this.peekView.webContents]) {
      if (!wc.isDestroyed()) wc.send('library:motion', this.ui);
    }
    this.layout();
  }

  /** Coalesces every change made in the same tick into one state broadcast. */
  changed(): void {
    if (this.broadcastScheduled) return;
    this.broadcastScheduled = true;
    setImmediate(() => {
      this.broadcastScheduled = false;
      this.publish();
      // Addresses and titles change all the time; the store debounces writes.
      this.persistSession();
    });
  }

  command(command: ChromeCommand): void {
    if (command === 'new-tab' || command === 'focus-address') { this.openInterfacePanel('address', undefined, undefined, command === 'new-tab'); return; }
    if (command === 'theme-editor') { this.openInterfacePanel('theme'); return; }
    if (command === 'create-workspace') { this.animateLibrary(false); this.openInterfacePanel('workspace', undefined, undefined, true); return; }
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

  private setNativeLayout(view: WebContentsView, bounds: Rect, radius?: number): void {
    const previous = this.nativeLayouts.get(view);
    if (!previous || Object.keys(bounds).some(key => bounds[key as keyof Rect] !== previous.bounds[key as keyof Rect])) view.setBounds(bounds);
    if (radius !== undefined && radius !== previous?.radius) view.setBorderRadius(radius);
    this.nativeLayouts.set(view, { bounds, radius });
  }

  private setPeekVisible(visible: boolean): void {
    if (visible === this.peekVisible) return;
    this.peekView.setVisible(visible);
    this.peekVisible = visible;
  }

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
    if (this.interfaceView) this.setNativeLayout(this.interfaceView, full, this.ui.isWindowFullscreen ? 0 : 16);
    if (this.mediaPreviewView) this.setNativeLayout(this.mediaPreviewView, full, this.ui.isWindowFullscreen ? 0 : 16);
    for (const tab of this.tabs) {
      if (!tab.view || (this.ui.libraryAnimating || this.ui.librarySizing) && tab.id !== this.activeTabId) continue;
      const fullscreen = this.ui.isHtmlFullscreen && tab.id === this.activeTabId;
      // Zen translates the entire web surface; its size stays unchanged.
      const libraryWidth = Math.min(Math.max(418, this.ui.libraryWidth), width * 0.95);
      const sidebar = this.appearance.compactMode ? 8 : this.appearance.sidebarExpanded ? this.appearance.sidebarWidth : SIDEBAR_WIDTH.collapsed;
      const offset = (libraryWidth - sidebar) * this.ui.libraryProgress;
      this.setNativeLayout(tab.view, fullscreen ? full : { ...this.pageBounds, x: Math.round(this.pageBounds.x + offset) }, fullscreen ? 0 : 8);
    }

    // Compact mode's sidebar floats over the page's left edge, in line with
    // it; the view leaves room on the right for the panel's shadow.
    const { sidebarExpanded, sidebarWidth, compactMode } = this.appearance;
    const returningToSidebar = this.ui.libraryAnimating && !this.ui.libraryOpen;
    const showPeekDuringLibrary = this.ui.libraryGestureActive || returningToSidebar;
    if (compactMode && this.ui.sidebarPeek && (this.ui.libraryProgress < 0.001 || showPeekDuringLibrary) && !this.ui.isHtmlFullscreen) {
      const width = sidebarExpanded ? sidebarWidth : SIDEBAR_WIDTH.collapsed;
      this.setNativeLayout(this.peekView, { x: this.pageBounds.x, y: this.pageBounds.y, width: width + 24, height: this.pageBounds.height });
      this.setPeekVisible(true);
    } else if (!compactMode || this.ui.isHtmlFullscreen || this.ui.libraryProgress >= 0.001 && !showPeekDuringLibrary || !this.peekHideTimer) {
      // Closed and not sliding away: never leave the (transparent) view
      // over the page, where it would block clicks.
      this.setPeekVisible(false);
    }

  }

  attach(_tab: Tab, view: WebContentsView): void {
    this.win.contentView.addChildView(view);
    // Re-adding moves the compact sidebar back above the new page.
    this.win.contentView.addChildView(this.peekView);
    if (this.mediaPreviewView) this.win.contentView.addChildView(this.mediaPreviewView);
    if (this.interfaceView) this.win.contentView.addChildView(this.interfaceView);
    if (this.extensionPopupView) this.win.contentView.addChildView(this.extensionPopupView);
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
      const validWorkspace = workspaceStore.get().workspaces.some((workspace) => workspace.id === saved.workspaceId);
      const tab = new Tab(this, url, { id: saved.id, workspaceId: validWorkspace ? saved.workspaceId : workspaceStore.get().workspaces[0].id, deferLoad: index !== active });
      tab.isEssential = saved.isEssential ?? false;
      tab.folderId = workspaceStore.get().folders.some((folder) => folder.id === saved.folderId && folder.workspaceId === tab.workspaceId) ? saved.folderId ?? null : null;
      if (saved.isPinned) {
        tab.isPinned = true;
        tab.pinnedURL = saved.pinnedURL ?? saved.url;
        tab.pinnedTitle = saved.pinnedTitle;
      }
      this.tabs.push(tab);
    });
    const workspace = this.activeWorkspace;
    const remembered = this.tabs.find((tab) => tab.id === workspace.activeTabId && (tab.workspaceId === workspace.id || tab.isEssential));
    const selected = remembered ?? (this.tabs[active] && (this.tabs[active].workspaceId === workspace.id || this.tabs[active].isEssential) ? this.tabs[active] : undefined) ?? this.tabs.find((tab) => tab.workspaceId === workspace.id || tab.isEssential);
    if (selected) this.activate(selected);
  }

  persistSession(): void {
    const index = this.tabs.findIndex((tab) => tab.id === this.activeTabId);
    sessionStore.set({
      tabs: this.tabs.map((tab) => ({
        id: tab.id,
        workspaceId: tab.workspaceId,
        folderId: tab.folderId,
        isEssential: tab.isEssential,
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
    const tab = new Tab(this, url, { workspaceId: this.activeWorkspace.id });
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
    const tab = new Tab(this, 'about:blank', { workspaceId: opener.workspaceId, popup: options });
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
    if (tab.isPinned || tab.isEssential) {
      tab.unload();
      if (this.activeTabId === tab.id) {
        const next = this.tabs.find((other) => other !== tab && (other.isEssential || other.workspaceId === this.activeWorkspace.id));
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
      const visible = this.tabs.filter((other) => other.isEssential || other.workspaceId === this.activeWorkspace.id);
      if (visible.length) this.selectTab(visible[Math.min(index, visible.length - 1)]);
      else { this.activeTabId = null; this.updateVisibility(); }
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
    if (tab.isPinned && tab.isEssential) tab.isEssential = false;
    tab.isPinned = !tab.isPinned;
    if (!tab.isPinned) tab.folderId = null;
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
    if (!tab.isEssential && tab.workspaceId !== this.activeWorkspace.id) this.selectWorkspace(tab.workspaceId);
    if (this.ui.libraryOpen) this.animateLibrary(false);
    if (this.pipTabId === tab.id) this.exitPiPIfShowing(tab);
    this.activate(tab);
  }

  selectTabAt(index: number): void {
    const tab = this.tabs.filter((tab) => tab.isEssential || tab.workspaceId === this.activeWorkspace.id)[index];
    if (tab) this.selectTab(tab);
  }

  private activate(tab: Tab): void {
    tab.reloadIfUnloaded();
    tab.lastAccessedAt = Date.now();
    this.activeTabId = tab.id;
    const store = workspaceStore.get();
    workspaceStore.set({ ...store, workspaces: store.workspaces.map((workspace) =>
      workspace.id === store.activeWorkspaceId ? { ...workspace, activeTabId: tab.id } : workspace) });
    this.layout();
    this.updateVisibility();
    tab.webContents?.focus();
    this.persistSession();
    this.changed();
  }

  navigate(input: string, inNewTab: boolean): void {
    if (this.ui.libraryOpen) this.animateLibrary(false);
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
      { label: tab.isEssential ? 'Remove from Essentials' : 'Add to Essentials', click: () => this.toggleEssential(tab) },
      { label: 'Move to Space', submenu: workspaceStore.get().workspaces.map((workspace) => ({
        label: workspace.name,
        type: 'radio' as const,
        checked: tab.workspaceId === workspace.id,
        click: () => this.moveTab(tab.id, null, workspace.id, null),
      })) },
      { label: 'Move to Folder', submenu: [
        { label: 'No Folder', click: () => this.moveTab(tab.id, null, tab.workspaceId, null) },
        ...workspaceStore.get().folders.filter((folder) => folder.workspaceId === tab.workspaceId).map((folder) => ({
          label: folder.name, click: () => this.moveTab(tab.id, null, folder.workspaceId, folder.id),
        })),
      ] },
      { type: 'separator' },
      { label: 'Close Tab', click: () => this.closeTab(tab) },
    ]).popup({ window: this.win });
  }

  showContextMenu(tab: Tab, params: ContextMenuParams): void {
    showPageContextMenu(tab, params, { openTab: (url, background) => this.openTab(url, background) });
  }

  copyText(text: string): void {
    clipboard.writeText(text);
  }

  // MARK: Spaces, folders and library

  get activeWorkspace(): Workspace {
    const { workspaces, activeWorkspaceId } = workspaceStore.get();
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  }

  selectWorkspace(id: string): void {
    const store = workspaceStore.get();
    const workspace = store.workspaces.find((entry) => entry.id === id);
    if (!workspace || id === store.activeWorkspaceId) return;
    workspaceStore.set({ ...store, activeWorkspaceId: id });
    const visible = this.tabs.filter((tab) => tab.isEssential || tab.workspaceId === id);
    const next = visible.find((tab) => tab.id === workspace.activeTabId) ?? visible.find((tab) => !tab.isEssential) ?? visible[0];
    if (next) this.activate(next);
    else { this.activeTabId = null; this.updateVisibility(); }
    this.changed();
  }

  cycleWorkspace(direction: number): void {
    const { workspaces, activeWorkspaceId } = workspaceStore.get();
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
    const next = workspaces[index + direction];
    if (next) this.selectWorkspace(next.id);
    else if (direction < 0) this.toggleLibrary();
    else this.command('create-workspace');
  }

  createWorkspace(name: string, icon: string, color: string, theme?: WorkspaceTheme): void {
    if (typeof name !== 'string' || !name.trim()) return;
    const workspace: Workspace = {
      id: randomUUID(), name: name.trim().slice(0, 50),
      icon: typeof icon === 'string' ? normalizeWorkspaceIcon(icon) : '◉',
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#9c88ff', activeTabId: null,
      theme: theme ? normalizeTheme(theme) ?? undefined : undefined,
    };
    const store = workspaceStore.get();
    workspaceStore.set({ ...store, workspaces: [...store.workspaces, workspace] });
    this.selectWorkspace(workspace.id);
    this.animateLibrary(false);
  }

  updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'name' | 'icon' | 'color'>>): void {
    if (!patch || typeof patch !== 'object') return;
    const store = workspaceStore.get();
    workspaceStore.set({ ...store, workspaces: store.workspaces.map((workspace) => workspace.id === id ? {
      ...workspace,
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 50) : workspace.name,
      icon: typeof patch.icon === 'string' ? normalizeWorkspaceIcon(patch.icon) : workspace.icon,
      color: typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color : workspace.color,
    } : workspace) });
    this.changed();
  }

  reorderWorkspace(id: string, index: number): void {
    if (!Number.isInteger(index)) return;
    const store = workspaceStore.get();
    const current = store.workspaces.findIndex(workspace => workspace.id === id);
    if (current === -1 || index < 0 || index >= store.workspaces.length || current === index) return;
    const workspaces = [...store.workspaces];
    const [workspace] = workspaces.splice(current, 1);
    workspaces.splice(index, 0, workspace);
    workspaceStore.set({ ...store, workspaces });
    this.changed();
  }

  showWorkspaceMenu(id: string): void {
    const store = workspaceStore.get();
    const workspace = store.workspaces.find((entry) => entry.id === id);
    if (!workspace) return;
    Menu.buildFromTemplate([
      { label: workspace.name, enabled: false },
      { label: 'Open Space', click: () => this.selectWorkspace(id) },
      { label: 'Manage Spaces', click: () => this.toggleLibrary('spaces') },
      { label: 'Edit Space…', click: () => this.openInterfacePanel('workspace', undefined, id) },
      { label: 'Edit Theme…', click: () => this.openInterfacePanel('theme', undefined, id) },
      { label: 'New Folder…', click: () => { this.selectWorkspace(id); this.command('create-folder'); } },
      { type: 'separator' },
      { label: 'Remove Space (keep tabs)', enabled: store.workspaces.length > 1, click: () => {
        const current = workspaceStore.get();
        const fallback = current.workspaces.find((entry) => entry.id !== id);
        if (!fallback) return;
        for (const tab of this.tabs) if (tab.workspaceId === id) { tab.workspaceId = fallback.id; tab.folderId = null; }
        // Activate the fallback before removing the current space.
        if (current.activeWorkspaceId === id) this.selectWorkspace(fallback.id);
        workspaceStore.set({ ...workspaceStore.get(), workspaces: workspaceStore.get().workspaces.filter((entry) => entry.id !== id),
          folders: current.folders.filter((folder) => folder.workspaceId !== id) });
        this.changed();
      } },
    ]).popup({ window: this.win });
  }

  createFolder(name: string): void {
    if (typeof name !== 'string' || !name.trim()) return;
    const store = workspaceStore.get();
    workspaceStore.set({ ...store, folders: [...store.folders, {
      id: randomUUID(), workspaceId: store.activeWorkspaceId, name: name.trim().slice(0, 60), collapsed: false,
    }] });
    this.changed();
  }

  toggleFolder(id: string): void {
    const store = workspaceStore.get();
    workspaceStore.set({ ...store, folders: store.folders.map((folder) => folder.id === id ? { ...folder, collapsed: !folder.collapsed } : folder) });
    this.changed();
  }

  showFolderMenu(id: string): void {
    const folder = workspaceStore.get().folders.find((entry) => entry.id === id);
    if (!folder) return;
    Menu.buildFromTemplate([
      { label: folder.collapsed ? 'Expand Folder' : 'Collapse Folder', click: () => this.toggleFolder(id) },
      { label: 'Remove Folder (keep tabs)', click: () => {
        const store = workspaceStore.get();
        for (const tab of this.tabs) if (tab.folderId === id) tab.folderId = null;
        workspaceStore.set({ ...store, folders: store.folders.filter((entry) => entry.id !== id) });
        this.changed();
      } },
    ]).popup({ window: this.win });
  }

  toggleEssential(tab: Tab): void {
    tab.isEssential = !tab.isEssential;
    if (tab.isEssential) {
      if (!tab.isPinned) this.togglePin(tab);
      tab.folderId = null;
    }
    this.changed();
  }

  moveTab(id: string, beforeId: string | null, workspaceId: string, folderId: string | null): void {
    const tab = this.tabs.find((entry) => entry.id === id);
    const store = workspaceStore.get();
    if (!tab || !store.workspaces.some((entry) => entry.id === workspaceId)) return;
    if (folderId && !store.folders.some((folder) => folder.id === folderId && folder.workspaceId === workspaceId)) return;
    const beforeTab = this.tabs.find((entry) => entry.id === beforeId);
    if (beforeId === id) return;
    tab.workspaceId = workspaceId;
    tab.folderId = folderId;
    if (beforeTab && !folderId) {
      if (beforeTab.isPinned !== tab.isPinned) this.togglePin(tab);
      tab.isEssential = beforeTab.isEssential;
    }
    if (folderId) { tab.isEssential = false; if (!tab.isPinned) this.togglePin(tab); }
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    const before = this.tabs.findIndex((entry) => entry.id === beforeId);
    this.tabs.splice(before >= 0 ? before : this.tabs.length, 0, tab);
    if (tab.id === this.activeTabId && !tab.isEssential && workspaceId !== store.activeWorkspaceId) {
      const next = this.tabs.find((entry) => entry.workspaceId === store.activeWorkspaceId || entry.isEssential);
      if (next) this.activate(next);
      else { this.activeTabId = null; this.updateVisibility(); }
    }
    this.changed();
  }

  toggleLibrary(section?: LibrarySection): void {
    if (section && ['media', 'downloads', 'boosts', 'spaces', 'history'].includes(section)) {
      if (this.ui.libraryOpen && this.ui.librarySection === section) { this.animateLibrary(false); return; }
      this.selectLibrarySection(section);
      this.animateLibrary(true);
    } else this.animateLibrary(!this.ui.libraryOpen);
  }

  selectLibrarySection(section: LibrarySection): void {
    if (!['media', 'downloads', 'boosts', 'spaces', 'history'].includes(section)) return;
    libraryStore.set({ ...libraryStore.get(), section });
    this.ui = { ...this.ui, librarySection: section };
    const count = workspaceStore.get().workspaces.length;
    // 110px rail, 25px padding, 242px cards, 24px gaps, 50px add button.
    this.animateLibraryWidth(section === 'spaces' ? 110 + 50 + count * 242 + count * 24 + 50 : 418);
    this.publish();
  }

  setLibraryWidth(width: number): void {
    if (!Number.isFinite(width)) return;
    if (this.libraryWidthTimer) clearInterval(this.libraryWidthTimer);
    this.libraryWidthTimer = null;
    const next = Math.min(Math.max(width, 418), this.win.getContentSize()[0] * 0.95);
    this.ui = { ...this.ui, libraryWidth: next, librarySizing: false };
    libraryStore.set({ ...libraryStore.get(), width: next });
    this.publish();
  }

  private animateLibraryWidth(target: number): void {
    if (this.libraryWidthTimer) clearInterval(this.libraryWidthTimer);
    const next = Math.min(Math.max(target, 418), this.win.getContentSize()[0] * 0.95);
    if (!this.ui.libraryOpen || systemPreferences.getAnimationSettings().prefersReducedMotion) {
      this.ui = { ...this.ui, libraryWidth: next, librarySizing: false };
      this.libraryWidthTimer = null;
      return;
    }
    const initial = this.ui.libraryWidth;
    this.ui = { ...this.ui, librarySizing: initial !== next };
    const start = performance.now();
    this.libraryWidthTimer = setInterval(() => {
      const progress = Math.min((performance.now() - start) / 300, 1);
      this.ui = { ...this.ui, libraryWidth: initial + (next - initial) * libraryResizeEase(progress) };
      if (progress === 1 && this.libraryWidthTimer) { clearInterval(this.libraryWidthTimer); this.libraryWidthTimer = null; this.ui = { ...this.ui, libraryWidth: next, librarySizing: false }; }
      this.publishMotion();
    }, 16);
  }

  setLibraryGesture(progress: number, target?: boolean): void {
    if (!Number.isFinite(progress) || this.ui.isHtmlFullscreen) return;
    if (!this.ui.libraryGestureActive && typeof target !== 'boolean') this.librarySidebarPeek = this.ui.sidebarPeek;
    const restoreSidebarPeek = target === false && !this.ui.libraryOpen && this.librarySidebarPeek;
    if (this.libraryTimer) clearInterval(this.libraryTimer);
    this.libraryTimer = null;
    if (!this.ui.libraryGestureActive && !this.ui.libraryOpen && this.ui.librarySection === 'spaces') {
      const count = workspaceStore.get().workspaces.length;
      this.animateLibraryWidth(110 + 50 + count * 242 + count * 24 + 50);
    }
    this.ui = { ...this.ui, libraryProgress: Math.min(Math.max(progress, -0.2), 1.2), libraryAnimating: true, libraryGestureActive: typeof target !== 'boolean' };
    this.publishMotion();
    if (typeof target === 'boolean') this.animateLibrary(target, restoreSidebarPeek);
  }

  animateLibrary(open: boolean, restoreSidebarPeek = false): void {
    if (open && this.interfaceView) this.closeInterfacePanel();
    if (!open && this.ui.mediaPreview) this.closeMediaPreview();
    if (open && this.ui.isHtmlFullscreen) return;
    if (open && this.ui.librarySection === 'spaces') {
      const count = workspaceStore.get().workspaces.length;
      this.animateLibraryWidth(110 + 50 + count * 242 + count * 24 + 50);
    }
    if (this.libraryTimer) clearInterval(this.libraryTimer);
    this.ui = { ...this.ui, libraryOpen: open, libraryAnimating: true, libraryGestureActive: false, sidebarPeek: restoreSidebarPeek };
    this.win.webContents.focus();
    const reducedMotion = systemPreferences.getAnimationSettings().prefersReducedMotion;
    if (reducedMotion) {
      this.ui = { ...this.ui, libraryProgress: open ? 1 : 0, libraryAnimating: false };
      this.publishMotion();
      return;
    }
    const started = performance.now();
    // Use the same analytical spring generator as Zen's Motion.animate.
    // Replacing an animation starts at its visible position with zero velocity.
    const animation = createLibrarySpring(this.ui.libraryProgress, open ? 1 : 0);
    this.publishMotion();
    this.libraryTimer = setInterval(() => {
      if (this.win.isDestroyed()) { if (this.libraryTimer) clearInterval(this.libraryTimer); this.libraryTimer = null; return; }
      const step = animation.next(performance.now() - started);
      this.ui = { ...this.ui, libraryProgress: step.done ? (open ? 1 : 0) : step.value, libraryAnimating: !step.done };
      if (step.done && this.libraryTimer) { clearInterval(this.libraryTimer); this.libraryTimer = null; }
      this.publishMotion();
    }, 16);
  }

  previewDownload(id: string, origin: Rect): void {
    const entry = libraryStore.get().downloads.find(download => download.id === id);
    if (!this.ui.libraryOpen || !entry || !previewableDownload(entry) || !origin || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(origin[key as keyof Rect])) || origin.width <= 0 || origin.height <= 0) return;
    this.ui = { ...this.ui, mediaPreview: { id, origin } };
    if (!this.mediaPreviewView) {
      const view = new WebContentsView({ webPreferences: { ...chromeWebPreferences(), backgroundThrottling: true } });
      this.mediaPreviewView = view;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      this.addRenderer(view.webContents); this.win.contentView.addChildView(view);
      view.webContents.once('did-finish-load', () => {
        if (this.mediaPreviewView !== view) return;
        this.publish(); view.setVisible(true); view.webContents.focus();
      });
      void view.webContents.loadFile(RENDERER_HTML, { query: { view: 'media-preview' } }).catch(() => { if (this.mediaPreviewView === view) this.closeMediaPreview(); });
    }
    this.publish();
  }

  closeMediaPreview(): void {
    this.ui = { ...this.ui, mediaPreview: null };
    const view = this.mediaPreviewView; this.mediaPreviewView = null;
    if (view) {
      view.setVisible(false);
      if (!this.win.isDestroyed()) { this.win.contentView.removeChildView(view); this.win.webContents.focus(); }
      view.webContents.close();
    }
    if (!this.closing && !this.win.isDestroyed()) this.publish();
  }

  stepMediaPreview(direction: number): void {
    const preview = this.ui.mediaPreview;
    if (!preview || direction !== 1 && direction !== -1) return;
    const entries = libraryStore.get().downloads.filter(previewableDownload);
    const index = entries.findIndex(entry => entry.id === preview.id);
    if (index < 0 || !entries[index + direction]) return;
    this.ui = { ...this.ui, mediaPreview: { ...preview, id: entries[index + direction].id } };
    this.publish();
  }

  recordVisit(tab: Tab, titleOnly = false): void {
    if (!/^https?:\/\//.test(tab.url)) return;
    const store = libraryStore.get();
    if (titleOnly) {
      const index = store.history.findIndex((entry) => entry.url === tab.url);
      if (index >= 0) libraryStore.set({ ...store, history: store.history.map((entry, i) => i === index ? { ...entry, title: tab.title } : entry) });
      return;
    }
    const recent = store.history[0];
    if (recent?.url === tab.url && Date.now() - recent.visitedAt < 30_000) {
      libraryStore.set({ ...store, history: [{ ...recent, title: tab.title }, ...store.history.slice(1)] });
    } else {
      libraryStore.set({ ...store, history: [{ id: randomUUID(), url: tab.url, title: tab.title, visitedAt: Date.now() }, ...store.history].slice(0, 2000) });
    }
  }

  clearHistory(): void {
    libraryStore.set({ ...libraryStore.get(), history: [] });
    this.changed();
  }

  private trackDownload(item: DownloadItem): void {
    const id = randomUUID();
    this.downloads.set(id, item);
    const store = libraryStore.get();
    libraryStore.set({ ...store, downloads: [{ id, name: item.getFilename(), url: item.getURL(), path: '', startedAt: Date.now(),
      receivedBytes: 0, totalBytes: item.getTotalBytes(), status: 'progressing' as const }, ...store.downloads].slice(0, 500) });
    const update = (status: 'progressing' | 'completed' | 'cancelled' | 'interrupted') => {
      const current = libraryStore.get();
      const file = item.getSavePath();
      if (status === 'completed' && /\.(png|jpe?g|webp|gif|bmp)$/i.test(file)) {
        const image = nativeImage.createThumbnailFromPath(file, { width: 180, height: 180 });
        void image.then((result) => {
          if (result.isEmpty()) return;
          const state = libraryStore.get();
          libraryStore.set({ ...state, downloads: state.downloads.map((entry) => entry.id === id ? { ...entry, thumbnail: result.toDataURL() } : entry) });
          this.changed();
        }).catch(() => {});
      }
      libraryStore.set({ ...current, downloads: current.downloads.map((entry) => entry.id === id ? {
        ...entry, status, path: file, name: path.basename(file) || item.getFilename(),
        receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), paused: item.isPaused(),
      } : entry) });
      this.changed();
    };
    item.on('updated', (_event, status) => update(status));
    item.once('done', (_event, status) => {
      const openWhenDone = libraryStore.get().downloads.find(entry => entry.id === id)?.openWhenDone;
      update(status); this.downloads.delete(id);
      if (status === 'completed' && openWhenDone) this.openDownload(id);
    });
    this.changed();
  }

  openDownload(id: string, reveal = false): void {
    const entry = libraryStore.get().downloads.find((download) => download.id === id);
    if (entry?.status === 'progressing' && !reveal) {
      const store = libraryStore.get();
      libraryStore.set({ ...store, downloads: store.downloads.map(download => download.id === id ? { ...download, openWhenDone: !download.openWhenDone } : download) });
      this.changed(); return;
    }
    if (!entry?.path || entry.status !== 'completed') return;
    if (reveal) shell.showItemInFolder(entry.path);
    else void shell.openPath(entry.path);
  }

  showDownloadMenu(id: string): void {
    const entry = libraryStore.get().downloads.find(download => download.id === id);
    if (!entry) return;
    Menu.buildFromTemplate([
      { label: 'Open in app', enabled: entry.status === 'completed', click: () => this.openDownload(id) },
      { label: 'Show in Finder', enabled: entry.status === 'completed', click: () => this.openDownload(id, true) },
      { type: 'separator' },
      { label: 'Copy filename', click: () => this.copyText(entry.name) },
      { label: 'Copy download link', click: () => this.copyText(entry.url) },
    ]).popup({ window: this.win, callback: () => {
      for (const contents of [this.win.webContents, this.peekView.webContents, ...this.extraRenderers]) if (!contents.isDestroyed()) contents.send('download:menu-closed');
    } });
  }

  controlDownload(id: string, action: 'pause' | 'resume' | 'cancel'): void {
    const item = this.downloads.get(id);
    if (!item) return;
    if (action === 'pause') item.pause();
    else if (action === 'resume' && item.canResume()) item.resume();
    else if (action === 'cancel') item.cancel();
    const store = libraryStore.get();
    libraryStore.set({ ...store, downloads: store.downloads.map((entry) => entry.id === id ? { ...entry, paused: item.isPaused() } : entry) });
    this.changed();
  }

  applyBoost(tab: Tab): void {
    const domain = hostOf(tab.url);
    if (!domain) return;
    const css = libraryStore.get().boosts.filter((boost) => boost.enabled && (domain === boost.domain || domain.endsWith(`.${boost.domain}`))).map((boost) => boost.css).join('\n');
    void tab.applyCSS(css);
  }

  saveBoost(input: Omit<SiteBoost, 'id'> & { id?: string }): void {
    if (!input || typeof input.name !== 'string' || typeof input.domain !== 'string' || typeof input.css !== 'string') return;
    const domain = hostOf(input.domain.includes('://') ? input.domain : `https://${input.domain}`);
    if (!domain || !input.name.trim() || input.css.length > 100_000) return;
    const store = libraryStore.get();
    const id = input.id && store.boosts.some((boost) => boost.id === input.id) ? input.id : randomUUID();
    const boost: SiteBoost = { id, domain, name: input.name.trim().slice(0, 80), css: input.css, enabled: input.enabled !== false };
    const others = store.boosts.filter((entry) => entry.id !== id).map((entry) => boost.enabled && entry.domain === domain ? { ...entry, enabled: false } : entry);
    libraryStore.set({ ...store, boosts: [...others, boost] });
    for (const tab of this.tabs) this.applyBoost(tab);
    this.changed();
  }

  toggleBoost(id: string): void {
    const store = libraryStore.get();
    const selected = store.boosts.find((boost) => boost.id === id);
    if (!selected) return;
    libraryStore.set({ ...store, boosts: store.boosts.map((boost) => boost.id === id ? { ...boost, enabled: !boost.enabled } : boost.domain === selected.domain && !selected.enabled ? { ...boost, enabled: false } : boost) });
    for (const tab of this.tabs) this.applyBoost(tab);
    this.changed();
  }

  showBoostMenu(id: string): void {
    const boost = libraryStore.get().boosts.find((entry) => entry.id === id);
    if (!boost) return;
    Menu.buildFromTemplate([
      { label: boost.enabled ? 'Disable Boost' : 'Enable Boost', click: () => this.toggleBoost(id) },
      { label: 'Copy CSS', click: () => this.copyText(boost.css) },
      { label: 'Open Site', click: () => this.addNewTab(`https://${boost.domain}`) },
    ]).popup({ window: this.win });
  }

  // MARK: Appearance

  get appearance(): Appearance {
    const { showBorder, sidebarExpanded, sidebarWidth, compactMode, themeStyle, solidColor } = settingsStore.get();
    return {
      showBorder,
      sidebarExpanded,
      sidebarWidth: clampSidebarWidth(sidebarWidth),
      compactMode,
      themeStyle: themeStyle === 'solid' ? 'solid' : 'gradient',
      solidColor: /^#[0-9a-f]{6}$/i.test(solidColor) ? solidColor : '#000000',
      toolbarItems: settingsStore.get().toolbarItems ?? DEFAULT_TOOLBAR_ITEMS,
      interfaceRevision: 2,
    };
  }

  setAppearance(patch: Partial<Appearance>): void {
    if (!patch || typeof patch !== 'object') return;
    const next = { ...this.appearance };
    for (const key of ['showBorder', 'sidebarExpanded', 'compactMode'] as const) {
      if (typeof patch[key] === 'boolean') next[key] = patch[key];
    }
    if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) {
      next.sidebarWidth = clampSidebarWidth(patch.sidebarWidth);
    }
    if (patch.themeStyle === 'gradient' || patch.themeStyle === 'solid') next.themeStyle = patch.themeStyle;
    if (Array.isArray(patch.toolbarItems)) next.toolbarItems = [...new Set(patch.toolbarItems.filter(item => typeof item === 'string' && TOOLBAR_ITEMS.includes(item)))];
    if (typeof patch.solidColor === 'string' && /^#[0-9a-f]{6}$/i.test(patch.solidColor)) {
      next.solidColor = patch.solidColor;
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
    if (open && (!this.appearance.compactMode || this.ui.libraryProgress > 0.001)) return;
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
        if (!this.ui.sidebarPeek) this.setPeekVisible(false);
      }, 166); // 150ms source close transition plus one compositing frame.
    }
  }

  showTopBarMenu(): void {
    const { showBorder, sidebarExpanded, compactMode, themeStyle } = this.appearance;
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
        label: 'Edit Theme…',
        click: () => this.openInterfacePanel('theme'),
      },
      { label: 'Customize Toolbar…', click: () => this.openInterfacePanel('customize') },
      { label: 'Extensions…', click: () => this.openInterfacePanel('extensions') },
      {
        label: 'Solid Color',
        type: 'radio',
        checked: themeStyle === 'solid',
        click: () => this.setAppearance({ themeStyle: 'solid' }),
      },
      {
        label: 'Workspace Theme',
        type: 'radio',
        checked: themeStyle === 'gradient',
        click: () => this.setAppearance({ themeStyle: 'gradient' }),
      },
      {
        label: 'Show Border',
        type: 'checkbox',
        checked: showBorder,
        click: () => this.setAppearance({ showBorder: !showBorder }),
      },
    ]).popup({ window: this.win });
  }

  setWorkspaceTheme(id: string, value: WorkspaceTheme): void {
    const theme = normalizeTheme(value);
    const store = workspaceStore.get();
    if (!theme || !store.workspaces.some(workspace => workspace.id === id)) return;
    workspaceStore.set({ ...store, workspaces: store.workspaces.map(workspace => workspace.id === id ? { ...workspace, theme } : workspace) });
    const primary = theme.colors.find(dot => dot.isPrimary)?.c ?? theme.colors[0]?.c;
    if (Array.isArray(primary)) this.updateWorkspace(id, { color: '#' + primary.map(value => Math.round(value).toString(16).padStart(2, '0')).join('') });
    this.setAppearance({ themeStyle: 'gradient' });
  }

  /** Popovers need their own native layer, because pages are WebContentsViews. */
  openInterfacePanel(kind: InterfacePanel, anchor?: Rect, workspaceId?: string, newTab = false): void {
    if (!['address', 'theme', 'extensions', 'menu', 'customize', 'workspace', 'site', 'extension-popup', 'create'].includes(kind) || this.ui.isHtmlFullscreen) return;
    this.win.focus();
    const validAnchor = anchor && [anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite) ? anchor : undefined;
    this.closeExtensionPopup();
    if (this.mediaPreviewView) this.closeMediaPreview();
    this.ui = { ...this.ui, interfacePanel: { kind, anchor: validAnchor, workspaceId: workspaceStore.get().workspaces.some(space => space.id === workspaceId) ? workspaceId : workspaceStore.get().activeWorkspaceId, newTab, requestId: ++this.interfaceRequestId } };
    if (!this.interfaceView) {
      const view = new WebContentsView({ webPreferences: chromeWebPreferences() });
      this.interfaceView = view;
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      this.addRenderer(view.webContents); this.win.contentView.addChildView(view);
      view.webContents.once('did-finish-load', () => {
        if (this.interfaceView !== view) return;
        this.publish();
      });
      void view.webContents.loadFile(RENDERER_HTML, { query: { view: 'interface' } }).catch(() => { if (this.interfaceView === view) this.closeInterfacePanel(); });
    } else this.interfaceView.webContents.focus();
    this.publish();
  }

  closeInterfacePanel(focusPage = true): void {
    this.closeExtensionPopup();
    this.ui = { ...this.ui, interfacePanel: null };
    const view = this.interfaceView; this.interfaceView = null;
    if (view) { view.setVisible(false); if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view); view.webContents.close(); }
    if (!this.closing && !this.win.isDestroyed()) {
      if (focusPage) { if (this.ui.libraryOpen) this.win.webContents.focus(); else this.activeTab?.webContents?.focus(); }
      this.publish();
    }
  }

  interfacePanelReady(sender: WebContents, requestId: number): void {
    const view = this.interfaceView;
    if (!view || sender !== view.webContents || requestId !== this.ui.interfacePanel?.requestId) return;
    // Lazy chunks must mount before the native layer becomes interactive.
    this.win.contentView.addChildView(view);
    if (this.extensionPopupView) this.win.contentView.addChildView(this.extensionPopupView);
    this.layout(); view.setVisible(true);
    (this.extensionPopupView?.webContents ?? view.webContents).focus();
  }

  setExtensions(entries: BrowserExtension[]): void { this.extensionEntries = entries; this.changed(); }

  openExtensionPopup(entry: BrowserExtension, anchor?: Rect): void {
    if (!entry.enabled || !entry.popup || !/^chrome-extension:\/\/[a-p]{32}\//.test(entry.popup)) return;
    this.openInterfacePanel('extension-popup', anchor);
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.extensionPopupView = view;
    const [width, height] = this.win.getContentSize();
    const bounds = { x: Math.max(8, Math.min(width - 388, (anchor?.x ?? width - 388) + (anchor?.width ?? 0) - 380)), y: Math.max(48, Math.min(height - 508, (anchor?.y ?? 0) + (anchor?.height ?? 40) + 8)), width: Math.min(380, width - 16), height: Math.min(500, height - 64) };
    this.setNativeLayout(view, bounds, 12); view.setBackgroundColor('#ffffff');
    this.win.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) this.openTab(url, false); return { action: 'deny' }; });
    view.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); this.closeInterfacePanel(); } });
    void view.webContents.loadURL(entry.popup).then(() => { if (this.extensionPopupView === view) view.webContents.focus(); }).catch(() => { if (this.extensionPopupView === view) this.closeInterfacePanel(); });
  }

  private closeExtensionPopup(): void {
    const view = this.extensionPopupView; this.extensionPopupView = null;
    if (view) { view.setVisible(false); if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view); view.webContents.close(); }
  }

  // MARK: Fullscreen

  htmlFullscreenChanged(tab: Tab, on: boolean): void {
    if (tab.id !== this.activeTabId) return;
    this.setUI({ isHtmlFullscreen: on });
    if (on) {
      this.animateLibrary(false);
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
    this.closeInterfacePanel(false);
    this.closing = true;
    this.closeMediaPreview();
    clearInterval(this.idleTimer);
    if (this.peekHideTimer) clearTimeout(this.peekHideTimer);
    if (this.libraryTimer) clearInterval(this.libraryTimer);
    if (this.libraryWidthTimer) clearInterval(this.libraryWidthTimer);
    session.defaultSession.removeListener('will-download', this.onDownload);
    this.persistSession();
  }
}
