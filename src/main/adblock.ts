import fs from 'node:fs/promises';
import path from 'node:path';
import { app, type Session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import { settingsStore } from './store';

const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;

/**
 * Blocks ads and trackers with Ghostery's engine and the standard public
 * lists (EasyList, EasyPrivacy, uBlock Origin's), network requests and
 * cosmetic (element-hiding) rules both. The compiled engine is cached on
 * disk and rebuilt from fresh lists once a day.
 */
export class AdBlocker {
  private blocker: ElectronBlocker | null = null;
  private session: Session | null = null;
  onChange: (() => void) | null = null;

  get enabled(): boolean {
    return settingsStore.get().adBlockEnabled;
  }

  async start(session: Session): Promise<void> {
    this.session = session;
    const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
    try {
      const stat = await fs.stat(cache).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > UPDATE_INTERVAL) await fs.rm(cache, { force: true });
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cache,
        read: fs.readFile,
        write: fs.writeFile,
      });
    } catch (error) {
      console.error("Couldn't load the ad-block lists:", error);
      return;
    }
    this.apply();
  }

  setEnabled(enabled: boolean): void {
    settingsStore.set({ ...settingsStore.get(), adBlockEnabled: enabled });
    this.apply();
    this.onChange?.();
  }

  private apply(): void {
    const { blocker, session } = this;
    if (!blocker || !session) return;
    const active = blocker.isBlockingEnabled(session);
    if (this.enabled && !active) blocker.enableBlockingInSession(session);
    if (!this.enabled && active) blocker.disableBlockingInSession(session);
  }
}
