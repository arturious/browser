import type { WorkspaceTheme } from './types';

export const DEFAULT_THEME: WorkspaceTheme = { colors: [], opacity: .5, texture: 0, scheme: 'dark' };
export const DEFAULT_TOOLBAR_ITEMS = ['extensions', 'library', 'menu'];
export const TOOLBAR_ITEMS = ['extensions', 'library', 'menu', 'theme', 'settings', 'compact', 'pip'];
export function normalizeTheme(value: unknown): WorkspaceTheme | null {
  if (!value || typeof value !== 'object') return null;
  const theme = value as WorkspaceTheme;
  if (!Array.isArray(theme.colors) || theme.colors.length > 16 || !['dark', 'light', 'auto'].includes(theme.scheme) ||
    !Number.isFinite(theme.opacity) || !Number.isFinite(theme.texture)) return null;
  const colors = theme.colors.map(dot => {
    if (!dot || !dot.position || !Number.isFinite(dot.position.x) || !Number.isFinite(dot.position.y)) return null;
    const c = dot.c;
    if (typeof c === 'string' ? !/^#[0-9a-f]{6}$|^rgba?\([\d.,\s]+\)$/i.test(c) : !Array.isArray(c) || c.length !== 3 || !c.every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
    return { c, position: { x: Math.max(0, Math.min(360, dot.position.x)), y: Math.max(0, Math.min(360, dot.position.y)) },
      isPrimary: Boolean(dot.isPrimary), isCustom: Boolean(dot.isCustom), type: ['explicit-lightness', 'explicit-black-white'].includes(dot.type ?? '') ? dot.type : undefined,
      algorithm: typeof dot.algorithm === 'string' ? dot.algorithm.slice(0, 30) : '', lightness: Number.isFinite(dot.lightness) ? dot.lightness : 50 };
  });
  if (colors.some(dot => dot === null)) return null;
  if (colors.filter(dot => dot && !dot.isCustom).length > 3) return null;
  return { colors: colors as WorkspaceTheme['colors'], opacity: Math.max(.3, Math.min(.8, theme.opacity)), texture: Math.max(0, Math.min(1, theme.texture)), scheme: theme.scheme };
}
export function normalizeWorkspaceIcon(icon: string): string {
  return /^zen:[a-z0-9-]+\.svg$/.test(icon) ? icon.slice(0, 70) : icon.slice(0, 8);
}
