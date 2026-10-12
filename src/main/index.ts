import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  type MenuItemConstructorOptions,
} from 'electron';
import type { Appearance, Rect, LibrarySection, Workspace, SiteBoost, InterfacePanel, WorkspaceTheme } from '../shared/types';
import { AdBlocker } from './adblock';
import { Browser, chromeWebPreferences } from './browser';
import { RENDERER_HTML } from './paths';
import { flushPermissions, setUpPermissions } from './permissions';
import { flushAllStores } from './store';
import { BrowserExtensions, extensionStore } from './extensions';
import { checkForUpdates } from './updater';
import { declareMediaProtocol, registerMediaProtocol } from './media';
import { playHapticFeedback } from './glass';

declareMediaProtocol();

app.setName('Browser');
// Sites (Google sign-in especially) turn away browsers that announce
// themselves as Electron; present as plain Chrome instead.
app.userAgentFallback = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ Browser\/\S+/, '');
nativeTheme.themeSource = 'system';

if (!app.requestSingleInstanceLock()) app.exit(0);

const adBlocker = new AdBlocker();
let browser: Browser | null = null;
let settingsWindow: BrowserWindow | null = null;
let extensions: BrowserExtensions | null = null;

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

  registerMediaProtocol();
  browser = new Browser(adBlocker);
  extensions = new BrowserExtensions(browser);
  void extensions.restore();
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
  extensionStore.flush();
  flushPermissions();
});

app.on('window-all-closed', () => app.quit());

function showSettings(view: 'settings' | 'theme' = 'settings'): void {
  if (view === 'theme') { browser?.openInterfacePanel('theme'); return; }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setSize(780, 560);
    settingsWindow.show();
    settingsWindow.focus();
    void settingsWindow.loadFile(RENDERER_HTML, { query: { view } });
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 780,
    height: 560,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: '#1e1e1e',
    webPreferences: chromeWebPreferences(),
  });
  browser?.addRenderer(settingsWindow.webContents);
  void settingsWindow.loadFile(RENDERER_HTML, { query: { view } });
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
  on('ui:theme-editor', () => showSettings('theme'));
  on('ui:panel', (kind: InterfacePanel, anchor?: Rect, workspace?: string) => browser.openInterfacePanel(kind, anchor, workspace));
  on('ui:panel-close', () => browser.closeInterfacePanel());
  ipcMain.on('ui:panel-ready', (event, requestId: number) => browser.interfacePanelReady(event.sender, requestId));
  on('ui:settings', () => { browser.closeInterfacePanel(); showSettings(); });
  on('extension:load', () => { void extensions?.chooseAndLoad(); });
  on('extension:set', (id: string, patch: { enabled?: boolean; pinned?: boolean }) => { void extensions?.set(id, patch); });
  on('extension:remove', (id: string) => extensions?.remove(id));
  on('extension:open', (id: string, anchor?: Rect) => extensions?.open(id, anchor));
  on('workspace:theme', (id: string, theme: WorkspaceTheme) => browser.setWorkspaceTheme(id, theme));
  on('ui:sidebar-peek', (open: boolean) => browser.setSidebarPeek(Boolean(open)));
  on('appearance:set', (patch: Partial<Appearance>) => browser.setAppearance(patch));
  on('tab:new', () => { browser.animateLibrary(false); browser.command('new-tab'); });
  on('tab:pin', (id: string) => withTab(id, (tab) => browser.togglePin(tab)));
  on('tab:essential', (id: string) => withTab(id, (tab) => browser.toggleEssential(tab)));
  on('tab:move', (id: string, before: string | null, workspace: string, folder: string | null) => browser.moveTab(id, before, workspace, folder));
  on('workspace:prompt', () => browser.command('create-workspace'));
  on('folder:prompt', () => { browser.closeInterfacePanel(false); browser.command('create-folder'); });
  on('workspace:select', (id: string) => browser.selectWorkspace(id));
  on('workspace:create', (name: string, icon: string, color: string, theme?: WorkspaceTheme) => browser.createWorkspace(name, icon, color, theme));
  on('workspace:update', (id: string, patch: Partial<Pick<Workspace, 'name' | 'icon' | 'color'>>) => browser.updateWorkspace(id, patch));
  on('workspace:reorder', (id: string, index: number) => browser.reorderWorkspace(id, index));
  on('workspace:menu', (id: string) => browser.showWorkspaceMenu(id));
  on('folder:create', (name: string) => browser.createFolder(name));
  on('folder:toggle', (id: string) => browser.toggleFolder(id));
  on('folder:menu', (id: string) => browser.showFolderMenu(id));
  on('library:toggle', (section?: LibrarySection) => browser.toggleLibrary(section));
  on('library:close', () => browser.animateLibrary(false));
  on('library:gesture', (progress: number, target?: boolean) => browser.setLibraryGesture(progress, target));
  on('library:section', (section: LibrarySection) => browser.selectLibrarySection(section));
  on('library:width', (width: number) => browser.setLibraryWidth(width));
  on('boost:save', (boost: Omit<SiteBoost, 'id'> & { id?: string }) => browser.saveBoost(boost));
  on('boost:toggle', (id: string) => browser.toggleBoost(id));
  on('boost:menu', (id: string) => browser.showBoostMenu(id));
  on('download:control', (id: string, action: 'pause' | 'resume' | 'cancel') => browser.controlDownload(id, action));
  on('download:open', (id: string, reveal?: boolean) => browser.openDownload(id, reveal));
  on('download:menu', (id: string) => browser.showDownloadMenu(id));
  on('ui:haptic', () => playHapticFeedback());
  on('download:preview', (id: string, origin: Rect) => browser.previewDownload(id, origin));
  on('download:preview-close', () => browser.closeMediaPreview());
  on('download:preview-step', (direction: number) => browser.stepMediaPreview(direction));
  on('history:clear', () => browser.clearHistory());
  on('adblock:set', (enabled: boolean) => adBlocker.setEnabled(enabled));

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
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => showSettings() },
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
        { label: 'Library', accelerator: 'CmdOrCtrl+Shift+L', click: () => browser?.toggleLibrary() },
        { label: 'New Space…', click: () => browser?.command('create-workspace') },
        { label: 'Previous Space', accelerator: 'Ctrl+Alt+Left', click: () => browser?.cycleWorkspace(-1) },
        { label: 'Next Space', accelerator: 'Ctrl+Alt+Right', click: () => browser?.cycleWorkspace(1) },
        { type: 'separator' },
        { label: 'Browser Interface Developer Tools', accelerator: 'CmdOrCtrl+Shift+Alt+I', click: () => {
          const contents = browser?.win.webContents;
          if (contents?.isDevToolsOpened()) contents.closeDevTools();
          else contents?.openDevTools({ mode: 'detach' });
        } },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => active()?.webContents?.toggleDevTools(),
        },
        // macOS adds its own "Enter Full Screen" item to the View menu.
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => active()?.goBack() },
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => browser?.toggleLibrary('history') },
        { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => browser?.toggleLibrary('downloads') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => active()?.goForward() },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...tabShortcuts],
    },
  ]);
}
