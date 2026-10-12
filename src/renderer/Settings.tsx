import type React from 'react';
import { api, useAppState } from './state';
import { useState } from 'react';
import { Icon } from './components/Icon';
import { useZenTheme } from './useZenTheme';

export function Settings() {
  const state = useAppState();
  useZenTheme(state);
  const [section, setSection] = useState<'general' | 'sidebar' | 'topbar'>('general');

  return (
    <main className="settings-window">
      <nav className="settings-tabs" aria-label="Settings sections">
        <SettingsTab active={section === 'general'} icon="settings" label="General" onClick={() => setSection('general')} />
        <SettingsTab active={section === 'sidebar'} icon="sidebar" label="Sidebar" onClick={() => setSection('sidebar')} />
        <SettingsTab active={section === 'topbar'} icon="customize" label="Look and Feel" onClick={() => setSection('topbar')} />
      </nav>
      <section className="settings-content">
        <h1 className="settings-page-title">{section[0].toUpperCase() + section.slice(1)}</h1>
        {section === 'general' && (
          <SettingsCard title="Privacy">
            <SettingsToggle
              label="Block ads and trackers"
              checked={state.adBlockEnabled}
              onChange={(checked) => api.setAdBlockEnabled(checked)}
            />
          </SettingsCard>
        )}
        {section === 'sidebar' && (
          <>
            <SettingsCard title="Sidebar">
              <SettingsToggle
                label="Expanded sidebar"
                checked={state.appearance.sidebarExpanded}
                onChange={(checked) => api.setAppearance({ sidebarExpanded: checked })}
              />
              <SettingsToggle
                label="Compact mode"
                checked={state.appearance.compactMode}
                onChange={(checked) => api.setAppearance({ compactMode: checked })}
              />
              <div className="settings-control">
                <span>Sidebar width</span>
                <output>{state.appearance.sidebarWidth}px</output>
                <input
                  type="range"
                  min="180"
                  max="360"
                  value={state.appearance.sidebarWidth}
                  onChange={(event) => api.setAppearance({ sidebarWidth: Number(event.target.value) })}
                />
              </div>
            </SettingsCard>
          </>
        )}
        {section === 'topbar' && (
          <SettingsCard title="Topbar">
            <SettingsToggle
              label="Window padding"
              checked={state.appearance.showBorder}
              onChange={(checked) => api.setAppearance({ showBorder: checked })}
            />
            <div className="settings-control">
              <span>Workspace theme</span><button onClick={api.openThemeEditor}><Icon name="edit-theme" size={16} /> Edit Theme</button>
            </div>
            <div className="settings-control"><span>Toolbar</span><button onClick={() => api.openInterfacePanel('customize')}><Icon name="customize" size={16} /> Customize Toolbar</button></div>
            <div className="settings-control"><span>Extensions</span><button onClick={() => api.openInterfacePanel('extensions')}><Icon name="extension" size={16} /> Manage Extensions</button></div>
          </SettingsCard>
        )}
      </section>
    </main>
  );
}

function SettingsTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`settings-tab ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="settings-tab-icon"><Icon name={icon} size={20} /></span>
      <span>{label}</span>
    </button>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SettingsToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true" />
    </label>
  );
}
