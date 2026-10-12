// The bridge between the browser's own interface (chrome, compact sidebar, settings)
// and the main process. Exposed as `window.browser`.
import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, BrowserAPI, ChromeCommand, UIState, SidebarWheelPhase } from '../shared/types';

const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let latestState: AppState;
const getState = () => latestState ??= ipcRenderer.sendSync('state:get') as AppState;

const api: BrowserAPI = {
  getState,
  onState: (listener) => {
    getState();
    const full = subscribe<AppState>('state', (state) => { latestState = state; listener(state); });
    const motion = subscribe<UIState>('library:motion', (ui) => {
      const previous = latestState.ui;
      latestState = { ...latestState, ui };
      // Position/width frames update transforms directly. React only needs
      // changes to open/closing/gesture state, sections and window controls.
      if (Object.keys(ui).some(key => key !== 'libraryProgress' && key !== 'libraryWidth' &&
        ui[key as keyof UIState] !== previous[key as keyof UIState])) listener(latestState);
    });
    return () => { full(); motion(); };
  },
  onLibraryMotion: (listener) => {
    const motion = subscribe<UIState>('library:motion', listener);
    const full = subscribe<AppState>('state', (state) => listener(state.ui));
    return () => { motion(); full(); };
  },
  onCommand: (listener) => subscribe<ChromeCommand>('command', listener),
  onSidebarWheelPhase: listener => subscribe<SidebarWheelPhase>('sidebar:wheel-phase', listener),
  newTab: () => send('tab:new'),
  selectTab: (id) => send('tab:select', id),
  closeTab: (id) => send('tab:close', id),
  showTabMenu: (id) => send('tab:menu', id),
  goBack: () => send('nav:back'),
  goForward: () => send('nav:forward'),
  reload: () => send('nav:reload'),
  stop: () => send('nav:stop'),
  navigate: (input, inNewTab) => send('nav:go', input, inNewTab),
  copyText: (text) => send('copy', text),
  togglePiP: () => send('pip:toggle'),
  focusPage: () => send('page:focus'),
  openThemeEditor: () => send('ui:theme-editor'),
  openInterfacePanel: (kind, anchor, workspaceId) => send('ui:panel', kind, anchor, workspaceId),
  closeInterfacePanel: () => send('ui:panel-close'),
  interfacePanelReady: requestId => send('ui:panel-ready', requestId),
  openSettings: () => send('ui:settings'),
  loadExtension: () => send('extension:load'),
  setExtension: (id, patch) => send('extension:set', id, patch),
  removeExtension: id => send('extension:remove', id),
  openExtension: (id, anchor) => send('extension:open', id, anchor),
  setWorkspaceTheme: (id, theme) => send('workspace:theme', id, theme),

  setPageBounds: (rect) => send('ui:page-bounds', rect),
  showTopBarMenu: () => send('ui:topbar-menu'),
  setAppearance: (patch) => send('appearance:set', patch),
  setSidebarPeek: (open) => send('ui:sidebar-peek', open),
  toggleLibrary: (section) => send('library:toggle', section),
  closeLibrary: () => send('library:close'),
  setLibraryGesture: (progress, target) => send('library:gesture', progress, target),
  setLibraryWidth: (width) => send('library:width', width),
  selectLibrarySection: (section) => send('library:section', section),
  requestWorkspaceCreation: () => send('workspace:prompt'),
  requestFolderCreation: () => send('folder:prompt'),
  selectWorkspace: (id) => send('workspace:select', id),
  createWorkspace: (name, icon, color, theme) => send('workspace:create', name, icon, color, theme),
  updateWorkspace: (id, patch) => send('workspace:update', id, patch),
  reorderWorkspace: (id, index) => send('workspace:reorder', id, index),
  showWorkspaceMenu: (id) => send('workspace:menu', id),
  createFolder: (name) => send('folder:create', name),
  toggleFolder: (id) => send('folder:toggle', id),
  showFolderMenu: (id) => send('folder:menu', id),
  moveTab: (id, beforeId, workspaceId, folderId) => send('tab:move', id, beforeId, workspaceId, folderId),
  togglePin: (id) => send('tab:pin', id),
  toggleEssential: (id) => send('tab:essential', id),
  controlDownload: (id, action) => send('download:control', id, action),
  saveBoost: (boost) => send('boost:save', boost),
  toggleBoost: (id) => send('boost:toggle', id),
  showBoostMenu: (id) => send('boost:menu', id),
  openDownload: (id, reveal) => send('download:open', id, reveal),
  showDownloadMenu: id => send('download:menu', id),
  onDownloadMenuClosed: listener => subscribe('download:menu-closed', listener),
  playHapticFeedback: () => send('ui:haptic'),
  previewDownload: (id, origin) => send('download:preview', id, origin),
  closeMediaPreview: () => send('download:preview-close'),
  stepMediaPreview: direction => send('download:preview-step', direction),
  clearHistory: () => send('history:clear'),

  setAdBlockEnabled: (enabled) => send('adblock:set', enabled),
};

contextBridge.exposeInMainWorld('browser', api);
