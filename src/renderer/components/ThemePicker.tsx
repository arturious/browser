import { useRef, useState, type CSSProperties } from 'react';
import type { ThemeDot, WorkspaceTheme } from '../../shared/types';
import { DEFAULT_THEME } from '../../shared/theme';
import { ZenThemeColors } from '../zen/theme-colors.js';
import presets from '../zen/theme-presets.json';
import { api } from '../state';
import { Icon } from './Icon';
import { useSystemDark } from '../useZenTheme';

export function ThemePicker({ initial, onChange }: { initial?: WorkspaceTheme; onChange: (theme: WorkspaceTheme) => void }) {
  const [theme, setTheme] = useState(initial ?? DEFAULT_THEME);
  const current = useRef(theme); current.current = theme;
  const pad = useRef<HTMLDivElement>(null);
  const samples = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [custom, setCustom] = useState('#9c88ff');
  const [customOpacity, setCustomOpacity] = useState(1);
  const [page, setPage] = useState(0);
  const lastHaptic = useRef(Math.round(theme.opacity * 10));
  const [showCustom, setShowCustom] = useState(false);
  const systemDark = useSystemDark();
  const dark = theme.scheme === 'auto' ? systemDark : theme.scheme === 'dark';
  const colors = new ZenThemeColors(dark, theme.opacity);
  const save = (next: WorkspaceTheme) => { current.current = next; setTheme(next); onChange(next); };
  const fromPositions = (dots: ZenThemeColors['dots'], algorithm: string, type?: string): ThemeDot[] => dots.map((dot, index) => ({
    c: colors.getColorFromPosition(dot.position.x, dot.position.y, dot.type ?? type), position: dot.position,
    isPrimary: index === 0, algorithm, type: dot.type ?? type,
  }));
  const updatePosition = (event: React.PointerEvent) => {
    if (!pad.current) return;
    const rect = pad.current.getBoundingClientRect();
    const position = { x: Math.max(0, Math.min(360, (event.clientX - rect.left) / rect.width * 360)), y: Math.max(0, Math.min(360, (event.clientY - rect.top) / rect.height * 360)) };
    const existing = current.current.colors.filter(dot => !dot.isCustom);
    colors.dots = (existing.length ? existing : [{ position }]).map((dot, index) => ({ ID: index, position: index === 0 ? position : dot.position, type: 'type' in dot ? dot.type : undefined }));
    const algorithm = existing[0]?.algorithm || 'floating';
    const dots = colors.calculateCompliments(colors.dots, 'update', algorithm);
    save({ ...current.current, colors: [...fromPositions(dots, colors.useAlgo || algorithm), ...current.current.colors.filter(dot => dot.isCustom)] });
  };
  const alterDots = (adding: boolean) => {
    const existing = current.current.colors.filter(dot => !dot.isCustom);
    const customColors = theme.colors.filter(dot => dot.isCustom);
    if (!existing.length) { if (adding) save({ ...theme, colors: [{ c: colors.getColorFromPosition(240, 240), position: { x: 240, y: 240 }, isPrimary: true, algorithm: 'floating' }, ...customColors] }); return; }
    if (!adding && existing.length === 1) { save({ ...theme, colors: customColors }); return; }
    colors.dots = existing.map((dot, ID) => ({ ID, position: dot.position, type: dot.type }));
    if (!adding) colors.dots.pop();
    const dots = colors.calculateCompliments(colors.dots, adding ? 'add' : 'remove', adding ? existing[0]?.algorithm || '' : '');
    save({ ...theme, colors: [...fromPositions(dots, colors.useAlgo), ...customColors] });
  };
  const harmony = () => {
    const existing = theme.colors.filter(dot => !dot.isCustom);
    const options = colors.colorHarmonies.filter(h => h.angles.length === existing.length - 1);
    const index = options.findIndex(h => h.type === existing[0]?.algorithm);
    const next = options[(index + 1) % options.length]; if (!next) return;
    colors.dots = existing.map((dot, ID) => ({ ID, position: dot.position, type: dot.type }));
    save({ ...theme, colors: [...fromPositions(colors.calculateCompliments(colors.dots, 'update', next.type), next.type), ...theme.colors.filter(dot => dot.isCustom)] });
  };
  const selectPreset = (preset: typeof presets[number]) => {
    const position = { x: preset.position[0], y: preset.position[1] };
    colors.dots = Array.from({ length: preset.count }, (_, ID) => ({ ID, position, type: 'type' in preset ? preset.type : undefined }));
    const dots = colors.calculateCompliments(colors.dots, 'update', preset.algorithm === 'float' ? 'floating' : preset.algorithm);
    save({ ...theme, colors: fromPositions(dots, preset.algorithm === 'float' ? 'floating' : preset.algorithm, 'type' in preset ? preset.type : undefined) });
  };
  const pageTo = (next: number) => { setPage(next); samples.current?.scrollTo({ left: next * samples.current.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
  return <section id="PanelUI-zen-gradient-generator" aria-label="Edit workspace theme">
    <div id="PanelUI-zen-gradient-generator-view" className="zen-vbox zen-theme-picker">
      <div ref={pad} className="zen-hbox zen-theme-picker-gradient" style={{ backgroundColor: dark ? '#19191d' : '#f1f1f4', '--zen-picker-preview': colors.getGradient(theme.colors) } as CSSProperties}
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button:not(.zen-theme-picker-dot)')) return;
          dragging.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); updatePosition(event);
        }} onPointerMove={event => { if (dragging.current === event.pointerId) updatePosition(event); }}
        onPointerUp={event => { if (dragging.current === event.pointerId) { dragging.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onPointerCancel={() => { dragging.current = null; }}>
        <div className="zen-theme-picker-preview" />
        {theme.colors.filter(dot => !dot.isCustom).map((dot, index) => <button type="button" key={index} aria-label={index === 0 ? 'Drag primary color' : `Color ${index + 1}`} className={`zen-theme-picker-dot ${index === 0 ? 'primary' : ''}`} style={{ left: `${dot.position.x / 360 * 100}%`, top: `${dot.position.y / 360 * 100}%`, '--zen-theme-picker-dot-color': Array.isArray(dot.c) ? `rgb(${dot.c.join(',')})` : dot.c } as CSSProperties} />)}
        <div id="PanelUI-zen-gradient-generator-scheme" className="zen-hbox">{(['auto', 'light', 'dark'] as const).map(scheme => <button type="button" key={scheme} title={scheme === 'auto' ? 'System appearance' : scheme + ' appearance'} aria-label={scheme + ' appearance'} aria-pressed={theme.scheme === scheme} onClick={() => save({ ...theme, scheme })}><Icon name={scheme === 'auto' ? 'algorithm' : scheme === 'light' ? 'face-sun' : 'moon-stars'} size={16} /></button>)}</div>
        {!theme.colors.length && <span id="PanelUI-zen-gradient-generator-color-click-to-add">Click to add a color</span>}
        <div id="PanelUI-zen-gradient-generator-color-actions" className="zen-hbox">
          <button type="button" title="Add color" aria-label="Add color" disabled={theme.colors.length >= 16 || theme.colors.filter(dot => !dot.isCustom).length >= 3} onClick={() => alterDots(true)}><Icon name="plus" size={16} /></button>
          <button type="button" title="Remove color" aria-label="Remove color" disabled={!theme.colors.some(dot => !dot.isCustom)} onClick={() => alterDots(false)}><Icon name="unpin" size={16} /></button>
          <button type="button" title="Change color harmony" aria-label="Change color harmony" disabled={theme.colors.filter(dot => !dot.isCustom).length < 2} onClick={harmony}><Icon name="algorithm" size={16} /></button>
        </div>
      </div>
      <div className="zen-hbox zen-theme-presets-row">
        <button type="button" aria-label="Previous palette" disabled={page === 0} onClick={() => pageTo(page - 1)}><Icon name="back" size={16} /></button>
        <div id="PanelUI-zen-gradient-generator-color-pages" ref={samples}>
          {[0, 1, 2, 3, 4].map(group => <div className="zen-hbox" key={group}>{presets.slice(group * 8, group === 4 ? undefined : group * 8 + 8).map((preset, index) => <button key={index} type="button" data-num-dots={preset.count} title={`Palette ${group * 8 + index + 1}`} aria-label={`Palette ${group * 8 + index + 1}`} style={Object.fromEntries(preset.style.split(';').filter(Boolean).map(declaration => declaration.trim().split(/:(.*)/s).slice(0, 2).map(part => part.trim()))) as CSSProperties} onClick={() => selectPreset(preset)} />)}</div>)}
        </div>
        <button type="button" aria-label="Next palette" disabled={page === 4} onClick={() => pageTo(page + 1)}><Icon name="forward" size={16} /></button>
      </div>
      <div id="PanelUI-zen-gradient-generator-controls" className="zen-hbox">
        <div id="PanelUI-zen-gradient-colors-wrapper" className="zen-hbox">
          <div id="PanelUI-zen-gradient-opacity-wrapper" className="zen-vbox">
            <div id="PanelUI-zen-gradient-slider-wave"><svg viewBox="0 -7.605 455 70"><path d="M 51.373 27.395 L 419.634 27.395" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity=".3" /></svg></div>
            <input type="range" id="PanelUI-zen-gradient-generator-opacity" aria-label="Theme opacity" min=".3" max=".8" step=".001" value={theme.opacity} onChange={event => { const opacity = +event.target.value; const step = Math.round(opacity * 10); if (step !== lastHaptic.current) { api.playHapticFeedback(); lastHaptic.current = step; } save({ ...theme, opacity }); }} />
          </div>
          <div id="PanelUI-zen-gradient-generator-texture-wrapper" className="zen-vbox" style={{ '--zen-grainy-background-opacity': theme.texture } as CSSProperties}>
            {Array.from({ length: 20 }, (_, index) => { const angle = (index / 20 * 270 + 135) / 180 * Math.PI; return <span key={index} className={`zen-theme-picker-texture-dot ${index / 20 <= theme.texture ? 'active' : ''}`} style={{ left: `${50 + Math.cos(angle) * 40}%`, top: `${50 + Math.sin(angle) * 40}%` }} />; })}
            <input type="range" className="zen-texture-input" aria-label="Theme texture" min="0" max="1" step=".05" value={theme.texture} onChange={event => save({ ...theme, texture: +event.target.value })} />
          </div>
        </div>
      </div>
      <button type="button" className="zen-custom-colors-toggle" onClick={() => setShowCustom(!showCustom)}><Icon name="palette" size={16} /> Custom colors <Icon name="chevron" size={12} /></button>
      {showCustom && <div id="PanelUI-zen-gradient-generator-custom-colors" className="zen-vbox">
        <div id="zen-theme-picker-color" className="zen-vbox"><label>Custom color</label><div className="zen-hbox">
          <input type="color" aria-label="Custom color" value={custom} onChange={event => setCustom(event.target.value)} />
          <input type="number" aria-label="Color opacity" min="0" max="1" step=".01" value={customOpacity} onChange={event => setCustomOpacity(Math.max(0, Math.min(1, +event.target.value)))} />
          <button type="button" aria-label="Add custom color" disabled={theme.colors.length >= 16} onClick={() => save({ ...theme, colors: [...theme.colors, { c: `rgba(${colors.hexToRgb(custom).join(',')},${customOpacity})`, isCustom: true, position: { x: 180, y: 180 } }] })}><Icon name="plus" size={16} /></button>
        </div></div>
        <div id="PanelUI-zen-gradient-generator-custom-list" className="zen-vbox">{theme.colors.filter(dot => dot.isCustom).map((dot, index) => <div className="zen-hbox zen-theme-picker-custom-list-item" key={index}><span style={{ width: 24, height: 24, borderRadius: 5, background: String(dot.c) }} /><span>{String(dot.c)}</span><button type="button" aria-label="Remove custom color" onClick={() => save({ ...theme, colors: theme.colors.filter(color => color !== dot) })}><Icon name="close" size={16} /></button></div>)}</div>
      </div>}
    </div>
  </section>;
}
