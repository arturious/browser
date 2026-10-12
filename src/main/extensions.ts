import { dialog, session, type Extension } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from './browser';
import { JsonStore } from './store';
import type { BrowserExtension, Rect } from '../shared/types';

interface SavedExtension { path: string; id: string; name: string; enabled: boolean; pinned: boolean; }
export const extensionStore = new JsonStore<{ entries: SavedExtension[] }>('extensions', { entries: [] });

export class BrowserExtensions {
  private errors = new Map<string, string>();
  constructor(private browser: Browser) {}
  async restore(): Promise<void> {
    for (const entry of extensionStore.get().entries) if (entry.enabled) await this.load(entry);
    this.publish();
  }
  private async load(entry: SavedExtension): Promise<void> {
    try {
      const extension = await session.defaultSession.extensions.loadExtension(entry.path, { allowFileAccess: false });
      entry.id = extension.id; entry.name = extension.name; this.errors.delete(entry.id);
    } catch (error) { this.errors.set(entry.id, error instanceof Error ? error.message : 'Could not load extension'); }
  }
  async chooseAndLoad(): Promise<void> {
    const result = await dialog.showOpenDialog(this.browser.win, { title: 'Load unpacked extension', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return;
    try {
      const directory = fs.realpathSync(result.filePaths[0]);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      const name = typeof manifest.name === 'string' ? manifest.name : 'Extension';
      const permissions = [...(Array.isArray(manifest.permissions) ? manifest.permissions : []), ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [])].filter(item => typeof item === 'string');
      const confirmation = await dialog.showMessageBox(this.browser.win, { type: 'question', title: 'Add extension', message: `Add ${name}?`, detail: permissions.length ? `Requested access:\n${permissions.join('\n')}` : 'This extension runs in your browser.', buttons: ['Cancel', 'Add extension'], defaultId: 0, cancelId: 0 });
      if (confirmation.response !== 1) return;
      const extension = await session.defaultSession.extensions.loadExtension(directory, { allowFileAccess: false });
      const entries = extensionStore.get().entries.filter(entry => entry.id !== extension.id && entry.path !== directory);
      extensionStore.set({ entries: [...entries, { path: directory, id: extension.id, name: extension.name, enabled: true, pinned: false }] });
      this.errors.delete(extension.id); this.publish();
    } catch (error) {
      await dialog.showMessageBox(this.browser.win, { type: 'error', message: 'Could not load extension', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  async set(id: string, patch: { enabled?: boolean; pinned?: boolean }): Promise<void> {
    if (!patch || typeof patch !== 'object') return;
    const entries = extensionStore.get().entries;
    const entry = entries.find(item => item.id === id);
    if (!entry) return;
    if (typeof patch.enabled === 'boolean' && patch.enabled !== entry.enabled) {
      entry.enabled = patch.enabled;
      if (entry.enabled) await this.load(entry); else { session.defaultSession.extensions.removeExtension(id); this.errors.delete(id); }
    }
    if (typeof patch.pinned === 'boolean') entry.pinned = patch.pinned;
    extensionStore.set({ entries: [...entries] }); this.publish();
  }
  remove(id: string): void {
    session.defaultSession.extensions.removeExtension(id); this.errors.delete(id);
    extensionStore.set({ entries: extensionStore.get().entries.filter(entry => entry.id !== id) }); this.publish();
  }
  open(id: string, anchor?: Rect): void {
    const entry = this.snapshot().find(item => item.id === id && item.enabled);
    if (entry?.popup) this.browser.openExtensionPopup(entry, anchor);
    else this.browser.openInterfacePanel('extensions', anchor);
  }
  private snapshot(): BrowserExtension[] {
    return extensionStore.get().entries.map(entry => {
      const extension = session.defaultSession.extensions.getExtension(entry.id);
      const manifest = extension?.manifest as Record<string, unknown> | undefined;
      const action = (manifest?.action ?? manifest?.browser_action) as { default_popup?: string; default_icon?: string | Record<string, string> } | undefined;
      const popup = extension && typeof action?.default_popup === 'string' ? this.popupURL(extension, action.default_popup) : undefined;
      return { id: entry.id, name: extension?.name ?? entry.name, version: extension?.version ?? '', enabled: entry.enabled, pinned: entry.pinned,
        icon: extension ? this.icon(extension, action?.default_icon ?? manifest?.icons) : undefined, popup, error: this.errors.get(entry.id) };
    });
  }
  private popupURL(extension: Extension, relative: string): string | undefined {
    const base = `chrome-extension://${extension.id}/`;
    try {
      const url = new URL(relative, base);
      return url.protocol === 'chrome-extension:' && url.hostname === extension.id ? url.href : undefined;
    } catch { return; }
  }
  private icon(extension: Extension, icons: unknown): string | undefined {
    const relative = typeof icons === 'string' ? icons : icons && typeof icons === 'object' ? Object.entries(icons).sort(([a], [b]) => +b - +a)[0]?.[1] : undefined;
    if (typeof relative !== 'string') return;
    try {
      const root = fs.realpathSync(extension.path), file = fs.realpathSync(path.resolve(root, relative));
      if (!file.startsWith(root + path.sep) || fs.statSync(file).size > 150_000 || !/\.(png|jpe?g|webp)$/i.test(file)) return;
      const mime = /\.png$/i.test(file) ? 'png' : /\.webp$/i.test(file) ? 'webp' : 'jpeg';
      return `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch { return; }
  }
  private publish(): void { this.browser.setExtensions(this.snapshot()); }
}
