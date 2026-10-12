import { useLayoutEffect, useRef } from 'react';
import type { AppState } from '../shared/types';
import { api } from './state';

/** Move only composited layers on motion frames. Library content, tabs and
 * history remain mounted without running React's render/filter/map work. */
export function useLibraryMotion(state: AppState, sidebarWidth = state.appearance.sidebarWidth) {
  const pageOffset = useRef(0);
  useLayoutEffect(() => {
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const page = document.querySelector<HTMLElement>('.page');
    const sidebar = document.querySelector<HTMLElement>('.sidebar-slot');
    const library = document.querySelector<HTMLElement>('.zen-library');
    const peek = document.querySelector<HTMLElement>('.peek');
    const { compactMode, sidebarExpanded } = state.appearance;
    const sidebarSize = compactMode ? 8 : sidebarExpanded ? sidebarWidth : 56;
    let latest = api.getState().ui;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const width = Math.min(Math.max(418, latest.libraryWidth), window.innerWidth * 0.95);
      // WebContentsView positions are integers; use the same pixel grid for
      // the adjoining chrome instead of letting their edges shimmer apart.
      const offset = Math.round((width - sidebarSize) * latest.libraryProgress);
      const toolbox = Math.min(1, Math.max(0, latest.libraryProgress) * 3);
      pageOffset.current = offset;
      for (const element of [topbar, page]) {
        if (element) element.style.transform = `translateX(${offset}px)`;
      }
      if (sidebar) {
        sidebar.style.opacity = `${1 - toolbox}`;
        sidebar.style.transform = `scale(${1 - toolbox * 0.04})`;
      }
      if (library) {
        library.style.width = `${width}px`;
        library.style.transform = `translateX(${Math.round((latest.libraryProgress - 1) * width)}px)`;
      }
      if (peek) {
        const moving = latest.libraryAnimating || latest.libraryOpen;
        peek.style.transition = moving ? 'none' : '';
        peek.style.transform = moving ? `translateX(${-Math.round(toolbox * (sidebarExpanded ? sidebarWidth : 56))}px)` : '';
      }
    };
    const unsubscribe = api.onLibraryMotion(ui => {
      latest = ui;
      if (!frame) frame = requestAnimationFrame(apply);
    });
    window.addEventListener('resize', apply);
    apply();
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', apply);
    };
  }, [state.appearance.compactMode, state.appearance.sidebarExpanded, sidebarWidth]);
  return pageOffset;
}
