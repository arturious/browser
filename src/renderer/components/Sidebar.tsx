import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppState, TabState, TabFolder, Workspace } from '../../shared/types';
import { hostOf } from '../../shared/url';
import { api } from '../state';
import { useSidebarGestures, type SidebarGesture } from '../useSidebarGestures';
import { Icon } from './Icon';
import { WorkspaceIcon } from './WorkspaceIcon';
import { useWorkspaceMotion } from '../useWorkspaceMotion';
import { animate, type AnimationControls } from '../../vendor/zen-motion.cjs';
import { LibraryButton } from './LibraryButton';
import { FolderRow } from './FolderRow';
import '../zen/spaces-add-source.css';

interface SidebarProps { state: AppState; expanded: boolean; externalGesture?: SidebarGesture }

export function Sidebar({ state, expanded, externalGesture }: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const ownGesture = useSidebarGestures(ref, state, api.requestWorkspaceCreation, !externalGesture);
  const gesture = externalGesture ?? ownGesture;
  useWorkspaceMotion(ref, state, gesture);
  const index = Math.max(0, state.workspaces.findIndex((workspace) => workspace.id === state.activeWorkspaceId));
  const current = state.workspaces[index];
  const essentials = state.tabs.filter((tab) => tab.isEssential);
  const [folderName, setFolderName] = useState<string | null>(null);
  useEffect(() => api.onCommand((command) => { if (command === 'create-folder') setFolderName(''); }), []);

  return (
    <div ref={ref} className={`sidebar zen-sidebar ${expanded ? 'expanded' : ''} ${gesture.active ? 'swiping' : ''} ${gesture.addProgress > 0 ? 'adding-space' : ''}`}
      style={{ '--workspace-color': current.color } as CSSProperties}>
      {!!essentials.length && <div className="essentials-grid" aria-label="Essentials">
        {essentials.map((tab) => <SidebarTab key={tab.id} tab={tab} isActive={tab.id === state.activeTabId} className="essential-item" />)}
      </div>}
      <div className="workspace-strip">
        {state.workspaces.map((workspace) => {
          const tabs = state.tabs.filter((tab) => !tab.isEssential && tab.workspaceId === workspace.id);
          const folders = state.folders.filter((folder) => folder.workspaceId === workspace.id);
          return <section key={workspace.id} className={`space-panel ${workspace.id === current.id ? 'current' : ''}`}
            inert={workspace.id !== current.id}
            aria-label={workspace.name} data-workspace-id={workspace.id}>
            <button className="workspace-heading" onClick={() => api.showWorkspaceMenu(workspace.id)}
              onContextMenu={(e) => { e.preventDefault(); api.showWorkspaceMenu(workspace.id); }} title={workspace.name}>
              <span className="workspace-glyph" style={{ color: workspace.color }}><WorkspaceIcon value={workspace.icon} /></span>
              <span className="tab-title">{workspace.name}</span>
              <Icon name="chevron.down" size={10} className="workspace-chevron" />
            </button>
            <div className="space-tabs sidebar-scroll">
              <div className="pinned-tabs" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                if (e.target !== e.currentTarget) return;
                const id = e.dataTransfer.getData('application/x-browser-tab');
                if (id) { api.moveTab(id, null, workspace.id, null); const tab = state.tabs.find((entry) => entry.id === id); if (tab && !tab.isPinned) api.togglePin(id); }
              }}>
                {tabs.filter((tab) => tab.isPinned && !tab.folderId).map((tab) =>
                  <SidebarTab key={tab.id} tab={tab} isActive={tab.id === state.activeTabId} className="pinned-item" />)}
                {folders.map((folder) => <Folder key={folder.id} folder={folder} state={state} tabs={tabs.filter((tab) => tab.folderId === folder.id)} />)}
              </div>
              {(folders.length > 0 || tabs.some((tab) => tab.isPinned)) && <div className="sidebar-divider" />}
              <button className="sidebar-add" onClick={api.newTab} title="New Tab (⌘T)">
                <Icon name="plus" size={16} /><span className="tab-title">New Tab</span><kbd>⌘T</kbd>
              </button>
              <div className="everyday-tabs" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
                if (e.target !== e.currentTarget) return;
                const id = e.dataTransfer.getData('application/x-browser-tab');
                if (id) {
                  const tab = state.tabs.find((entry) => entry.id === id);
                  if (tab?.isPinned) api.togglePin(id);
                  api.moveTab(id, null, workspace.id, null);
                }
              }}>
                {tabs.filter((tab) => !tab.isPinned && !tab.folderId).map((tab) => <SidebarTab key={tab.id} tab={tab} isActive={tab.id === state.activeTabId} />)}
              </div>
              {folderName !== null && <form className="folder-create" onSubmit={(e) => { e.preventDefault(); if (folderName.trim()) api.createFolder(folderName); setFolderName(null); }}>
                <Icon name="folder" size={16} />
                <input autoFocus aria-label="Folder name" placeholder="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setFolderName(null); }} onBlur={() => setFolderName(null)} />
              </form>}
              {!tabs.length && !folders.length && expanded && <div className="space-empty">A little room to think.<br />Open a tab to get started.</div>}
            </div>
          </section>;
        })}
        <div className={`zen-swipe-add-space-container ${gesture.addProgress >= 1 ? 'ready' : ''}`} aria-hidden={gesture.addProgress <= 0}
          style={{ opacity: gesture.addProgress > 0 ? 1 : 0, translate: `${(1 - Math.min(gesture.addProgress / 0.75, 1)) * 55}% 0` }}>
          <div className="zen-swipe-add-space-progress-badge">
            <svg className="zen-swipe-add-space-progress-ring" viewBox="0 0 30 30"><circle className="zen-swipe-add-space-progress-arc" cx="15" cy="15" pathLength="100"
              style={{ strokeDasharray: `${(1 - Math.cos(Math.PI * Math.min(Math.max(gesture.addProgress, 0), 1))) / 2 * 100} 100` }} /></svg>
            <span className="zen-swipe-add-space-icon" />
          </div>
        </div>
        <div className="zen-swipe-add-space-background" style={{ opacity: Math.min(Math.max(gesture.addProgress / 0.75, 0), 1), scale: `${Math.min(Math.max(gesture.addProgress / 0.75, 0), 1)} 3` }} />
      </div>
      <div className="sidebar-footer">
        <LibraryButton state={state} sidebar={ref} />
        <nav className="workspace-dots" aria-label="Spaces">
          {state.workspaces.map((workspace) => <WorkspaceButton key={workspace.id} workspace={workspace} current={workspace.id === current.id} />)}
        </nav>
        <button className="sidebar-foot-button sidebar-folder-button toolbarbutton-1" title="Create new" aria-label="Create new" onClick={(event) => api.openInterfacePanel('create', event.currentTarget.getBoundingClientRect().toJSON())}><Icon name="plus" size={16} /></button>
      </div>
    </div>
  );
}

