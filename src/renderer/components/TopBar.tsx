import { useEffect, useState, type ReactNode } from 'react';
import type { AppState, TabState } from '../../shared/types';
import { api, rectOf } from '../state';
import { Icon } from './Icon';

export function ToolbarButton({ icon, disabled, className = '', onClick, label = 'Browser action' }: {
  icon: ReactNode; disabled?: boolean; className?: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; label?: string;
}) {
  return <button type="button" className={`toolbar-button toolbarbutton-1 ${className}`} disabled={disabled} title={label} aria-label={label} onClick={onClick}>{icon}</button>;
}
export function CompactModeButton({ compactMode }: { compactMode: boolean }) {
  return <ToolbarButton label={compactMode ? 'Show sidebar' : 'Compact mode'} icon={<Icon name="sidebar" size={16} />} onClick={() => api.setAppearance({ compactMode: !compactMode })} />;
}
export function NavigationControls({ tab }: { tab?: TabState }) {
  return <>
    <ToolbarButton label="Back" icon={<Icon name="back" size={16} />} disabled={!tab?.canGoBack} onClick={api.goBack} />
    <ToolbarButton label="Forward" icon={<Icon name="forward" size={16} />} disabled={!tab?.canGoForward} onClick={api.goForward} />
    <ToolbarButton label={tab?.isLoading ? 'Stop loading' : 'Reload'} icon={<Icon name={tab?.isLoading ? 'close' : 'reload'} size={16} />} disabled={!tab} onClick={() => tab?.isLoading ? api.stop() : api.reload()} />
  </>;
}
export function AddressBar({ activeTab }: { activeTab: TabState | undefined }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1200); return () => clearTimeout(timer); }, [copied]);
  const value = activeTab?.url.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '';
  return <div className="address-bar urlbar" id="urlbar">
    <div className="urlbar-background" />
    <ToolbarButton label={copied ? 'Address copied' : 'Copy current URL'} className="small" disabled={!activeTab} icon={<Icon name={copied ? 'checkbox' : 'link'} size={16} />} onClick={() => { if (activeTab) { api.copyText(activeTab.url); setCopied(true); } }} />
    <button className="address-display" aria-label="Search or enter address (⌘L)" onClick={event => api.openInterfacePanel('address', rectOf(event.currentTarget))}>
      <span className="address-host">{value || 'Search or enter address'}</span>
    </button>
    {activeTab?.hasPlayingVideo && <ToolbarButton label="Picture in Picture" className="small" icon={<Icon name="window" size={16} />} onClick={api.togglePiP} />}
    <ToolbarButton label="Site information" className="small" disabled={!activeTab} icon={<Icon name={activeTab?.url.startsWith('https:') ? 'security' : 'info'} size={16} />} onClick={event => api.openInterfacePanel('site', rectOf(event.currentTarget))} />
  </div>;
}
export const TOOLBAR_DEFINITIONS: Record<string, { label: string; icon: string }> = {
  extensions: { label: 'Extensions', icon: 'extension' }, library: { label: 'Library', icon: 'bookmark-star-on-tray' },
  menu: { label: 'Open menu', icon: 'menu' }, theme: { label: 'Edit Theme', icon: 'edit-theme' },
  settings: { label: 'Settings', icon: 'settings' }, compact: { label: 'Compact mode', icon: 'sidebar' }, pip: { label: 'Picture in Picture', icon: 'window' },
};
export function ToolbarActions({ state }: { state: AppState }) {
  return <div className="toolbar-group right" id="nav-bar-customization-target">
    {state.extensions.filter(extension => extension.enabled && extension.pinned).map(extension => <ToolbarButton key={extension.id} label={extension.name} icon={extension.icon ? <img src={extension.icon} width={16} height={16} alt="" /> : <Icon name="extension" size={16} />} onClick={event => api.openExtension(extension.id, rectOf(event.currentTarget))} />)}
    {state.appearance.toolbarItems.map(item => { const definition = TOOLBAR_DEFINITIONS[item]; if (!definition) return null;
      return <ToolbarButton key={item} label={definition.label} icon={<Icon name={definition.icon} size={16} />} onClick={event => {
        if (item === 'library') api.toggleLibrary();
        else if (item === 'settings') api.openSettings();
        else if (item === 'compact') api.setAppearance({ compactMode: !state.appearance.compactMode });
        else if (item === 'pip') api.togglePiP();
        else api.openInterfacePanel(item as 'extensions' | 'menu' | 'theme', rectOf(event.currentTarget));
      }} />;
    })}
  </div>;
}
