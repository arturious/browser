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
  /** The traffic lights are hidden while the window is fullscreen. */
  isWindowFullscreen: boolean;
}

export interface Appearance {
  /** A margin of plain glass around the tinted frame, like a border. */
  showBorder: boolean;
  /** Tabs with their titles, rather than icons only. */
  sidebarExpanded: boolean;
  /** The expanded sidebar's width, dragged by its right edge. */
  sidebarWidth: number;
  /** The sidebar is hidden and slides out over the page from the window's left edge. */
  compactMode: boolean;
  /** The chrome visual style selected in the theme editor. */
  themeStyle: 'gradient' | 'solid';
  /** Opaque color used by the solid chrome style. */
  solidColor: string;
}

/** The expanded sidebar can be dragged between `minExpanded` and `maxExpanded`. */
export const SIDEBAR_WIDTH = { collapsed: 56, minExpanded: 140, maxExpanded: 240 };

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, SIDEBAR_WIDTH.minExpanded), SIDEBAR_WIDTH.maxExpanded));
}

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
export type ChromeCommand = 'new-tab' | 'focus-address' | 'theme-editor';

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
  openThemeEditor(): void;
  setAppearance(patch: Partial<Appearance>): void;
  setSidebarPeek(open: boolean): void;

  setAdBlockEnabled(enabled: boolean): void;
}
