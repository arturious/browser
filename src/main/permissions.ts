import { dialog, type BrowserWindow, type Session } from 'electron';
import { hostOf } from '../shared/url';
import { JsonStore } from './store';

/** Harmless: granted without asking. */
const ALWAYS_ALLOWED = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'speaker-selection']);

/** Worth asking about, in plain words. Anything not listed here or above is refused. */
const ASK: Record<string, string> = {
  media: 'use your camera and microphone',
  geolocation: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'see what you copied',
  midi: 'use your MIDI devices',
  midiSysex: 'use your MIDI devices',
  openExternal: 'open another app',
};

/** Remembered answers, keyed by "origin permission". */
const decisions = new JsonStore<Record<string, boolean>>('permissions', {});

/**
 * Electron grants every permission silently by default. Instead, sites ask
 * once per site and the answer is remembered.
 */
export function setUpPermissions(session: Session, getWindow: () => BrowserWindow | null): void {
  const keyFor = (origin: string, permission: string) => `${origin} ${permission}`;

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const what = ASK[permission];
    if (!what) return callback(false);

    const origin = originOf(details.requestingUrl || webContents.getURL());
    const key = keyFor(origin, permission);
    const remembered = decisions.get()[key];
    if (remembered !== undefined) return callback(remembered);

    const window = getWindow();
    const options = {
      type: 'question' as const,
      message: `${hostOf(origin) ?? origin} wants to ${what}`,
      buttons: ['Allow', 'Block'],
      defaultId: 0,
      cancelId: 1,
    };
    void (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)).then(({ response }) => {
      const allowed = response === 0;
      decisions.set({ ...decisions.get(), [key]: allowed });
      callback(allowed);
    });
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (ALWAYS_ALLOWED.has(permission)) return true;
    if (!(permission in ASK)) return true;
    return decisions.get()[keyFor(originOf(requestingOrigin), permission)] === true;
  });
}

export function flushPermissions(): void {
  decisions.flush();
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
