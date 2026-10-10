import { useEffect, useRef, useState } from 'react';
import type { TabState } from '../../shared/types';
import { hostOf } from '../../shared/url';
import { api, rectOf } from '../state';
import { Icon } from './Icon';

interface SidebarProps {
  tabs: TabState[];
  activeTabId: string | null;
  onNewTab: () => void;
}

/** Pinned tabs on top, then "+", then everyday tabs, newest first. */
export function Sidebar({ tabs, activeTabId, onNewTab }: SidebarProps) {
  const pinned = tabs.filter((tab) => tab.isPinned);
  const everyday = tabs.filter((tab) => !tab.isPinned);
  return (
    <div className="sidebar">
      {pinned.map((tab) => (
        <SidebarIcon key={tab.id} tab={tab} isActive={tab.id === activeTabId} className="pinned-item" />
      ))}
      <div className="sidebar-add" onClick={onNewTab}>
        <Icon name="plus" size={14} bold />
      </div>
      <div className="sidebar-scroll">
        {everyday.map((tab) => (
          <SidebarIcon key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
        ))}
      </div>
    </div>
  );
}

const FAST_DOUBLE_CLICK = 200;

function SidebarIcon({ tab, isActive, className = '' }: { tab: TabState; isActive: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastClick = useRef(0);
  const [hovering, setHovering] = useState(false);

  // Keeps the tooltip's text current while it shows (titles change as pages load).
  useEffect(() => {
    if (!hovering || !ref.current) return;
    api.setHoveredTab({ title: tab.title, isPlayingMedia: tab.isPlayingMedia, rect: rectOf(ref.current) });
  }, [hovering, tab.title, tab.isPlayingMedia]);

  // A row removed while hovered never gets its mouseleave.
  useEffect(() => () => {
    if (hovering) api.setHoveredTab(null);
  }, [hovering]);

  return (
    <div
      ref={ref}
      className={`sidebar-icon ${isActive ? 'active' : ''} ${className}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        api.setHoveredTab(null);
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // A quick double click closes the tab; a single one selects it.
        const now = performance.now();
        if (now - lastClick.current < FAST_DOUBLE_CLICK) {
          lastClick.current = 0;
          api.closeTab(tab.id);
        } else {
          lastClick.current = now;
          api.selectTab(tab.id);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        api.showTabMenu(tab.id);
      }}
    >
      <div className="favicon-wrap">
        <Favicon tab={tab} />
        {tab.isPlayingMedia && (
          <div className="media-badge">
            <Icon name="speaker.wave.2" size={11} />
          </div>
        )}
      </div>
      {tab.isPinned ? (
        <Icon name="pin" size={12} className="pin-badge" />
      ) : (
        <div
          className={`tab-close ${hovering ? 'visible' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            api.closeTab(tab.id);
          }}
        >
          <Icon name="xmark" size={10} bold />
        </div>
      )}
    </div>
  );
}

/**
 * The icon the page declares, else Google's icon for the domain, else the
 * domain's first letter on a color picked from the domain.
 */
function Favicon({ tab }: { tab: TabState }) {
  const host = hostOf(tab.url) ?? '';
  const fallback = host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : null;
  const sources = [tab.favicon, fallback].filter((src): src is string => Boolean(src));
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((candidate) => !failed.includes(candidate));

  if (src) {
    return <img className="favicon" src={src} onError={() => setFailed((list) => [...list, src])} alt="" />;
  }
  const letter = (host.replace(/^www\./, '') || '?').charAt(0).toUpperCase();
  const hash = [...host].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return (
    <div className="favicon letter" style={{ background: `hsl(${hash % 360}, 61%, 62%)` }}>
      {letter}
    </div>
  );
}
