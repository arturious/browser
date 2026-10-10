// The bridge between the browser's own interface (chrome, overlay, settings)
// and the main process. Exposed as `window.browser`.
import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, BrowserAPI, ChromeCommand } from '../shared/types';

const send = (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: BrowserAPI = {
  getState: () => ipcRenderer.sendSync('state:get') as AppState,
  onState: (listener) => subscribe<AppState>('state', listener),
  onCommand: (listener) => subscribe<ChromeCommand>('command', listener),
  // Fetched synchronously once, so icons are there on the very first render.
  symbols: ipcRenderer.sendSync('symbols:get'),

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

  setPageBounds: (rect) => send('ui:page-bounds', rect),
  setHoveredTab: (tab) => send('ui:hovered-tab', tab),
  setPopover: (popover, anchor) => send('ui:popover', popover, anchor),

  openDownload: (id) => send('download:open', id),
  showDownloadMenu: (id) => send('download:menu', id),
  setAdBlockEnabled: (enabled) => send('adblock:set', enabled),
};

contextBridge.exposeInMainWorld('browser', api);
