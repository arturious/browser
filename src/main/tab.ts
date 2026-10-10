import { randomUUID } from 'node:crypto';
import {
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type WebContents,
  type WebPreferences,
} from 'electron';
import type { TabState } from '../shared/types';
import { hostOf } from '../shared/url';
import { PAGE_PRELOAD } from './paths';
import { zoomStore } from './store';
import { adjustThemeColor } from './theme-color';

/** What a tab needs from the window that holds it. */
export interface TabHost {
  changed(): void;
  /** Mounts a freshly created page view into the window. */
  attach(tab: Tab, view: WebContentsView): void;
  detach(view: WebContentsView): void;
  openTab(url: string, background: boolean): void;
  /** A page opened a popup (target="_blank", window.open()): show it as a tab. */
  adoptPopup(opener: Tab, options: BrowserWindowConstructorOptions): WebContents;
  htmlFullscreenChanged(tab: Tab, on: boolean): void;
  closedByPage(tab: Tab): void;
  showContextMenu(tab: Tab, params: ContextMenuParams): void;
}

export function pageWebPreferences(): WebPreferences {
  return {
    preload: PAGE_PRELOAD,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    // Sites shouldn't start making noise in tabs restored from the last
    // session or opened in the background before they've been looked at.
    autoplayPolicy: 'document-user-activation-required',
    scrollBounce: true,
    spellcheck: true,
  };
}

const ignore = () => {};

export class Tab {
  readonly id = randomUUID();
  url: string;
  title: string;
  isLoading = false;
  canGoBack = false;
  canGoForward = false;
  favicon: string | null = null;
  hasPlayingVideo = false;
  isPlayingMedia = false;
  themeColor: string | null = null;
  zoom = 1;
  /** What the page helper last reported (main frame), and whether any frame is making sound. */
  private pageMedia = { video: false, media: false };
  private audible = false;

  isPinned = false;
  /**
   * The address this tab had when it was pinned. Closing a pinned tab only
   * unloads it, and reopening always returns here, not wherever it had
   * navigated to since.
   */
  pinnedURL: string | null = null;
  pinnedTitle: string | null = null;
  pinnedFavicon: string | null = null;

  /**
   * The page's renderer is gone (pinned tab closed, idle-suspended, or a
   * restored tab not yet looked at) but the tab and its url stay.
   * `reloadIfUnloaded()` brings it back.
   */
  isUnloaded = false;
  /** When this tab was last the active one — the idle-suspend timer measures from here. */
  lastAccessedAt = Date.now();
  isHtmlFullscreen = false;

  view: WebContentsView | null = null;
  private zoomHost: string | null = null;

  constructor(
    private readonly host: TabHost,
    url: string,
    options: { deferLoad?: boolean; popup?: BrowserWindowConstructorOptions } = {},
  ) {
    this.url = url;
    this.title = hostOf(url) ?? 'New Tab';
    if (options.popup) {
      // Chromium loads the popup's own navigation into the adopted
      // WebContents itself, so there's nothing to load here.
      this.createView(options.popup);
    } else if (options.deferLoad) {
      this.isUnloaded = true;
    } else {
      this.createView();
      this.load(url);
    }
  }

