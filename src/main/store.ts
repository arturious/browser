import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Appearance } from '../shared/types';

/**
 * A small JSON file in the app's userData folder, read once and written back
 * (debounced) whenever it changes — the stand-in for UserDefaults.
 */
export class JsonStore<T> {
  private value: T;
  private readonly file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(name: string, fallback: T) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.value = fallback;
    try {
      this.value = { ...fallback, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      // Missing or unreadable: start from the fallback.
    }
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.flush(), 300);
  }

  /** Writes any pending change right away — called on quit. */
  flush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.value));
    } catch (error) {
      console.error(`Couldn't save ${this.file}:`, error);
    }
  }
}

export interface SessionTab {
  url: string;
  isPinned: boolean;
  pinnedURL: string | null;
  pinnedTitle: string | null;
}

export const sessionStore = new JsonStore<{ tabs: SessionTab[]; activeIndex: number | null }>('session', {
  tabs: [],
  activeIndex: null,
});

/** Per-site zoom levels, keyed by host, so a site you've zoomed stays zoomed. */
export const zoomStore = new JsonStore<Record<string, number>>('zoom', {});

export const settingsStore = new JsonStore<{ adBlockEnabled: boolean } & Appearance>('settings', {
  adBlockEnabled: true,
  showBorder: false,
  sidebarExpanded: false,
  compactMode: false,
});

/** The window's size and position (outside fullscreen), so it reopens the same way. */
export const windowStore = new JsonStore<{ bounds: { x: number; y: number; width: number; height: number } | null }>(
  'window',
  { bounds: null },
);

export function flushAllStores(): void {
  sessionStore.flush();
  zoomStore.flush();
  settingsStore.flush();
  windowStore.flush();
}
