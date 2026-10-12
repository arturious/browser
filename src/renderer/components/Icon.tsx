import type { CSSProperties } from 'react';

const assets = import.meta.glob('../assets/zen/chrome/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const selectable = import.meta.glob('../assets/zen/selectable/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const names: Record<string, string> = {
  'arrow.backward': 'back', 'arrow.forward': 'forward', 'arrow.clockwise': 'reload',
  xmark: 'close', plus: 'plus', 'sidebar.left': 'sidebar', pin: 'pin', pip: 'window',
  'speaker.wave.2': 'tab-audio-playing-small', link: 'link', checkmark: 'checkbox',
  macwindow: 'window', 'chevron.down': 'chevron', folder: 'folder', 'folder.open': 'folder',
  'folder.badge.plus': 'folder', magnifyingglass: 'search-glass',
  'line.3.horizontal.decrease': 'circle-bars-filter', ellipsis: 'menu', paintpalette: 'edit-theme',
  shield: 'tracking-protection', doc: 'page-portrait', 'music.note': 'media-unmute',
  film: 'video-fill', play: 'media-play', pause: 'media-pause',
};
interface IconProps { name: string; size: number; bold?: boolean; className?: string; }
export function Icon({ name, size, className = '' }: IconProps) {
  const file = `${names[name] ?? name}.svg`;
  const url = assets[`../assets/zen/chrome/${file}`] ?? selectable[`../assets/zen/selectable/${file}`] ?? assets['../assets/zen/chrome/help.svg'];
  return <span aria-hidden="true" className={`icon zen-source-icon ${className}`} style={{ width: size, height: size, maskImage: `url("${url}")` } as CSSProperties} />;
}