  get webContents(): WebContents | null {
    const wc = this.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  state(): TabState {
    return {
      id: this.id,
      url: this.url,
      title: this.title,
      isLoading: this.isLoading,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      favicon: this.favicon,
      hasPlayingVideo: this.hasPlayingVideo,
      isPlayingMedia: this.isPlayingMedia,
      themeColor: this.themeColor,
      isPinned: this.isPinned,
      isUnloaded: this.isUnloaded,
    };
  }

  private createView(popup?: BrowserWindowConstructorOptions): void {
    const view = popup
      ? new WebContentsView({
          // Electron passes the WebContents Chromium already created for
          // the popup (keeping window.opener intact) in the options.
          webContents: (popup as { webContents?: WebContents }).webContents,
          webPreferences: popup.webPreferences,
        })
      : new WebContentsView({ webPreferences: pageWebPreferences() });
    view.setBorderRadius(8);
    view.setVisible(false);
    this.view = view;
    this.zoomHost = null;
    this.wire(view.webContents);
    this.host.attach(this, view);
  }

  private wire(wc: WebContents): void {
    wc.on('did-start-loading', () => {
      this.isLoading = true;
      this.host.changed();
    });
    wc.on('did-stop-loading', () => {
      this.isLoading = false;
      // A navigation that turned into a download never commits, so put
      // back the address the page is actually still showing.
      const current = wc.getURL();
      if (current) this.url = current;
      this.syncNavigationState();
    });
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && details.url) {
        this.url = details.url;
        this.host.changed();
      }
    });
    // Zoom is applied once the new page commits rather than when it starts
    // loading: earlier, the previous page would visibly snap to the new
    // site's zoom for a moment.
    wc.on('did-navigate', (_event, url) => {
      this.url = url;
      this.applyStoredZoom();
      this.syncNavigationState();
    });
    // Single-page apps (YouTube…) change the URL through the History API
    // without a full navigation.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.syncNavigationState();
    });
    wc.on('page-title-updated', (_event, title) => {
      if (!title) return;
      this.title = title;
      this.host.changed();
    });
    wc.on('page-favicon-updated', (_event, favicons) => {
      if (!favicons[0]) return;
      this.favicon = favicons[0];
      this.host.changed();
    });
    wc.on('did-change-theme-color', (_event, color) => {
      this.themeColor = adjustThemeColor(color);
      this.host.changed();
    });
    wc.on('enter-html-full-screen', () => {
      this.isHtmlFullscreen = true;
      this.host.htmlFullscreenChanged(this, true);
    });
    wc.on('leave-html-full-screen', () => {
      this.isHtmlFullscreen = false;
      this.host.htmlFullscreenChanged(this, false);
    });
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && this.isHtmlFullscreen) {
        event.preventDefault();
        wc.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(ignore);
      }
    });
    // Catches sound from embedded frames too, which the page helper
    // (main frame only) can't see.
    wc.on('audio-state-changed', (event) => {
      this.audible = event.audible;
      this.updateMediaState();
    });
    wc.on('context-menu', (_event, params) => this.host.showContextMenu(this, params));
    wc.on('render-process-gone', () => {
      // Treat a crashed page like an unloaded one: it comes back when
      // the tab is selected again.
      this.destroyView();
      this.isUnloaded = true;
      this.resetPageState();
      this.host.changed();
    });
    // window.close() from the page itself (e.g. the end of a sign-in popup).
    wc.on('destroyed', () => {
      if (this.view?.webContents === wc) {
        this.view = null;
        this.host.closedByPage(this);
      }
    });
    wc.setWindowOpenHandler((details) => {
      // Cmd+click: a new tab in the background, without leaving this page.
      if (details.disposition === 'background-tab') {
        this.host.openTab(details.url, true);
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => this.host.adoptPopup(this, options),
      };
    });
  }

  private syncNavigationState(): void {
    const wc = this.webContents;
    if (wc) {
      this.canGoBack = wc.navigationHistory.canGoBack();
      this.canGoForward = wc.navigationHistory.canGoForward();
      // The page helper needs these to decide whether a swipe can navigate.
      wc.send('page:nav-state', { canGoBack: this.canGoBack, canGoForward: this.canGoForward });
    }
    this.host.changed();
  }

  setMediaState(video: boolean, media: boolean): void {
    this.pageMedia = { video, media };
    this.updateMediaState();
  }

  private updateMediaState(): void {
    const video = this.pageMedia.video;
    const media = this.pageMedia.media || this.audible;
    if (this.hasPlayingVideo === video && this.isPlayingMedia === media) return;
    this.hasPlayingVideo = video;
    this.isPlayingMedia = media;
    this.host.changed();
  }

  private load(url: string): void {
    // loadURL rejects when the navigation is replaced or becomes a
    // download — both expected, not failures.
    this.webContents?.loadURL(url).catch(ignore);
  }

  navigate(url: string): void {
    this.url = url;
    if (!this.view) {
      this.isUnloaded = false;
      this.createView();
    }
    this.load(url);
    this.host.changed();
  }

  goBack(): void {
    this.webContents?.navigationHistory.goBack();
  }

  goForward(): void {
    this.webContents?.navigationHistory.goForward();
  }

  reload(): void {
    this.webContents?.reload();
  }

  stop(): void {
    this.webContents?.stop();
  }

  /**
   * Frees the page's whole renderer process but keeps the tab. A pinned tab
   * snaps its url/title/icon back to what it was pinned at right away, so
   * the sidebar doesn't keep showing whatever page it was last on.
   */
  unload(): void {
    if (this.isUnloaded) return;
    this.isUnloaded = true;
    if (this.pinnedURL && this.pinnedURL !== this.url) {
      this.url = this.pinnedURL;
      this.title = this.pinnedTitle ?? hostOf(this.pinnedURL) ?? this.title;
      this.favicon = this.pinnedFavicon;
    }
    this.destroyView();
    this.resetPageState();
    this.host.changed();
  }

  reloadIfUnloaded(): void {
    if (!this.isUnloaded) return;
    this.isUnloaded = false;
    this.url = this.pinnedURL ?? this.url;
    this.createView();
    this.load(this.url);
  }

  private resetPageState(): void {
    this.isLoading = false;
    this.canGoBack = false;
    this.canGoForward = false;
    this.hasPlayingVideo = false;
    this.isPlayingMedia = false;
    this.pageMedia = { video: false, media: false };
    this.audible = false;
    this.isHtmlFullscreen = false;
  }

  destroyView(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.host.detach(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  zoomIn(): void {
    this.setZoom(Math.min(this.zoom + 0.05, 3));
  }

  zoomOut(): void {
    this.setZoom(Math.max(this.zoom - 0.05, 0.25));
  }

  resetZoom(): void {
    this.setZoom(1);
  }

  private setZoom(zoom: number): void {
    this.zoom = Math.round(zoom * 100) / 100;
    this.webContents?.setZoomFactor(this.zoom);
    const host = hostOf(this.url);
    if (host) zoomStore.set({ ...zoomStore.get(), [host]: this.zoom });
  }

  /** Applies the zoom last saved for this site whenever a navigation lands on a new host. */
  private applyStoredZoom(): void {
    const host = hostOf(this.url);
    if (host === this.zoomHost) return;
    this.zoomHost = host;
    this.zoom = (host && zoomStore.get()[host]) || 1;
    this.webContents?.setZoomFactor(this.zoom);
  }
}
