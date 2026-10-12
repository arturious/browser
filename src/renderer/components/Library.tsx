import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppState, DownloadEntry, HistoryEntry, LibrarySection, Workspace, SiteBoost } from '../../shared/types';
import { hostOf } from '../../shared/url';
import { api } from '../state';
import { Favicon } from './Sidebar';
import { Icon } from './Icon';
import { WorkspaceIcon } from './WorkspaceIcon';
import { workspaceThemeStyle } from '../useZenTheme';
import { useSpaceCardDrag } from '../useSpaceCardDrag';
import { FolderRow } from './FolderRow';

const SECTIONS: { id: LibrarySection; label: string }[] = [
  { id: 'media', label: 'Media' }, { id: 'downloads', label: 'Downloads' },
  { id: 'boosts', label: 'Boosts' }, { id: 'spaces', label: 'Spaces' }, { id: 'history', label: 'History' },
];
const SPRITES = import.meta.glob('../assets/zen/*-*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const INACTIVE_SPRITES = import.meta.glob('../assets/zen/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function Sprite({ section, active, play = false }: { section: LibrarySection; active: boolean; play?: boolean }) {
  const path = `../assets/zen/${section}${active ? '-active' : ''}.svg`;
  return <span className={`library-sprite ${play ? 'play' : ''}`}><img src={(active ? SPRITES : INACTIVE_SPRITES)[path]} alt="" /></span>;
}

export function Library({ state }: { state: AppState }) {
  const [editingBoost, setEditingBoost] = useState<SiteBoost | 'new' | null>(null);
  const [animatedTab, setAnimatedTab] = useState<LibrarySection | null>(null);
  const [mounted, setMounted] = useState<LibrarySection[]>([state.ui.librarySection]);
  const [contentMounted, setContentMounted] = useState(false);
  const open = state.ui.libraryOpen || state.ui.libraryAnimating;
  const section = state.ui.librarySection;
  useEffect(() => {
    if (open) {
      setContentMounted(true);
      setMounted(previous => previous.includes(section) ? previous : [...previous, section]);
      return;
    }
    setMounted([section]); setAnimatedTab(null); setEditingBoost(null);
    const timer = setTimeout(() => setContentMounted(false), 30000);
    return () => clearTimeout(timer);
  }, [open, section]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (editingBoost) { event.preventDefault(); setEditingBoost(null); return; }
      const focused = document.activeElement;
      if (focused?.closest('.zen-library') && !focused.closest('.library-search-box')) return;
      event.preventDefault(); api.closeLibrary();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, editingBoost]);
  const downloading = state.downloads.filter(entry => entry.status === 'progressing');
  const totalBytes = downloading.reduce((total, entry) => total + entry.totalBytes, 0);
  const receivedBytes = downloading.reduce((total, entry) => total + entry.receivedBytes, 0);
  return <aside className={`zen-library ${open ? 'open' : ''} ${state.ui.libraryAnimating ? 'transitioning' : ''} ${state.ui.librarySizing ? 'sizing' : ''} ${state.ui.isWindowFullscreen ? 'fullscreen' : ''} ${state.appearance.themeStyle === 'solid' ? 'solid-theme' : ''}`}
    inert={!open} aria-label="Library" data-downloading={downloading.length > 0}
    style={{ '--solid-color': state.appearance.solidColor, '--zen-library-download-progress': `${totalBytes ? receivedBytes / totalBytes * 100 : 0}%` } as CSSProperties}>
    <div className="library-panel">
    <div className="library-side">
      <div className="library-window-header" />
      <nav className="library-tabs" aria-label="Library sections">
        {SECTIONS.map(({ id, label }) => <button key={id} data-section={id} className={`library-tab ${section === id ? 'active' : ''} ${animatedTab === id ? 'animate' : ''}`} aria-current={section === id}
          onClick={() => { if (section !== id) { api.selectLibrarySection(id); setAnimatedTab(id); } }}>
          <Sprite key={`${id}-${animatedTab === id}`} section={id} active={section === id || id === 'downloads' && downloading.length > 0} play={animatedTab === id} />
          <span>{label}</span>
          {id === 'downloads' && state.downloads.some((entry) => entry.status === 'progressing') && <span className="library-download-indicator" />}
        </button>)}
      </nav>
      <div className="library-footer">
        <button className="sidebar-foot-button" aria-label="Close Library" title="Close Library (Escape)" onClick={api.closeLibrary}><Icon name="arrow.backward" size={17} /></button>
        <button className="sidebar-foot-button" aria-label="Edit Theme" title="Edit Theme" onClick={api.openThemeEditor}><Icon name="paintpalette" size={17} /></button>
      </div>
    </div>
      <div className="library-section-host">
        {contentMounted && mounted.map(id => <LibrarySectionView key={id} section={id} showing={section === id} state={state} setCreateSpace={api.requestWorkspaceCreation} setEditingBoost={setEditingBoost} />)}
      </div>
    </div>
    <div className="library-resizer" role="separator" aria-label="Library width" aria-orientation="vertical" onPointerDown={(e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) api.setLibraryWidth(e.clientX); }} onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)} />
    {editingBoost && <BoostEditor boost={editingBoost === 'new' ? undefined : editingBoost} activeURL={state.tabs.find((tab) => tab.id === state.activeTabId)?.url} onClose={() => setEditingBoost(null)} />}
  </aside>;
}

