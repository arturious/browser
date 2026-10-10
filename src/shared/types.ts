// State shared between the main process (which owns it) and the renderers
// (the window chrome and the floating overlay), which only ever see
// snapshots of it — every change goes through an IPC action instead.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TabState {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** The icon the page itself declares, if any. */
  favicon: string | null;
  /** True while a <video> on the page is playing — drives the PiP button. */
  hasPlayingVideo: boolean;
  /** True while any video or audio is playing — drives the speaker badge. */
  isPlayingMedia: boolean;
  /** The page's <meta name="theme-color">, already adjusted for our dark chrome. */
  themeColor: string | null;
  isPinned: boolean;
  isUnloaded: boolean;
}

export interface DownloadState {
  id: string;
  filename: string;
  progress: number;
  isFinished: boolean;
  failed: boolean;
}

export interface HoveredTab {
  title: string;
  isPlayingMedia: boolean;
  /** The sidebar icon's frame, in window coordinates. */
  rect: Rect;
}

export type Popover = 'downloads' | 'history';

export interface UIState {
  popover: Popover | null;
  /** The toolbar button the open popover hangs from, in window coordinates. */
  popoverAnchor: Rect | null;
  hoveredTab: HoveredTab | null;
  isHtmlFullscreen: boolean;
}

export interface AppState {
  tabs: TabState[];
  activeTabId: string | null;
  downloads: DownloadState[];
  hasUnseenFinishedDownloads: boolean;
  adBlockEnabled: boolean;
  ui: UIState;
}

export type SymbolWeight = 'regular' | 'bold';

export interface SymbolImage {
  url: string;
  width: number;
  height: number;
  /** The point size the image was rendered at; the interface scales from it. */
  pointSize: number;
}

/** One-shot commands main sends to the chrome renderer. */
export type ChromeCommand = 'new-tab' | 'focus-address' | 'download-started';

export interface BrowserAPI {
  getState(): AppState;
  onState(listener: (state: AppState) => void): () => void;
  onCommand(listener: (command: ChromeCommand) => void): () => void;
  /** Keyed "name:weight". */
  symbols: Record<string, SymbolImage>;

  selectTab(id: string): void;
  closeTab(id: string): void;
  showTabMenu(id: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  navigate(input: string, inNewTab: boolean): void;
  copyText(text: string): void;
  togglePiP(): void;
  focusPage(): void;

  setPageBounds(rect: Rect): void;
  setHoveredTab(tab: HoveredTab | null): void;
  setPopover(popover: Popover | null, anchor?: Rect): void;

  openDownload(id: string): void;
  showDownloadMenu(id: string): void;
  setAdBlockEnabled(enabled: boolean): void;
}
