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
  isEssential: boolean;
  workspaceId: string;
  folderId: string | null;
  isUnloaded: boolean;
}

export interface UIState {
  /** Compact mode's sidebar is out, over the page. */
  sidebarPeek: boolean;
  isHtmlFullscreen: boolean;
  /** The traffic lights are hidden while the window is fullscreen. */
  isWindowFullscreen: boolean;
  libraryOpen: boolean;
  libraryProgress: number;
  libraryAnimating: boolean;
  libraryGestureActive: boolean;
  librarySizing: boolean;
  librarySection: LibrarySection;
  libraryWidth: number;
  mediaPreview: { id: string; origin: Rect } | null;
  interfacePanel: InterfacePanelState | null;
}

export type InterfacePanel = 'address' | 'theme' | 'extensions' | 'menu' | 'customize' | 'workspace' | 'site' | 'extension-popup' | 'create';
export interface InterfacePanelState {
  kind: InterfacePanel;
  anchor?: Rect;
  workspaceId?: string;
  newTab?: boolean;
  requestId?: number;
}
export interface ThemeDot {
  c: [number, number, number] | string;
  position: { x: number; y: number };
  isPrimary?: boolean;
  isCustom?: boolean;
  type?: string;
  algorithm?: string;
  lightness?: number;
}
export interface WorkspaceTheme {
  colors: ThemeDot[];
  opacity: number;
  texture: number;
  scheme: 'auto' | 'light' | 'dark';
}
export interface BrowserExtension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  pinned: boolean;
  icon?: string;
  popup?: string;
  error?: string;
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
  toolbarItems: string[];
  interfaceRevision: number;
}

/** The expanded sidebar can be dragged between `minExpanded` and `maxExpanded`. */
export const SIDEBAR_WIDTH = { collapsed: 56, minExpanded: 180, maxExpanded: 360 };

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, SIDEBAR_WIDTH.minExpanded), SIDEBAR_WIDTH.maxExpanded));
}

export type LibrarySection = 'media' | 'downloads' | 'boosts' | 'spaces' | 'history';
export interface SidebarWheelPhase {
  phase: 'none' | 'began' | 'changed' | 'ended' | 'cancelled';
  momentum: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  activeTabId: string | null;
  theme?: WorkspaceTheme;
}

export interface TabFolder {
  id: string;
  workspaceId: string;
  name: string;
  collapsed: boolean;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
}

export interface DownloadEntry {
  id: string;
  name: string;
  url: string;
  path: string;
  startedAt: number;
  receivedBytes: number;
  totalBytes: number;
  status: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  thumbnail?: string;
  paused?: boolean;
  openWhenDone?: boolean;
}

export interface SiteBoost {
  id: string;
  domain: string;
  name: string;
  css: string;
  enabled: boolean;
}

export interface AppState {
  tabs: TabState[];
  activeTabId: string | null;
  adBlockEnabled: boolean;
  appearance: Appearance;
  ui: UIState;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  folders: TabFolder[];
  history: HistoryEntry[];
  downloads: DownloadEntry[];
  boosts: SiteBoost[];
  extensions: BrowserExtension[];
}

/** One-shot commands main sends to the chrome renderer. */
export type ChromeCommand = 'new-tab' | 'focus-address' | 'theme-editor' | 'create-workspace' | 'create-folder';

export interface BrowserAPI {
  getState(): AppState;
  onState(listener: (state: AppState) => void): () => void;
  /** Per-frame geometry; bypasses React's content/list rendering. */
  onLibraryMotion(listener: (ui: UIState) => void): () => void;
  onSidebarWheelPhase(listener: (phase: SidebarWheelPhase) => void): () => void;
  onCommand(listener: (command: ChromeCommand) => void): () => void;
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
  openInterfacePanel(kind: InterfacePanel, anchor?: Rect, workspaceId?: string): void;
  closeInterfacePanel(): void;
  interfacePanelReady(requestId: number): void;
  openSettings(): void;
  loadExtension(): void;
  setExtension(id: string, patch: { enabled?: boolean; pinned?: boolean }): void;
  removeExtension(id: string): void;
  openExtension(id: string, anchor?: Rect): void;
  setWorkspaceTheme(id: string, theme: WorkspaceTheme): void;
  setAppearance(patch: Partial<Appearance>): void;
  setSidebarPeek(open: boolean): void;
  toggleLibrary(section?: LibrarySection): void;
  closeLibrary(): void;
  setLibraryGesture(progress: number, target?: boolean): void;
  setLibraryWidth(width: number): void;
  selectLibrarySection(section: LibrarySection): void;
  requestWorkspaceCreation(): void;
  requestFolderCreation(): void;
  selectWorkspace(id: string): void;
  createWorkspace(name: string, icon: string, color: string, theme?: WorkspaceTheme): void;
  updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'name' | 'icon' | 'color'>>): void;
  reorderWorkspace(id: string, index: number): void;
  showWorkspaceMenu(id: string): void;
  createFolder(name: string): void;
  toggleFolder(id: string): void;
  showFolderMenu(id: string): void;
  moveTab(id: string, beforeId: string | null, workspaceId: string, folderId: string | null): void;
  togglePin(id: string): void;
  toggleEssential(id: string): void;
  openDownload(id: string, reveal?: boolean): void;
  showDownloadMenu(id: string): void;
  onDownloadMenuClosed(listener: () => void): () => void;
  playHapticFeedback(): void;
  previewDownload(id: string, origin: Rect): void;
  closeMediaPreview(): void;
  stepMediaPreview(direction: number): void;
  controlDownload(id: string, action: 'pause' | 'resume' | 'cancel'): void;
  saveBoost(boost: Omit<SiteBoost, 'id'> & { id?: string }): void;
  toggleBoost(id: string): void;
  showBoostMenu(id: string): void;
  clearHistory(): void;

  setAdBlockEnabled(enabled: boolean): void;
}