function LibrarySectionView({ section, showing, state, setCreateSpace, setEditingBoost }: {
  section: LibrarySection; showing: boolean; state: AppState;
  setCreateSpace: (open: boolean) => void; setEditingBoost: (boost: SiteBoost | 'new') => void;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const spacesRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(100);
  useSpaceCardDrag(spacesRef, showing && state.ui.libraryOpen, state.workspaces.map(space => space.id).join(','));
  useEffect(() => { setLimit(100); if (resultsRef.current) resultsRef.current.scrollTop = 0; }, [query, filter]);
  useEffect(() => {
    if (!showing || !state.ui.libraryOpen || !sentinelRef.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setLimit(value => value + 100); }, { root: resultsRef.current, rootMargin: '200px' });
    observer.observe(sentinelRef.current); return () => observer.disconnect();
  }, [showing, state.ui.libraryOpen, limit, query, filter, state.history.length, state.downloads.length]);
  useEffect(() => { const timer = setTimeout(() => setQuery(input.trim()), 250); return () => clearTimeout(timer); }, [input]);
  useEffect(() => { if (showing && state.ui.libraryOpen && !state.ui.libraryGestureActive && section !== 'spaces') searchRef.current?.focus({ preventScroll: true }); }, [showing, state.ui.libraryOpen, state.ui.libraryGestureActive, section]);
  useLayoutEffect(() => {
    if (!filtersOpen || !filterRef.current) return;
    const measure = () => contentRef.current?.style.setProperty('--zen-library-filter-height', `${filterRef.current!.scrollHeight + 8}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(filterRef.current);
    return () => observer.disconnect();
  }, [filtersOpen, showing]);
  const match = (value: string) => value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const history = state.history.filter((entry) => match(`${entry.title} ${entry.url}`) && (filter !== 'Today' || new Date(entry.visitedAt).toDateString() === new Date().toDateString()));
  const downloads = state.downloads.filter((entry) => match(entry.name) && (filter === 'All' || filter === 'Completed' && entry.status === 'completed' || filter === 'In progress' && entry.status === 'progressing'));
  const media = state.downloads.filter((entry) => entry.status === 'completed' && /\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mp3|wav|m4a|ogg)$/i.test(entry.name) && match(entry.name));
  const filters = section === 'history' ? ['All', 'Today'] : section === 'downloads' ? ['All', 'Completed', 'In progress'] : section === 'media' ? ['All', 'Images', 'Video', 'Audio'] : [];

  return (
    <div className={`library-content library-section-${section} fade-in`} data-section={section} hidden={!showing} ref={contentRef}>
      <div className={`library-search-top ${filtersOpen ? 'open' : ''}`}>
        <div className={`library-search-header ${filtersOpen ? 'hidden' : ''}`} inert={filtersOpen} aria-hidden={filtersOpen}>
          <label className="library-search-box"><Icon name="magnifyingglass" size={15} />
            <input ref={searchRef} type="search" aria-label={`Search ${section}`} placeholder={`Search ${section}…`} value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          {!!filters.length && <button className="library-filter-button" title="Filters" aria-label="Filters" onClick={() => setFiltersOpen(true)}><Icon name="line.3.horizontal.decrease" size={16} /></button>}
        </div>
        <div className={`library-filter-header ${filtersOpen ? 'visible' : ''}`} inert={!filtersOpen} aria-hidden={!filtersOpen}><strong>Filters</strong><button className="library-filter-done" onClick={() => setFiltersOpen(false)}>Done</button></div>
        <div className={`library-filter-panel ${filtersOpen ? 'open' : ''}`} inert={!filtersOpen} aria-hidden={!filtersOpen}><div ref={filterRef} className="library-filter-panel-inner library-filter-group">
          <h3>{section === 'history' ? 'Date' : 'Show'}</h3>
          <div className="library-filter-options">{filters.map((label) => <button className={`library-filter-chip ${filter === label ? 'active' : ''}`} key={label} onClick={() => setFilter(filter === label ? 'All' : label)}>{label}</button>)}</div>
        </div></div>
      </div>
      <div ref={resultsRef} className={`library-results ${section === 'spaces' ? 'spaces-results' : ''}`} onScroll={(e) => e.currentTarget.classList.toggle('scrolled', e.currentTarget.scrollTop > 0)}>
        {section === 'history' && <>
          <div className="library-section-heading"><h2>History</h2><span>{history.length}</span></div>
          {history.length ? <HistoryList entries={history.slice(0, limit)} /> : <Empty section="history" title={query ? 'No results' : 'Your journey starts here'} text={query ? 'Try a different search.' : 'Pages you visit will appear here.'} />}
          {!!state.history.length && <button className="library-text-button" onClick={api.clearHistory}>Clear history</button>}
        </>}
        {section === 'downloads' && <>
          <div className="library-section-heading"><h2>Downloads</h2><span>{downloads.length}</span></div>
          {downloads.length ? downloads.slice(0, limit).map((entry) => <Download key={entry.id} entry={entry} />) : <Empty section="downloads" title="Nothing downloaded yet" text="Your downloads will appear here." />}
        </>}
        {section === 'media' && <>
          <div className="library-section-heading"><h2>Media</h2><span>{media.length}</span></div>
          {!!state.tabs.filter((tab) => tab.isPlayingMedia).length && <div className="playing-media">
            <h3>Playing now</h3>
            {state.tabs.filter((tab) => tab.isPlayingMedia).map((tab) => <button className="library-row" key={tab.id} onClick={() => api.selectTab(tab.id)}><Favicon tab={tab} /><span>{tab.title}</span><Icon name="speaker.wave.2" size={15} /></button>)}
          </div>}
          {media.length ? <div className="library-media-grid">{media.filter((entry) => filter === 'All' ||
            filter === 'Images' && /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(entry.name) ||
            filter === 'Video' && /\.(mp4|mov|webm)$/i.test(entry.name) ||
            filter === 'Audio' && /\.(mp3|wav|m4a|ogg)$/i.test(entry.name)).map((entry) =>
            <button className="library-media-item" title={entry.name} key={entry.id} onClick={(event) => {
              const rect = (event.currentTarget.querySelector('.library-media-thumb') ?? event.currentTarget.querySelector('.library-media-frame')!).getBoundingClientRect();
              api.previewDownload(entry.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
            }} onContextMenu={(e) => { e.preventDefault(); api.openDownload(entry.id, true); }}>
              <span className="library-media-frame">{entry.thumbnail ? <img className="library-media-thumb" src={entry.thumbnail} alt={entry.name} /> : <><Icon name={/\.(mp3|wav|m4a|ogg)$/i.test(entry.name) ? 'music.note' : 'film'} size={32} /><span>{entry.name}</span></>}</span>
            </button>)}</div> : <Empty section="media" title="All your media, together" text="Downloaded images, videos and audio will appear here." />}
        </>}
        {section === 'spaces' && <>
          <div className="library-section-heading"><h2>Spaces</h2><button className="sidebar-foot-button" aria-label="New Space" title="New Space" onClick={() => setCreateSpace(true)}><Icon name="plus" size={16} /></button></div>
          <div ref={spacesRef} className="library-spaces">{state.workspaces.map((workspace) => <SpaceCard key={workspace.id} workspace={workspace} state={state} showing={showing} />)}
            <div className="zen-swipe-add-space-container space-section"><button className="zen-swipe-add-space-progress-badge library-create-space" title="New Space" aria-label="New Space" onClick={() => setCreateSpace(true)}><span className="zen-swipe-add-space-icon" /></button></div>
          </div>
        </>}
        {section === 'boosts' && <>
          <div className="library-section-heading"><h2>Boosts</h2><button className="sidebar-foot-button" title="New Boost" aria-label="New Boost" onClick={() => setEditingBoost('new')}><Icon name="plus" size={16} /></button></div>
          {state.boosts.filter((boost) => match(`${boost.name} ${boost.domain}`)).length ? state.boosts.filter((boost) => match(`${boost.name} ${boost.domain}`)).sort((a, b) => a.name.localeCompare(b.name)).map((boost) =>
            <div key={boost.id} className={`library-row library-boost-row ${boost.enabled ? '' : 'disabled'}`} role="button" tabIndex={0}
              onClick={() => boost.enabled ? setEditingBoost(boost) : api.toggleBoost(boost.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') setEditingBoost(boost); }}
              onContextMenu={(e) => { e.preventDefault(); api.showBoostMenu(boost.id); }}>
              <div className="library-boost-icon"><Favicon tab={{ url: `https://${boost.domain}`, favicon: null }} /></div>
              <span className="library-row-text"><strong>{boost.name}</strong><small>{boost.domain}</small></span>
              <input type="checkbox" aria-label={`Enable ${boost.name}`} checked={boost.enabled} onClick={(e) => e.stopPropagation()} onChange={() => api.toggleBoost(boost.id)} />
            </div>) : <Empty section="boosts" title="No boosts yet" text="Create a boost to make a website your own." />}
        </>}
        {((section === 'history' && history.length > limit) || (section === 'downloads' && downloads.length > limit)) && <div ref={sentinelRef} className="library-load-more" aria-hidden="true" />}
      </div>
    </div>
  );
}

