import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppState, WorkspaceTheme } from '../shared/types';
import { DEFAULT_THEME, DEFAULT_TOOLBAR_ITEMS } from '../shared/theme';
import { api, useAppState } from './state';
import { useZenTheme } from './useZenTheme';
import { Icon } from './components/Icon';
import { WorkspaceIcon } from './components/WorkspaceIcon';
import { IconPicker } from './components/IconPicker';
import { ThemePicker } from './components/ThemePicker';
import { TOOLBAR_DEFINITIONS } from './components/TopBar';

export function InterfaceOverlay() {
  const state = useAppState(); useZenTheme(state);
  const panel = state.ui.interfacePanel;
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useLayoutEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize); resize();
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    if (panel) api.interfacePanelReady(panel.requestId);
  }, [panel?.requestId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); api.closeInterfacePanel(); } };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, []);
  if (!panel) return null;
  const width = Math.min(Math.max(0, viewport.width - 16), panel.kind === 'theme' || panel.kind === 'workspace' ? 400 : panel.kind === 'customize' ? 540 : 340);
  const anchored = panel.anchor;
  const left = anchored ? Math.max(8, Math.min(viewport.width - width - 8, anchored.x + anchored.width - width)) : Math.max(8, viewport.width - width - 16);
  const top = anchored ? Math.max(48, Math.min(viewport.height - 420, anchored.y + anchored.height + 8)) : 56;
  const workspace = state.workspaces.find(space => space.id === panel.workspaceId) ?? state.workspaces[0];
  return <div className={`zen-interface-overlay panel-${panel.kind}`} onPointerDown={event => { if (event.target === event.currentTarget) api.closeInterfacePanel(); }}>
    {panel.kind === 'address' ? <AddressPanel key={panel.requestId} state={state} /> : panel.kind === 'extension-popup' ? null : <section role="dialog" aria-modal="true" className="zen-popup" style={{ left, top, width } as CSSProperties}>
      <header className="zen-popup-header"><span>{({ theme: 'Edit Theme', extensions: 'Extensions', menu: 'Browser', customize: 'Customize Toolbar', workspace: panel.newTab ? 'New Space' : 'Edit Space', site: 'Site information', create: 'Create new' } as Record<string, string>)[panel.kind]}</span><button aria-label="Close panel" onClick={api.closeInterfacePanel}><Icon name="close" size={16} /></button></header>
      {panel.kind === 'theme' && <ThemePicker key={workspace.id} initial={workspace.theme} onChange={theme => api.setWorkspaceTheme(workspace.id, theme)} />}
      {panel.kind === 'extensions' && <ExtensionsPanel state={state} />}
      {panel.kind === 'menu' && <BrowserMenu state={state} />}
      {panel.kind === 'customize' && <CustomizePanel state={state} />}
      {panel.kind === 'workspace' && <WorkspacePanel key={workspace.id + String(panel.newTab)} state={state} creating={Boolean(panel.newTab)} />}
      {panel.kind === 'site' && <SitePanel state={state} />}
      {panel.kind === 'create' && <div className="zen-popup-list"><MenuAction label="New Tab" icon="plus" shortcut="⌘T" onClick={api.newTab} /><MenuAction label="New Space" icon="squares" onClick={api.requestWorkspaceCreation} /><MenuAction label="New Folder" icon="folder" onClick={api.requestFolderCreation} /></div>}
    </section>}
  </div>;
}

