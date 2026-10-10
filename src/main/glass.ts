import path from 'node:path';
import type { BrowserWindow } from 'electron';

interface GlassAddon {
  addGlass(handle: Buffer, cornerRadius: number): boolean;
}

/** macOS window corner radius (NSWindow._cornerRadius on macOS 26+). */
const WINDOW_CORNER_RADIUS = 16;

/**
 * Puts Liquid Glass behind the window's content (the window must be created
 * with `transparent: true`). Built from native/glass.mm by scripts/build.mjs.
 * Before macOS 26 there's no glass, and the window is just see-through
 * behind the interface's own tint.
 */
export function applyGlass(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  try {
    const addon = require(path.join(__dirname, '../native/glass.node')) as GlassAddon;
    addon.addGlass(win.getNativeWindowHandle(), WINDOW_CORNER_RADIUS);
  } catch (error) {
    console.error("Couldn't load the Liquid Glass addon:", error);
  }
}
