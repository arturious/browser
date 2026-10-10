import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { LoadingPill } from './components/LoadingPill';
import { Sidebar } from './components/Sidebar';
import {
  AddressBar,
  DownloadsButton,
  HistoryButton,
  NavigationControls,
  ToolbarButton,
} from './components/TopBar';
import { api, rectOf, useAppState } from './state';

/** The window's own interface: top bar, sidebar, and the hole the page shows through. */
export function Chrome() {
  const state = useAppState();
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const pageRef = useRef<HTMLDivElement>(null);
  const downloadsRef = useRef<HTMLDivElement>(null);
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
  const followTransition = () => {
    const element = pageRef.current;
    if (!element) return;
    const until = performance.now() + 200;
    const step = () => {
      api.setPageBounds(rectOf(element));
      if (performance.now() < until) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  useEffect(
    () =>
      api.onCommand((command) => {
        if (command === 'download-started') flyToDownloads(downloadsRef.current);
      }),
    [],
  );

  return (
    <div className={`frame ${sidebarVisible ? '' : 'sidebar-hidden'}`}>
      <div className="topbar">
        <div className="toolbar-group left">
          <ToolbarButton
            icon={<Icon name="sidebar.left" size={14} bold />}
            onClick={() => {
              setSidebarVisible((visible) => !visible);
              followTransition();
            }}
          />
          {activeTab && <NavigationControls tab={activeTab} />}
        </div>
        <div className="toolbar-group right">
          <HistoryButton open={state.ui.popover === 'history'} />
          <DownloadsButton state={state} buttonRef={downloadsRef} />
        </div>
        <AddressBar activeTab={activeTab} />
        {activeTab && (
          <LoadingPill isLoading={activeTab.isLoading} color={activeTab.themeColor} tabId={activeTab.id} />
        )}
      </div>
      <div className="main">
        <div className="sidebar-slot">
          <Sidebar tabs={state.tabs} activeTabId={state.activeTabId} onNewTab={() => startNewTab()} />
        </div>
        <div className="page" ref={pageRef} />
      </div>
    </div>
  );
}

function startNewTab() {
  // Same as Cmd+T, which arrives as a command from the menu.
  window.dispatchEvent(new CustomEvent('browser:new-tab'));
}

/** A dot dropping into the downloads button as a download starts. */
function flyToDownloads(target: HTMLElement | null) {
  if (!target) return;
  const { x, y, width, height } = target.getBoundingClientRect();
  const dot = document.createElement('div');
  dot.className = 'fly-dot';
  dot.style.left = `${x + width / 2 - 6}px`;
  dot.style.top = `${y + height / 2 - 6}px`;
  document.body.appendChild(dot);
  dot
    .animate(
      [
        { transform: 'translateY(-220px) scale(1)', opacity: 1 },
        { transform: 'translateY(0) scale(0.3)', opacity: 0 },
      ],
      { duration: 450, easing: 'ease-in' },
    )
    .finished.finally(() => dot.remove());
}
