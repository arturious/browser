import path from 'node:path';
import type { BrowserWindow } from 'electron';

interface GlassAddon {
  addGlass(handle: Buffer, cornerRadius: number): boolean;
  setGlassCornerRadius(handle: Buffer, cornerRadius: number): boolean;
}

/** macOS window corner radius (NSWindow._cornerRadius on macOS 26+). */
const WINDOW_CORNER_RADIUS = 16;

let addon: GlassAddon | null | undefined;

function loadAddon(): GlassAddon | null {
  if (addon !== undefined) return addon;
  addon = null;
  if (process.platform !== 'darwin') return addon;
  try {
    // Built from native/glass.mm by scripts/build.mjs.
    addon = require(path.join(__dirname, '../native/glass.node')) as GlassAddon;
  } catch (error) {
    console.error("Couldn't load the Liquid Glass addon:", error);
  }
  return addon;
}

/**
 * Puts Liquid Glass behind the window's content (the window must be created
 * with `transparent: true`). Before macOS 26 there's no glass, and the window
 * is just see-through behind the interface's own tint.
 */
export function applyGlass(win: BrowserWindow): void {
  loadAddon()?.addGlass(win.getNativeWindowHandle(), WINDOW_CORNER_RADIUS);
}

/** Square corners while the window is fullscreen, the window's own otherwise. */
export function setGlassFullscreen(win: BrowserWindow, fullscreen: boolean): void {
  loadAddon()?.setGlassCornerRadius(win.getNativeWindowHandle(), fullscreen ? 0 : WINDOW_CORNER_RADIUS);
}

