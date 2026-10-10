// State shared between the main process (which owns it) and the renderers
// (the window chrome and settings), which only ever see
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

export interface UIState {
  /** Compact mode's sidebar is out, over the page. */
  sidebarPeek: boolean;
  isHtmlFullscreen: boolean;
  /** The window buttons are hidden while the window is fullscreen. */
  isWindowFullscreen: boolean;
}

export interface Appearance {
  /** A margin of plain glass around the tinted frame, like a border. */
  showBorder: boolean;
  /** Tabs with their titles, rather than icons only. */
  sidebarExpanded: boolean;
  /** The sidebar is hidden and slides out over the page from the window's left edge. */
  compactMode: boolean;
}

export const SIDEBAR_WIDTH = { collapsed: 56, expanded: 240 };

export interface AppState {
  tabs: TabState[];
  activeTabId: string | null;
  adBlockEnabled: boolean;
  appearance: Appearance;
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
export type ChromeCommand = 'new-tab' | 'focus-address';

export interface BrowserAPI {
  getState(): AppState;
  onState(listener: (state: AppState) => void): () => void;
  onCommand(listener: (command: ChromeCommand) => void): () => void;
  /** Keyed "name:weight". */
  symbols: Record<string, SymbolImage>;

  /** Opens the address bar for a new tab, wherever it was asked from. */
  newTab(): void;
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
  /** Right-click on the top bar: the appearance menu. */
  showTopBarMenu(): void;
  setAppearance(patch: Partial<Appearance>): void;
  setSidebarPeek(open: boolean): void;

  setAdBlockEnabled(enabled: boolean): void;

  closeWindow(): void;
  minimizeWindow(): void;
  /** `fill`: Option-click — zoom to fill the screen instead of going fullscreen. */
  zoomWindow(fill: boolean): void;
}
