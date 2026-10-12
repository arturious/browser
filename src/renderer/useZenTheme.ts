import { useEffect, useState } from 'react';
import type { AppState, WorkspaceTheme } from '../shared/types';
import { DEFAULT_THEME } from '../shared/theme';
import { ZenThemeColors } from './zen/theme-colors.js';

export function workspaceThemeStyle(theme: WorkspaceTheme | undefined, dark = true) {
  const current = theme ?? DEFAULT_THEME;
  const colors = new ZenThemeColors(dark, current.opacity);
  return { window: colors.getGradient(current.colors), toolbar: colors.getGradient(current.colors, true) };
}

export function useSystemDark() {
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  return systemDark;
}

export function useZenTheme(state: AppState) {
  const systemDark = useSystemDark();
  const theme = state.workspaces.find(space => space.id === state.activeWorkspaceId)?.theme ?? DEFAULT_THEME;
  const dark = theme.scheme === 'auto' ? systemDark : theme.scheme === 'dark';
  useEffect(() => {
    const root = document.documentElement;
    const styles = workspaceThemeStyle(theme, dark);
    root.dataset.scheme = dark ? 'dark' : 'light'; root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.setProperty('--zen-window-background', styles.window);
    root.style.setProperty('--zen-toolbar-background', styles.toolbar);
    root.style.setProperty('--zen-grainy-background-opacity', String(theme.texture));
    root.style.setProperty('--zen-primary-color', state.workspaces.find(space => space.id === state.activeWorkspaceId)?.color ?? '#9c88ff');
  }, [theme, dark, state.activeWorkspaceId]);
}
