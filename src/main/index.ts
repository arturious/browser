import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  type MenuItemConstructorOptions,
} from 'electron';
import type { Appearance, Rect } from '../shared/types';
import { AdBlocker } from './adblock';
import { Browser, chromeWebPreferences } from './browser';
import { RENDERER_HTML } from './paths';
import { flushPermissions, setUpPermissions } from './permissions';
import { flushAllStores } from './store';
import { loadSymbols } from './symbols';
import { checkForUpdates } from './updater';

app.setName('Browser');
// Sites (Google sign-in especially) turn away browsers that announce
// themselves as Electron; present as plain Chrome instead.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ Browser\/\S+/, '');
nativeTheme.themeSource = 'dark';

if (!app.requestSingleInstanceLock()) app.exit(0);

const adBlocker = new AdBlocker();
let browser: Browser | null = null;
let settingsWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
  if (!browser) return;
  if (browser.win.isMinimized()) browser.win.restore();
  browser.win.focus();
});

app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'Browser', applicationVersion: app.getVersion() });
  const pages = session.defaultSession;
  setUpPermissions(pages, () => browser?.win ?? null);
  void adBlocker.start(pages);

  // Rendered before the interface asks for them.
  loadSymbols();
  browser = new Browser(adBlocker);
  adBlocker.onChange = () => browser?.changed();
  registerIPC(browser);
  Menu.setApplicationMenu(buildMenu());
  // Brings the View menu's checkmarks in line with the saved settings.
  browser.setAppearance({});

  void checkForUpdates(false);
});

app.on('before-quit', () => {
  browser?.prepareToQuit();
  flushAllStores();
  flushPermissions();
});

app.on('window-all-closed', () => app.quit());

function showSettings(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 360,
    height: 120,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Settings',
    backgroundColor: '#1e1e1e',
    webPreferences: chromeWebPreferences(),
  });
  browser?.addRenderer(settingsWindow.webContents);
  void settingsWindow.loadFile(RENDERER_HTML, { query: { view: 'settings' } });
}

function registerIPC(browser: Browser): void {
  const on = <A extends unknown[]>(channel: string, handler: (...args: A) => void) => {
    ipcMain.on(channel, (event, ...args) => {
      if (browser.isTrustedSender(event.sender)) handler(...(args as A));
    });
  };
  const withTab = (id: string, action: (tab: NonNullable<Browser['activeTab']>) => void) => {
    const tab = browser.tabs.find((t) => t.id === id);
    if (tab) action(tab);
  };

  ipcMain.on('state:get', (event) => {
    event.returnValue = browser.isTrustedSender(event.sender) ? browser.snapshot() : null;
  });
  ipcMain.on('symbols:get', (event) => {
    event.returnValue = browser.isTrustedSender(event.sender) ? loadSymbols() : {};
  });

  on('tab:select', (id: string) => withTab(id, (tab) => browser.selectTab(tab)));
  on('tab:close', (id: string) => withTab(id, (tab) => browser.closeTab(tab)));
  on('tab:menu', (id: string) => withTab(id, (tab) => browser.showTabMenu(tab)));
  on('nav:back', () => browser.activeTab?.goBack());
  on('nav:forward', () => browser.activeTab?.goForward());
  on('nav:reload', () => browser.activeTab?.reload());
  on('nav:stop', () => browser.activeTab?.stop());
  on('nav:go', (input: string, inNewTab: boolean) => browser.navigate(input, inNewTab));
  on('copy', (text: string) => browser.copyText(text));
  on('pip:toggle', () => browser.togglePiP());
  on('page:focus', () => browser.activeTab?.webContents?.focus());
  on('ui:page-bounds', (rect: Rect) => browser.setPageBounds(rect));
  on('ui:topbar-menu', () => browser.showTopBarMenu());
  on('ui:sidebar-peek', (open: boolean) => browser.setSidebarPeek(Boolean(open)));
  on('appearance:set', (patch: Partial<Appearance>) => browser.setAppearance(patch));
  on('tab:new', () => browser.command('new-tab'));
  on('adblock:set', (enabled: boolean) => adBlocker.setEnabled(enabled));
  on('window:close', () => browser.win.close());
  on('window:minimize', () => browser.win.minimize());
  on('window:zoom', (fill: boolean) => browser.zoomWindow(fill));

  // From the helper script inside every web page.
  ipcMain.on('page:media', (event, state: { video: boolean; media: boolean }) => {
    browser.tabFor(event.sender)?.setMediaState(Boolean(state?.video), Boolean(state?.media));
  });
  ipcMain.on('page:pip-exited', (event) => {
    const tab = browser.tabFor(event.sender);
    if (tab) browser.pipExited(tab);
  });
  ipcMain.on('page:swipe', (event, isBack: boolean) => {
    const tab = browser.tabFor(event.sender);
    if (isBack) tab?.goBack();
    else tab?.goForward();
  });
}

function buildMenu(): Menu {
  const active = () => browser?.activeTab;
  const tabShortcuts: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: `Select Tab ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    visible: false,
    click: () => browser?.selectTabAt(i),
  }));

  return Menu.buildFromTemplate([
    {
      label: 'Browser',
      submenu: [
        { role: 'about', label: 'About Browser' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: showSettings },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Browser' },
        { role: 'hideOthers' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Browser' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => browser?.command('new-tab') },
        {
          label: 'Open Location…',
          accelerator: 'CmdOrCtrl+L',
          click: () => active() && browser?.command('focus-address'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const tab = active();
            if (tab) browser?.closeTab(tab);
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => active()?.reload() },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => active()?.zoomIn() },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => active()?.zoomIn() },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => active()?.zoomOut() },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => active()?.resetZoom() },
        { type: 'separator' },
        {
          label: 'Expand Sidebar',
          type: 'checkbox',
          checked: false,
          click: (item) => browser?.setAppearance({ sidebarExpanded: item.checked }),
          id: 'expand-sidebar',
        },
        {
          label: 'Compact Mode',
          type: 'checkbox',
          accelerator: 'Ctrl+Alt+C',
          checked: false,
          click: (item) => browser?.setAppearance({ compactMode: item.checked }),
          id: 'compact-mode',
        },
        { type: 'separator' },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => active()?.webContents?.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Enter Full Screen', accelerator: 'Ctrl+Cmd+F' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => active()?.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => active()?.goForward() },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...tabShortcuts],
    },
  ]);
}
