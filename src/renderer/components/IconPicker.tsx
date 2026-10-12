import { useLayoutEffect, useRef, useState } from 'react';
import emojis from '../zen/emojis.json';
import selectable from '../zen/selectable-icons.json';
import { WorkspaceIcon } from './WorkspaceIcon';
import { Icon } from './Icon';

export function IconPicker({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  const [page, setPage] = useState(value.startsWith('zen:') ? 'icons' : 'emoji');
  const [query, setQuery] = useState('');
  const pages = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (value.startsWith('zen:') && pages.current) pages.current.scrollLeft = pages.current.clientWidth; }, []);
  const change = (next: string) => { setPage(next); pages.current?.scrollTo({ left: next === 'icons' ? pages.current.clientWidth : 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
  return <section id="PanelUI-zen-emojis-picker" className="zen-icon-picker" aria-label="Choose Space icon">
    <div id="PanelUI-zen-picker-header" className="zen-hbox">
      <Icon name="palette" size={16} />
      <div id="PanelUI-zen-emojis-buttons-wrapper" className="zen-hbox">
        <button type="button" className={page === 'emoji' ? 'selected' : ''} onClick={() => change('emoji')}>Emoji</button>
        <button type="button" className={page === 'icons' ? 'selected' : ''} onClick={() => change('icons')}>Icons</button>
      </div>
      <button type="button" id="PanelUI-zen-emojis-picker-none" aria-label="Clear icon" onClick={() => onSelect('')}><Icon name="trash" size={16} /></button>
    </div>
    <div id="PanelUI-zen-emojis-picker-pages" className="zen-hbox" ref={pages}>
      <div className="zen-vbox" data-emojis="true">
        <div id="PanelUI-zen-emojis-picker-header" className="zen-hbox"><input type="search" id="PanelUI-zen-emojis-picker-search" aria-label="Search emoji" placeholder="Search emoji…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div id="PanelUI-zen-emojis-picker-list">
          {emojis.filter(emoji => !query || emoji.tags.some(tag => tag.includes(query.toLowerCase())) || emoji.emoji === query).map(emoji => <button type="button" key={emoji.emoji + emoji.order} className="zen-emojis-picker-emoji" title={emoji.tags[0]} onClick={() => onSelect(emoji.emoji)}>{emoji.emoji}</button>)}
        </div>
      </div>
      <div id="PanelUI-zen-emojis-picker-svgs" className="zen-hbox">
        {selectable.map(name => <button type="button" className="zen-emojis-picker-svg" key={name} title={name.replace('.svg', '').replaceAll('-', ' ')} onClick={() => onSelect('zen:' + name)}><WorkspaceIcon value={'zen:' + name} size={22} /></button>)}
      </div>
    </div>
  </section>;
}
