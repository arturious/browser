import { nativeImage } from 'electron';
import type { SymbolImage, SymbolWeight } from '../shared/types';

/** Every SF Symbol the interface uses. */
const SYMBOL_NAMES = [
  'arrow.backward',
  'arrow.forward',
  'arrow.clockwise',
  'xmark',
  'plus',
  'sidebar.left',
  'pin',
  'pip',
  'speaker.wave.2',
  'link',
  'checkmark',
  'macwindow',
];
const WEIGHTS: SymbolWeight[] = ['regular', 'bold'];
/** Rendered large and scaled down by the interface, so they stay crisp. */
const POINT_SIZE = 56;
/**
 * How wide AppKit draws `arrow.backward` (regular), per point of font size.
 * Electron returns symbols at a pixel density of its own choosing, so
 * measuring this one symbol tells how many pixels it used per point.
 */
const REFERENCE_WIDTH_PER_POINT = 65 / 56;

let cache: Record<string, SymbolImage> | null = null;

/**
 * The SF Symbols, rendered by macOS itself (Apple's license allows them only
 * through the system) in the same weights SwiftUI's
 * .font(.system(size:weight:)) uses, as PNGs the interface uses as CSS
 * masks, so they can take any color. A symbol the system doesn't have is
 * left out, and the interface falls back to a Lucide icon for it.
 */
export function loadSymbols(): Record<string, SymbolImage> {
  if (cache) return cache;
  cache = {};
  if (process.platform !== 'darwin') return cache;

  const reference = nativeImage.createFromNamedImage('arrow.backward', { pointSize: POINT_SIZE });
  const pixelsPerPoint = reference.isEmpty() ? 1 : reference.getSize().width / (REFERENCE_WIDTH_PER_POINT * POINT_SIZE);

  for (const name of SYMBOL_NAMES) {
    for (const weight of WEIGHTS) {
      const image = nativeImage.createFromNamedImage(name, { pointSize: POINT_SIZE, weight });
      if (image.isEmpty()) continue;
      const { width, height } = image.getSize();
      cache[`${name}:${weight}`] = { url: image.toDataURL(), width, height, pointSize: POINT_SIZE * pixelsPerPoint };
    }
  }
  return cache;
}