function WorkspaceButton({ workspace, current }: { workspace: Workspace; current: boolean }) {
  return <button className={`workspace-dot ${current ? 'active' : ''}`} title={workspace.name} aria-label={workspace.name} aria-current={current}
    style={{ '--workspace-color': workspace.color } as CSSProperties}
    onClick={() => api.selectWorkspace(workspace.id)} onContextMenu={(e) => { e.preventDefault(); api.showWorkspaceMenu(workspace.id); }}
    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData('application/x-browser-tab'); if (id) api.moveTab(id, null, workspace.id, null); }}>
    <WorkspaceIcon value={workspace.icon} />
  </button>;
}

function Folder({ folder, tabs, state }: { folder: TabFolder; tabs: TabState[]; state: AppState }) {
  return <div className={`tab-folder ${folder.collapsed ? 'collapsed' : ''}`}
    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drop-target'); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drop-target'); }}
    onDrop={(e) => {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-target');
      const id = e.dataTransfer.getData('application/x-browser-tab');
      if (id) api.moveTab(id, null, folder.workspaceId, folder.id);
    }}>
    <button className="folder-heading" title={folder.name} aria-expanded={!folder.collapsed} onClick={() => api.toggleFolder(folder.id)}
      onContextMenu={(e) => { e.preventDefault(); api.showFolderMenu(folder.id); }}>
      <Icon name="chevron.down" size={10} className="folder-chevron" /><Icon name={folder.collapsed ? 'folder' : 'folder.open'} size={16} />
      <span className="tab-title">{folder.name}</span><span className="folder-count">{tabs.length}</span>
    </button>
    <div className="zen-folder-rows">
      {tabs.map((tab) => <FolderRow key={tab.id} visible={!folder.collapsed || tab.id === state.activeTabId}><SidebarTab tab={tab} isActive={tab.id === state.activeTabId} /></FolderRow>)}
      {!tabs.length && <FolderRow visible={!folder.collapsed}><span className="folder-empty">Drop tabs here</span></FolderRow>}
    </div>
  </div>;
}

