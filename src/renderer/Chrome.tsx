import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { clampSidebarWidth } from '../shared/types';
import { LoadingPill } from './components/LoadingPill';
import { Sidebar } from './components/Sidebar';
import { AddressBar, CompactModeButton, NavigationControls } from './components/TopBar';
import { api, rectOf, useAppState } from './state';

/** The window's own interface: top bar, sidebar, and the hole the page shows through. */
export function Chrome() {
  const state = useAppState();
  const { sidebarExpanded, compactMode, showBorder, themeStyle, solidColor } = state.appearance;
  // While dragging the sidebar's edge, the width lives here; it's saved on release.
  const [draggedWidth, setDraggedWidth] = useState<number | null>(null);
  const sidebarWidth = draggedWidth ?? state.appearance.sidebarWidth;
  const pageRef = useRef<HTMLDivElement>(null);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);

  // The page's WebContentsView follows this element around, frame by frame
  // while the sidebar slides.
  useLayoutEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const report = () => api.setPageBounds(rectOf(element));
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    report();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, []);

  // ResizeObserver misses pure moves, so follow the sidebar's transition too.
  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    const until = performance.now() + 380;
    let frame = 0;
    const step = () => {
      api.setPageBounds(rectOf(element));
      if (performance.now() < until) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [sidebarExpanded, compactMode, showBorder]);

  return (
    <>
      {/* Compact mode: reaching the window's left edge brings the sidebar out. */}
      {compactMode && (
        <div
          className={`sidebar-edge ${showBorder ? 'bordered' : ''}`}
          onMouseMove={() => !state.ui.sidebarPeek && api.setSidebarPeek(true)}
        />
      )}
      <div
        className={[
          'frame',
          sidebarExpanded ? 'sidebar-expanded' : '',
          compactMode ? 'compact' : '',
          state.ui.isWindowFullscreen ? 'fullscreen' : '',
          showBorder ? 'bordered' : '',
          themeStyle === 'solid' ? 'solid-theme' : '',
          draggedWidth !== null ? 'resizing' : '',
        ].join(' ')}
        style={{ '--sidebar-width': `${sidebarWidth}px`, '--solid-color': solidColor } as CSSProperties}
      >
        <div
          className="topbar"
          onContextMenu={(e) => {
            // The address field keeps its own (text editing) behavior.
            if (e.target instanceof HTMLInputElement) return;
            e.preventDefault();
            api.showTopBarMenu();
          }}
        >
          <div className="toolbar-group left">
            <CompactModeButton compactMode={compactMode} />
            {activeTab && <NavigationControls tab={activeTab} />}
          </div>
          <AddressBar activeTab={activeTab} />
          {activeTab && (
            <LoadingPill isLoading={activeTab.isLoading} color={activeTab.themeColor} tabId={activeTab.id} />
          )}
        </div>
        <div className="main">
          <div className="sidebar-slot">
            <Sidebar tabs={state.tabs} activeTabId={state.activeTabId} expanded={sidebarExpanded} />
            {sidebarExpanded && !compactMode && (
              <SidebarResizer
                onDrag={(width) => setDraggedWidth(clampSidebarWidth(width))}
                onRelease={(width) => {
                  api.setAppearance({ sidebarWidth: clampSidebarWidth(width) });
                  setDraggedWidth(null);
                }}
              />
            )}
          </div>
          <div className="page" ref={pageRef} />
        </div>
      </div>
    </>
  );
}

/** The expanded sidebar's right edge, dragged to make it narrower (up to its default width). */
function SidebarResizer({ onDrag, onRelease }: { onDrag: (width: number) => void; onRelease: (width: number) => void }) {
  return (
    <div
      className="sidebar-resizer"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const left = e.currentTarget.parentElement!.getBoundingClientRect().left;
        const move = (event: MouseEvent) => onDrag(event.clientX - left);
        const up = (event: MouseEvent) => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          onRelease(event.clientX - left);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        onDrag(e.clientX - left);
      }}
    />
  );
}