function AddressPanel({ state }: { state: AppState }) {
  const creating = state.ui.interfacePanel?.newTab;
  const active = state.tabs.find(tab => tab.id === state.activeTabId);
  const [input, setInput] = useState(creating ? '' : active?.url ?? '');
  const [selection, setSelection] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus(); ref.current?.select();
    const form = ref.current?.form;
    if (!form) return;
    const report = () => form.style.setProperty('--zen-address-height', `${form.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(report); observer.observe(form); report();
    return () => observer.disconnect();
  }, []);
  const query = input.toLowerCase().trim();
  const matches = query ? [
    ...state.tabs.filter(tab => `${tab.title} ${tab.url}`.toLowerCase().includes(query)).map(tab => ({ id: tab.id, title: tab.title, url: tab.url, tab: true, icon: tab.favicon })),
    ...state.history.filter(item => `${item.title} ${item.url}`.toLowerCase().includes(query)).map(item => ({ ...item, tab: false, icon: null })),
  ].filter((item, index, all) => all.findIndex(other => other.url === item.url) === index).slice(0, 6) : [];
  const submit = (index = selection) => {
    const item = matches[index - 1];
    if (item?.tab && !creating) api.selectTab(item.id); else if ((item?.url ?? input).trim()) api.navigate(item?.url ?? input, Boolean(creating));
    api.closeInterfacePanel();
  };
  return <form role="dialog" aria-label={creating ? 'New Tab' : 'Address search'} className="zen-address-popup" onSubmit={event => { event.preventDefault(); submit(); }}>
    <div className="zen-address-popup-input"><Icon name="search-glass" size={24} /><input ref={ref} aria-label="Search or enter address" placeholder="Search or enter address" value={input} onChange={event => { setInput(event.target.value); setSelection(0); }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelection(value => (value + (event.key === 'ArrowDown' ? 1 : matches.length)) % (matches.length + 1)); }
    }} /><button type="button" aria-label="Close address search" onClick={api.closeInterfacePanel}><Icon name="close" size={16} /></button></div>
    {query && <div className="zen-address-results" role="listbox" aria-label="Address suggestions">
      <button type="button" role="option" aria-selected={selection === 0} className={selection === 0 ? 'selected' : ''} onClick={() => submit(0)}><Icon name={/^(https?:|\w+\.\w)/i.test(input) ? 'link' : 'search-glass'} size={16} /><span>{input}<small>{/^(https?:|\w+\.\w)/i.test(input) ? 'Visit' : 'Search with Google'}</small></span><kbd>↵</kbd></button>
      {matches.map((item, index) => <button type="button" role="option" aria-selected={selection === index + 1} key={item.id} className={selection === index + 1 ? 'selected' : ''} onClick={() => submit(index + 1)}>{item.icon ? <img src={item.icon} width={16} height={16} alt="" /> : <Icon name={item.tab ? 'window' : 'history'} size={16} />}<span>{item.title}<small>{item.url}</small></span>{item.tab && <small>Switch to tab</small>}</button>)}
    </div>}
  </form>;
}

function MenuAction({ label, icon, shortcut, onClick }: { label: string; icon: string; shortcut?: string; onClick: () => void }) {
  return <button type="button" className="zen-menu-action" onClick={onClick}><Icon name={icon} size={16} /><span>{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
}
function BrowserMenu({ state }: { state: AppState }) {
  return <div className="zen-popup-list">
    <MenuAction label="New Tab" icon="plus" shortcut="⌘T" onClick={api.newTab} />
    <MenuAction label="New Space" icon="squares" onClick={api.requestWorkspaceCreation} />
    <MenuAction label="Library" icon="bookmark-star-on-tray" shortcut="⌘⇧L" onClick={() => api.toggleLibrary()} />
    <MenuAction label="History" icon="history" shortcut="⌘Y" onClick={() => api.toggleLibrary('history')} />
    <MenuAction label="Downloads" icon="downloads" onClick={() => api.toggleLibrary('downloads')} />
    <hr />
    <MenuAction label="Extensions" icon="extension" onClick={() => api.openInterfacePanel('extensions')} />
    <MenuAction label="Edit Theme" icon="edit-theme" onClick={api.openThemeEditor} />
    <MenuAction label="Customize Toolbar" icon="customize" onClick={() => api.openInterfacePanel('customize')} />
    <MenuAction label={state.appearance.compactMode ? 'Turn off compact mode' : 'Compact mode'} icon="sidebar" onClick={() => { api.setAppearance({ compactMode: !state.appearance.compactMode }); api.closeInterfacePanel(); }} />
    <hr /><MenuAction label="Settings" icon="settings" shortcut="⌘," onClick={api.openSettings} />
  </div>;
}
function ExtensionsPanel({ state }: { state: AppState }) {
  return <div className="zen-extensions-panel">
    {!state.extensions.length && <div className="zen-panel-empty"><Icon name="extension" size={40} /><h3>No extensions yet</h3><p>Add an unpacked extension to your browser.</p></div>}
    {state.extensions.map(extension => <div className="zen-extension-row" key={extension.id}>
      <button className="zen-extension-launch" disabled={!extension.enabled || Boolean(extension.error)} onClick={() => api.openExtension(extension.id)}>{extension.icon ? <img src={extension.icon} width={24} height={24} alt="" /> : <Icon name="extension" size={24} />}<span>{extension.name}<small>{extension.error || extension.version}</small></span></button>
      <button title={extension.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'} aria-label={extension.pinned ? `Unpin ${extension.name}` : `Pin ${extension.name}`} aria-pressed={extension.pinned} onClick={() => api.setExtension(extension.id, { pinned: !extension.pinned })}><Icon name={extension.pinned ? 'unpin' : 'pin'} size={16} /></button>
      <label title="Enable extension"><input type="checkbox" aria-label={`Enable ${extension.name}`} checked={extension.enabled} onChange={event => api.setExtension(extension.id, { enabled: event.target.checked })} /></label>
      <button aria-label={`Remove ${extension.name}`} onClick={() => api.removeExtension(extension.id)}><Icon name="close" size={16} /></button>
    </div>)}
    <hr /><MenuAction label="Load unpacked extension…" icon="plus" onClick={api.loadExtension} />
  </div>;
}

function CustomizePanel({ state }: { state: AppState }) {
  const items = state.appearance.toolbarItems;
  const drag = useRef<string | null>(null);
  const set = (next: string[]) => api.setAppearance({ toolbarItems: next });
  return <div className="zen-customize-panel"><p>Drag buttons onto the toolbar or back into the palette.</p>
    <div className="zen-toolbar-dropzone" aria-label="Toolbar buttons" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = drag.current; if (id && !items.includes(id)) set([...items, id]); drag.current = null; }}>
      {items.map(id => <button key={id} draggable title={TOOLBAR_DEFINITIONS[id]?.label} aria-label={TOOLBAR_DEFINITIONS[id]?.label} onDragStart={() => { drag.current = id; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); event.stopPropagation(); const from = drag.current; if (from && from !== id) { const next = items.filter(item => item !== from); next.splice(next.indexOf(id), 0, from); set(next); } drag.current = null; }} onClick={() => set(items.filter(item => item !== id))}><Icon name={TOOLBAR_DEFINITIONS[id]?.icon ?? 'help'} size={20} /></button>)}
    </div>
    <div className="zen-toolbar-palette" aria-label="Available toolbar buttons" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current) set(items.filter(id => id !== drag.current)); drag.current = null; }}>
      {Object.entries(TOOLBAR_DEFINITIONS).filter(([id]) => !items.includes(id)).map(([id, definition]) => <button key={id} draggable onDragStart={() => { drag.current = id; }} onClick={() => set([...items, id])}><Icon name={definition.icon} size={24} /><span>{definition.label}</span></button>)}
    </div>
    <div className="zen-customize-options"><label><input type="checkbox" checked={state.appearance.compactMode} onChange={event => api.setAppearance({ compactMode: event.target.checked })} /> Compact mode</label><label><input type="checkbox" checked={state.appearance.showBorder} onChange={event => api.setAppearance({ showBorder: event.target.checked })} /> Window padding</label><label><input type="checkbox" checked={state.appearance.sidebarExpanded} onChange={event => api.setAppearance({ sidebarExpanded: event.target.checked })} /> Expanded sidebar</label></div>
    <footer><button onClick={() => set([...DEFAULT_TOOLBAR_ITEMS])}>Restore defaults</button><button className="zen-primary-button" onClick={api.closeInterfacePanel}>Done</button></footer>
  </div>;
}

function WorkspacePanel({ state, creating }: { state: AppState; creating: boolean }) {
  const workspace = state.workspaces.find(space => space.id === state.ui.interfacePanel?.workspaceId) ?? state.workspaces[0];
  const [name, setName] = useState(creating ? '' : workspace.name);
  const [icon, setIcon] = useState(creating ? 'zen:circle.svg' : workspace.icon);
  const [theme, setTheme] = useState<WorkspaceTheme>(creating ? DEFAULT_THEME : workspace.theme ?? DEFAULT_THEME);
  const [picker, setPicker] = useState<'icons' | 'theme' | null>(null);
  const save = () => {
    if (!name.trim()) return;
    if (creating) { api.createWorkspace(name, icon, workspace.color, theme); }
    else { api.updateWorkspace(workspace.id, { name, icon }); api.setWorkspaceTheme(workspace.id, theme); }
    api.closeInterfacePanel();
  };
  return <div className="workspace-creation-source"><div className="zen-vbox zen-workspace-creation">
    {picker === 'icons' ? <><IconPicker value={icon} onSelect={value => { setIcon(value); setPicker(null); }} /><button className="zen-picker-back" onClick={() => setPicker(null)}>Back</button></> : picker === 'theme' ? <><ThemePicker initial={theme} onChange={next => { setTheme(next); if (!creating) api.setWorkspaceTheme(workspace.id, next); }} /><button className="zen-picker-back" onClick={() => setPicker(null)}>Back</button></> : <form onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="zen-vbox"><h1 className="zen-workspace-creation-title">{creating ? 'Create a new Space' : 'Make this Space yours'}</h1><span className="zen-workspace-creation-label">Give your tabs a place to belong.</span></div>
      <div className="zen-vbox zen-workspace-creation-form">
        <div className="zen-hbox zen-workspace-creation-name-wrapper"><button type="button" className="zen-workspace-creation-icon-label" aria-label="Choose Space icon" onClick={() => setPicker('icons')}><WorkspaceIcon value={icon} /></button><input autoFocus className="zen-workspace-creation-name" aria-label="Space name" placeholder="Space name" value={name} maxLength={50} onChange={event => setName(event.target.value)} /></div>
        <button type="button" className="zen-workspace-creation-edit-theme-button" onClick={() => setPicker('theme')}><Icon name="edit-theme" size={16} /> Change Theme</button>
      </div>
      <div className="zen-vbox zen-workspace-creation-buttons"><button className="zen-primary-button zen-workspace-creation-create-button" disabled={!name.trim()}>{creating ? 'Create Space' : 'Save'}</button><button type="button" className="zen-workspace-creation-cancel-button" onClick={api.closeInterfacePanel}>Cancel</button></div>
    </form>}
  </div></div>;
}

function SitePanel({ state }: { state: AppState }) {
  const tab = state.tabs.find(tab => tab.id === state.activeTabId);
  let host = ''; try { host = new URL(tab?.url ?? '').host; } catch { /* empty tab */ }
  return <div className="zen-site-panel"><div className="zen-site-title"><Icon name={tab?.url.startsWith('https:') ? 'security' : 'info'} size={24} /><strong>{host || 'No page open'}</strong></div><p>{tab?.url.startsWith('https:') ? 'This page uses HTTPS.' : 'This page does not use HTTPS.'}</p><label><Icon name="tracking-protection" size={16} /> Block ads and trackers <input type="checkbox" checked={state.adBlockEnabled} onChange={event => api.setAdBlockEnabled(event.target.checked)} /></label><MenuAction label="Copy URL" icon="link" onClick={() => { if (tab) api.copyText(tab.url); }} /><MenuAction label="Site Boosts" icon="boost" onClick={() => api.toggleLibrary('boosts')} /></div>;
}