function SidebarTab({ tab, isActive, className = '' }: { tab: TabState; isActive: boolean; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const animation = useRef<AnimationControls | null>(null);
  useEffect(() => () => animation.current?.stop(), []);
  const close = () => {
    if (closing.current) return;
    if (tab.isPinned || tab.isEssential || !row.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { api.closeTab(tab.id); return; }
    closing.current = true;
    const element = row.current;
    element.style.pointerEvents = 'none';
    const last = element === element.closest('.space-panel')?.querySelector('.everyday-tabs .sidebar-tab:last-child');
    animation.current = animate(element, {
      opacity: [1, 0], transform: ['scale(1)', 'scale(0.95)'],
      ...(last ? {} : { marginBottom: ['0px', `-${element.getBoundingClientRect().height}px`] }),
    }, { duration: 0.1, ease: 'easeOut' });
    animation.current.then(() => api.closeTab(tab.id));
  };
  return <div ref={row} className={`sidebar-tab ${isActive ? 'active' : ''} ${tab.isUnloaded ? 'unloaded' : ''} ${className}`}
    role="tab" aria-selected={isActive} tabIndex={0} draggable title={tab.isPlayingMedia ? `${tab.title}\nPlaying audio` : tab.title}
    onClick={() => api.selectTab(tab.id)} onAuxClick={(e) => { if (e.button === 1) close(); }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.selectTab(tab.id); } if (e.key === 'Delete') close(); }}
    onContextMenu={(e) => { e.preventDefault(); api.showTabMenu(tab.id); }}
    onDragStart={(e) => { e.dataTransfer.setData('application/x-browser-tab', tab.id); e.dataTransfer.effectAllowed = 'move'; }}
    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-before'); }}
    onDragLeave={(e) => e.currentTarget.classList.remove('drop-before')}
    onDrop={(e) => {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drop-before');
      const id = e.dataTransfer.getData('application/x-browser-tab');
      if (id && id !== tab.id) api.moveTab(id, tab.id, tab.workspaceId, tab.folderId);
    }}>
    <div className={`favicon-wrap ${tab.isLoading ? 'tab-loading' : ''}`}>
      <Favicon tab={tab} />
      {tab.isPlayingMedia && <div className="media-badge"><Icon name="speaker.wave.2" size={11} /></div>}
    </div>
    <span className="tab-title">{tab.title}</span>
    <button className="tab-close" aria-label={`Close ${tab.title}`} title={tab.isPinned ? 'Unload Tab' : 'Close Tab'}
      onClick={(e) => { e.stopPropagation(); close(); }}><Icon name="xmark" size={12} /></button>
  </div>;
}

export function Favicon({ tab }: { tab: Pick<TabState, 'url' | 'favicon'> }) {
  const host = hostOf(tab.url) ?? '';
  const fallback = host ? `https://www.google.com/s2/favicons?sz=64&domain=${host}` : null;
  const sources = [tab.favicon, fallback].filter((src): src is string => Boolean(src));
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((candidate) => !failed.includes(candidate));
  if (src) return <img className="favicon" src={src} onError={() => setFailed((list) => [...list, src])} alt="" />;
  const letter = (host.replace(/^www\./, '') || '?').charAt(0).toUpperCase();
  const hash = [...host].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  return <div className="favicon letter" style={{ background: `hsl(${hash % 360}, 61%, 62%)` }}>{letter}</div>;
}
