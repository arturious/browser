import { useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from './components/Icon';
import { LoadingPill } from './components/LoadingPill';
import { Sidebar } from './components/Sidebar';
import { AddressBar, NavigationControls, ToolbarButton, WindowButtons } from './components/TopBar';
import { api, rectOf, useAppState } from './state';

/** The window's own interface: top bar, sidebar, and the hole the page shows through. */
export function Chrome() {
  const state = useAppState();
  const { sidebarExpanded, compactMode, showBorder } = state.appearance;
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
    const until = performance.now() + 250;
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
        ].join(' ')}
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
          <WindowButtons />
          <div className="toolbar-group left">
            <ToolbarButton
              icon={<Icon name="sidebar.left" size={14} bold />}
              onClick={() => api.setAppearance({ sidebarExpanded: !sidebarExpanded })}
            />
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
          </div>
          <div className="page" ref={pageRef} />
        </div>
      </div>
    </>
  );
}
