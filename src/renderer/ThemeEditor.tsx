import { api, useAppState } from './state';

export function ThemeEditor() {
  const { appearance } = useAppState();
  const solid = appearance.themeStyle === 'solid';

  return (
    <main className="theme-editor">
      <header className="theme-editor-header">
        <h1>Edit Theme</h1>
        <button type="button" aria-label="Close" onClick={() => window.close()}>
          ×
        </button>
      </header>
      <label className="theme-style-choice">
        <span>Style</span>
        <select
          value={appearance.themeStyle}
          onChange={(event) => api.setAppearance({ themeStyle: event.target.value as 'gradient' | 'solid' })}
        >
          <option value="gradient">Glass gradient</option>
          <option value="solid">Solid color with border</option>
        </select>
      </label>
      {solid ? (
        <section className="solid-theme-panel">
          <div className="solid-theme-preview" style={{ background: appearance.solidColor }} />
          <label>
            <span>Window color</span>
            <input
              type="color"
              value={appearance.solidColor}
              onChange={(event) => api.setAppearance({ solidColor: event.target.value })}
            />
          </label>
          <p>The color is opaque and adds a Zen-style border around the whole window.</p>
        </section>
      ) : (
        <section className="gradient-theme-panel">
          <div className="gradient-theme-preview" />
          <p>Uses the current glass gradient style with the macOS window material behind it.</p>
        </section>
      )}
    </main>
  );
}
