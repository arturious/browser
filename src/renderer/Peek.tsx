import { useEffect, useRef, type CSSProperties } from 'react';
import { Sidebar } from './components/Sidebar';
import { api, useAppState } from './state';

/** How long the sidebar stays out after the pointer leaves it (Zen uses the same). */
const KEEP_OPEN_AFTER_LEAVE = 150;
/** Out but never reached (the pointer touched the edge and moved on): close. */
const CLOSE_IF_NOT_ENTERED = 700;

/**
 * Compact mode's sidebar, in a transparent view main places over the page's
 * left edge. It slides out when the pointer reaches the window's edge, and
 * back once the pointer leaves it.
 */
export function Peek() {
  const state = useAppState();
  const open = state.ui.sidebarPeek;
  const hovered = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (!hovered.current) api.setSidebarPeek(false);
    }, CLOSE_IF_NOT_ENTERED);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <div
      className={`peek ${open ? 'open' : ''} ${state.appearance.themeStyle === 'solid' ? 'solid-theme' : ''}`}
      style={
        {
          '--sidebar-width': `${state.appearance.sidebarWidth}px`,
          '--solid-color': state.appearance.solidColor,
        } as CSSProperties
      }
      onMouseEnter={() => {
        hovered.current = true;
        clearTimeout(leaveTimer.current);
      }}
      onMouseLeave={() => {
        hovered.current = false;
        leaveTimer.current = setTimeout(() => api.setSidebarPeek(false), KEEP_OPEN_AFTER_LEAVE);
      }}
    >
      <Sidebar tabs={state.tabs} activeTabId={state.activeTabId} expanded={state.appearance.sidebarExpanded} />
    </div>
  );
}
