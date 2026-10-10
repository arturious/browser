import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, shell } from 'electron';

const run = promisify(execFile);
const REPO = 'arturious/browser';

/**
 * Checks GitHub Releases for a newer version. When the release carries a
 * .dmg, it can download it, mount it, swap the new app in for the running one
 * on disk, and relaunch — a minimal hand-rolled version of what Sparkle does.
 */
export async function checkForUpdates(userInitiated: boolean): Promise<void> {
  const current = app.getVersion();
  let release: { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] };
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    release = await response.json();
    if (!release.tag_name) throw new Error('No tag');
  } catch {
    if (userInitiated) {
      await alert("Couldn't Check for Updates", 'Please check your internet connection and try again.');
    }
    return;
  }

  const latest = release.tag_name.replace(/^v/, '');
  if (compareVersions(latest, current) <= 0) {
    if (userInitiated) await alert("You're Up to Date", `Browser ${current} is the latest version.`);
    return;
  }

  const dmgURL = release.assets?.find((asset) => asset.name.endsWith('.dmg'))?.browser_download_url;
  // Only offer the in-place install when running as a real installed .app.
  const appPath = installedAppPath();
  const canInstallInPlace = Boolean(dmgURL && appPath);

  const { response } = await dialog.showMessageBox({
    message: 'A New Version is Available',
    detail: `Browser ${latest} is available (you have ${current}).`,
    buttons: [canInstallInPlace ? 'Update Now' : 'View Release', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;

  if (canInstallInPlace && dmgURL && appPath) {
    await installInPlace(dmgURL, appPath);
  } else if (release.html_url) {
    await shell.openExternal(release.html_url);
  }
}

/** The running Browser.app bundle, or null during development. */
function installedAppPath(): string | null {
  if (!app.isPackaged) return null;
  const bundle = path.resolve(process.execPath, '../../..');
  return bundle.endsWith('.app') ? bundle : null;
}

async function installInPlace(dmgURL: string, appPath: string): Promise<void> {
  const progress = showProgress('Downloading update…');
  const dmgPath = path.join(os.tmpdir(), `BrowserUpdate-${randomUUID()}.dmg`);
  const mountPoint = path.join(os.tmpdir(), randomUUID());
  const stagingPath = path.join(path.dirname(appPath), `.${path.basename(appPath)}.update-${randomUUID()}`);
  let mounted = false;
  try {
    const response = await fetch(dmgURL);
    if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
    await fs.writeFile(dmgPath, Buffer.from(await response.arrayBuffer()));

    setProgress(progress, 'Installing update…');
    await run('/usr/bin/hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-quiet']);
    mounted = true;

    const newApp = (await fs.readdir(mountPoint)).find((name) => name.endsWith('.app'));
    if (!newApp) throw new Error("Couldn't find the app inside the downloaded update.");

    // ditto keeps the bundle's symlinks, permissions and code signature intact.
    await run('/usr/bin/ditto', [path.join(mountPoint, newApp), stagingPath]);
    await fs.rm(appPath, { recursive: true, force: true });
    await fs.rename(stagingPath, appPath);

    progress.destroy();
    // `open -n` hands off to Launch Services; waiting for it before quitting
    // avoids quitting before the relaunch request is handed off.
    await run('/usr/bin/open', ['-n', appPath]);
    app.quit();
  } catch (error) {
    if (!progress.isDestroyed()) progress.destroy();
    await alert('Update Failed', error instanceof Error ? error.message : String(error));
  } finally {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dmgPath, { force: true }).catch(() => {});
    if (mounted) await run('/usr/bin/hdiutil', ['detach', mountPoint, '-quiet']).catch(() => {});
    await fs.rm(mountPoint, { recursive: true, force: true }).catch(() => {});
  }
}

/** A tiny "please wait" window, so the app doesn't look frozen while updating. */
function showProgress(message: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 280,
    height: 80,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Updating',
    titleBarStyle: 'hidden',
  });
  setProgress(window, message);
  return window;
}

function setProgress(window: BrowserWindow, message: string): void {
  const html = `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font:13px -apple-system;color-scheme:light dark">${message}</body>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function alert(message: string, detail: string): Promise<void> {
  await dialog.showMessageBox({ message, detail, buttons: ['OK'] });
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}
