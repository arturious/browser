/**
 * Adjusts a page's <meta name="theme-color"> for the loading pill on our dark
 * chrome. Real browsers don't apply theme-color verbatim either: the spec lets
 * a user agent adapt it, and Chrome picks contrast programmatically.
 *
 * - Near-white (e.g. YouTube's rgba(255,255,255,0.98)) would barely show up,
 *   so it becomes a dark gray instead.
 * - A distinct brand color is used as-is.
 * - Anything else (grays, unparseable values) falls back to the default.
 */
export function adjustThemeColor(value: string | null): string | null {
  if (!value) return null;
  const rgb = parseCssColor(value);
  if (!rgb) return null;
  const { saturation, brightness } = toHsb(rgb);
  if (saturation < 0.15 && brightness > 0.75) return 'rgb(38, 38, 38)';
  if (saturation >= 0.15 && brightness > 0.15) return `rgb(${rgb.join(', ')})`;
  return null;
}

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() — the formats sites actually use. */
function parseCssColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(trimmed)?.[1];
  if (rgb) {
    const parts = rgb.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return parts.slice(0, 3) as [number, number, number];
    }
  }
  return null;
}

function toHsb([r, g, b]: [number, number, number]): { saturation: number; brightness: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return { saturation: max === 0 ? 0 : (max - min) / max, brightness: max };
}
