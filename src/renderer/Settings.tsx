import type React from 'react';
import { api, useAppState } from './state';
import { useState } from 'react';

export function Settings() {
  const state = useAppState();
  const [section, setSection] = useState<'general' | 'sidebar' | 'topbar'>('general');

  return (
    <main className="settings-window">
      <nav className="settings-tabs" aria-label="Settings sections">
        <SettingsTab active={section === 'general'} icon="◎" label="General" onClick={() => setSection('general')} />
        <SettingsTab active={section === 'sidebar'} icon="▤" label="Sidebar" onClick={() => setSection('sidebar')} />
        <SettingsTab active={section === 'topbar'} icon="▱" label="Topbar" onClick={() => setSection('topbar')} />
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
                  min="140"
                  max="240"
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
              label="Show border"
              checked={state.appearance.showBorder}
              onChange={(checked) => api.setAppearance({ showBorder: checked })}
            />
            <div className="settings-control">
              <span>Chrome style</span>
              <select
                value={state.appearance.themeStyle}
                onChange={(event) => api.setAppearance({ themeStyle: event.target.value as 'gradient' | 'solid' })}
              >
                <option value="gradient">Glass Gradient</option>
                <option value="solid">Solid Color</option>
              </select>
            </div>
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
      <span className="settings-tab-icon">{icon}</span>
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