function Empty({ section, title, text }: { section: LibrarySection; title: string; text: string }) {
  return <div className="library-empty"><Sprite section={section} active /><h3>{title}</h3><p>{text}</p></div>;
}

function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const date = new Date(entry.visitedAt).toDateString();
    const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : new Date(entry.visitedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }
  return [...groups].map(([date, history]) => <div className="library-history-group" key={date}><h3>{date}</h3>
    {history.map((entry) => <button className="library-row history-row" key={entry.id} title={entry.url} onClick={() => api.navigate(entry.url, true)}>
      <Favicon tab={{ url: entry.url, favicon: null }} />
      <span className="library-row-text"><strong className="library-row-title">{entry.title}</strong><small className="library-row-subtitle library-visit-url">{hostOf(entry.url)}</small><small className="library-row-subtitle library-visit-date">{new Date(entry.visitedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></span>
    </button>)}</div>);
}

function bytes(value: number) { return value < 1024 * 1024 ? `${Math.round(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`; }

function Download({ entry }: { entry: DownloadEntry }) {
  const progress = entry.totalBytes > 0 ? entry.receivedBytes / entry.totalBytes : 0;
  return <div className="library-download">
    <button className={`library-row ${entry.paused ? 'paused' : ''} ${entry.status === 'progressing' && entry.openWhenDone ? 'pending' : ''} ${entry.status === 'progressing' && !entry.totalBytes ? 'indeterminate' : ''}`} disabled={entry.status !== 'completed' && entry.status !== 'progressing'} onClick={() => api.openDownload(entry.id)} onContextMenu={event => { event.preventDefault(); api.showDownloadMenu(entry.id); }}>
      <span className="library-row-icon-box">{entry.thumbnail ? <img className="library-row-icon" data-preview="true" src={entry.thumbnail} alt="" /> : <Icon className="library-row-icon" name="doc" size={22} />}
      {entry.status === 'progressing' && <svg className="library-row-progress" viewBox="0 0 36 36" aria-label={`${Math.round(progress * 100)}% downloaded`}><circle className="library-row-progress-track" cx="18" cy="18" r="15" /><circle className="library-row-progress-arc" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${entry.totalBytes ? progress * 100 : 25} 100`} /></svg>}</span>
      <span className="library-row-text"><strong className="library-row-title">{entry.name}</strong>
        <small className="library-row-subtitle library-download-status">{entry.status === 'progressing' && entry.openWhenDone ? 'Opens when finished' : entry.status === 'completed' ? bytes(entry.receivedBytes) : entry.status === 'progressing' ? `${entry.paused ? 'Paused · ' : ''}${bytes(entry.receivedBytes)} / ${entry.totalBytes ? bytes(entry.totalBytes) : '…'}` : entry.status}</small><small className="library-row-subtitle library-download-url">{hostOf(entry.url)}</small></span>
    </button>
    {entry.status === 'completed' && <button className="download-reveal" aria-label={`Show ${entry.name} in Finder`} onClick={() => api.openDownload(entry.id, true)}><Icon name="folder" size={15} /></button>}
    {entry.status === 'progressing' && <div className="download-controls">
      <button aria-label={entry.paused ? `Resume ${entry.name}` : `Pause ${entry.name}`} title={entry.paused ? 'Resume' : 'Pause'} onClick={() => api.controlDownload(entry.id, entry.paused ? 'resume' : 'pause')}><Icon name={entry.paused ? 'play' : 'pause'} size={13} /></button>
      <button aria-label={`Cancel ${entry.name}`} title="Cancel" onClick={() => api.controlDownload(entry.id, 'cancel')}><Icon name="xmark" size={13} /></button>
    </div>}
  </div>;
}

function SpaceCard({ workspace, state, showing }: { workspace: Workspace; state: AppState; showing: boolean }) {
  const [editing, setEditing] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const [filled, setFilled] = useState(workspace.id === state.activeWorkspaceId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!state.ui.libraryOpen) { setFilled(false); return; }
    if (!showing || !cardRef.current) return;
    if (workspace.id === state.activeWorkspaceId) setFilled(true);
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setFilled(true); observer.disconnect(); } }, { root: cardRef.current.parentElement, rootMargin: '300px' });
    observer.observe(cardRef.current); return () => observer.disconnect();
  }, [showing, state.ui.libraryOpen, workspace.id, state.activeWorkspaceId]);
  const [name, setName] = useState(workspace.name);
  const tabs = state.tabs.filter((tab) => tab.workspaceId === workspace.id && !tab.isEssential);
  const folders = state.folders.filter((folder) => folder.workspaceId === workspace.id);
  const select = (id: string) => { api.selectTab(id); api.closeLibrary(); };
  return <section ref={cardRef} data-workspace-id={workspace.id} className={`library-space-card ${workspace.id === state.activeWorkspaceId ? 'active' : ''}`} style={{ '--workspace-color': workspace.color, '--zen-space-background': workspaceThemeStyle(workspace.theme, workspace.theme?.scheme !== 'light').window } as CSSProperties}
    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('application/x-browser-tab'); if (id) api.moveTab(id, null, workspace.id, null); }}>
    <div className="library-space-title"><span className="space-card-icon"><WorkspaceIcon value={workspace.icon} size={20} /></span>
      {editing ? <form onSubmit={(e) => { e.preventDefault(); api.updateWorkspace(workspace.id, { name }); setEditing(false); }}><input className="space-name-input" autoFocus aria-label="Space name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { api.updateWorkspace(workspace.id, { name }); setEditing(false); }} /></form>
        : <button className="space-title-button" onClick={() => { setName(workspace.name); setEditing(true); }}>{workspace.name}</button>}
      <button className="sidebar-foot-button" title="Space options" aria-label={`Options for ${workspace.name}`} onClick={() => api.showWorkspaceMenu(workspace.id)}><Icon name="ellipsis" size={15} /></button>
    </div>
    <div className="library-space-pins" onScroll={(event) => {
      const body = event.currentTarget;
      body.toggleAttribute('scrolled-top', body.scrollTop > 0);
      body.toggleAttribute('scrolled-bottom', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
    }}>
      {filled && <>
      {state.tabs.filter((tab) => tab.isEssential).length > 0 && <div className="library-space-essentials">{state.tabs.filter((tab) => tab.isEssential).map((tab) => <button title={tab.title} key={tab.id} onClick={() => select(tab.id)}><Favicon tab={tab} /></button>)}</div>}
      {tabs.filter((tab) => tab.isPinned && !tab.folderId).map((tab) => <button key={tab.id} className="library-row" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-browser-tab', tab.id)} onClick={() => select(tab.id)}><Favicon tab={tab} /><span>{tab.title}</span></button>)}
      {folders.map((folder) => { const closed = collapsed[folder.id] ?? folder.collapsed; return <div className={`tab-folder ${closed ? 'collapsed' : ''}`} key={folder.id}><button className="library-row" onClick={() => setCollapsed(previous => ({ ...previous, [folder.id]: !closed }))}><Icon name={closed ? 'folder' : 'folder.open'} size={16} /><span>{folder.name}</span></button>
        <div className="zen-folder-rows">{tabs.filter((tab) => tab.folderId === folder.id).map((tab) => <FolderRow key={tab.id} visible={!closed || tab.id === state.activeTabId}><button className="library-row" onClick={() => select(tab.id)}><Favicon tab={tab} /><span>{tab.title}</span></button></FolderRow>)}</div>
      </div>; })}
      <div className="sidebar-divider" />
      <button className="library-row space-card-new-tab" onClick={() => { api.selectWorkspace(workspace.id); api.newTab(); }}><Icon name="plus" size={16} /><span>New Tab</span></button>
      {tabs.filter((tab) => !tab.isPinned && !tab.folderId).map((tab) => <button key={tab.id} className="library-row" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-browser-tab', tab.id)} onClick={() => select(tab.id)}><Favicon tab={tab} /><span>{tab.title}</span></button>)}
      </>}
    </div>
    <div className="library-space-summary"><button className="library-space-drag" title="Move Space" aria-label={`Move ${workspace.name}`}><img width="16" height="16" src={INACTIVE_SPRITES['../assets/zen/move-cursor.svg']} alt="" /></button><span>{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}</span>
      <button onClick={() => { api.selectWorkspace(workspace.id); api.closeLibrary(); }}>{workspace.id === state.activeWorkspaceId ? 'Current space' : 'Open space'}<Icon name="arrow.forward" size={12} /></button>
    </div>
  </section>;
}

function BoostEditor({ boost, activeURL, onClose }: { boost?: SiteBoost; activeURL?: string; onClose: () => void }) {
  const [name, setName] = useState(boost?.name ?? 'My Boost');
  const [domain, setDomain] = useState(boost?.domain ?? hostOf(activeURL ?? '') ?? '');
  const [css, setCSS] = useState(boost?.css ?? '/* Make this website yours. */\nbody {\n  /* background: #18151e !important; */\n}');
  const validDomain = hostOf(domain.includes('://') ? domain : `https://${domain}`);
  return <div className="space-dialog-backdrop" onClick={onClose}><form className="space-dialog boost-editor" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
    e.preventDefault(); if (!validDomain || !name.trim()) return;
    api.saveBoost({ id: boost?.id, name, domain: validDomain, css, enabled: true }); onClose();
  }}>
    <div className="space-dialog-title"><h2>{boost ? 'Edit Boost' : 'New Boost'}</h2><button type="button" aria-label="Close" className="sidebar-foot-button" onClick={onClose}><Icon name="xmark" size={15} /></button></div>
    <label>Name</label><input autoFocus aria-label="Boost name" value={name} onChange={(e) => setName(e.target.value)} />
    <label>Website</label><input aria-label="Boost website" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
    <label>Style</label><textarea aria-label="Website CSS" spellCheck={false} value={css} onChange={(e) => setCSS(e.target.value)} />
    <button className="create-space-button" disabled={!name.trim() || !validDomain}>Save Boost</button>
  </form></div>;
}
