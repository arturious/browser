/* MPL-2.0. Adapted from ZenLibraryWidget.sys.mjs (four entries, 200ms
 * close delay, badge flight and workspace mask). */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { AppState, DownloadEntry } from '../../shared/types';
import { api } from '../state';
import { Icon } from './Icon';
import '../zen/library-widget-source.css';

function Badge({ entry, button = false }: { entry: DownloadEntry; button?: boolean }) {
  const downloading = entry.status === 'progressing';
  const image = entry.thumbnail ?? new URL('../assets/zen/blank.svg', import.meta.url).href;
  return <span className={`zen-library-download-badge ${button ? 'library-button-badge' : ''}`} data-downloading={downloading}
    style={{ '--download-image': `url(${JSON.stringify(image)})` } as CSSProperties}>
    <svg className="zen-library-download-progress" viewBox="0 0 31 31"><circle className="zen-library-download-progress-track" cx="15.5" cy="15.5" r="14" /><circle className="zen-library-download-progress-arc" cx="15.5" cy="15.5" r="14" pathLength="100" style={{ strokeDasharray: `${entry.totalBytes ? entry.receivedBytes / entry.totalBytes * 100 : 0} 100` }} /></svg>
  </span>;
}

export function LibraryButton({ state, sidebar }: { state: AppState; sidebar: RefObject<HTMLElement | null> }) {
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const maskTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const holdMenu = useRef(false);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState(false);
  const newest = state.downloads[0];
  const previous = useRef(newest?.id);
  const downloads = state.downloads.slice(0, 4).reverse();
  useEffect(() => { if (newest?.id && previous.current !== newest.id) { setRecent(true); previous.current = newest.id; } }, [newest?.id]);
  const showBadge = newest?.status === 'progressing' || recent;
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!holdMenu.current) { setOpen(false); setRecent(false); } }, 200);
  };
  const enter = () => clearTimeout(timer.current);
  const show = () => {
    enter(); if (!downloads.length || open) return;
    const badge = button.current?.querySelector<HTMLElement>('.library-button-badge');
    const target = list.current?.lastElementChild?.querySelector<HTMLElement>('.zen-library-download-badge');
    if (badge && target) {
      const from = badge.getBoundingClientRect(), to = target.getBoundingClientRect();
      const transform = getComputedStyle(badge).transform;
      const at = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
      const rowTransform = getComputedStyle(target.parentElement!).transform;
      const rise = rowTransform === 'none' ? 0 : new DOMMatrixReadOnly(rowTransform).f;
      badge.style.setProperty('--zen-library-badge-to-x', `${at.e + to.left - from.left}px`);
      badge.style.setProperty('--zen-library-badge-to-y', `${at.f + to.top - from.top - rise}px`);
    }
    setOpen(true);
  };
  useEffect(() => api.onDownloadMenuClosed(() => { holdMenu.current = false; leave(); }), []);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(maskTimer.current); }, []);
  useEffect(() => { if (state.ui.libraryOpen) setOpen(false); }, [state.ui.libraryOpen]);
  useLayoutEffect(() => {
    const footer = button.current?.parentElement;
    const strip = sidebar.current?.querySelector<HTMLElement>('.workspace-strip');
    if (!footer || !strip) return;
    clearTimeout(maskTimer.current);
    footer.classList.toggle('library-stack-open', open);
    footer.classList.toggle('library-has-badge', !!showBadge);
    strip.classList.toggle('library-stack-open', open);
    strip.classList.add('library-stack-closing');
    strip.style.setProperty('--zen-library-stack-height', `${list.current?.getBoundingClientRect().height ?? 0}px`);
    maskTimer.current = setTimeout(() => strip.classList.remove('library-stack-closing'), 300);
    return () => { footer.classList.remove('library-stack-open', 'library-has-badge'); strip.classList.remove('library-stack-open', 'library-stack-closing'); };
  }, [open, showBadge, downloads.length, sidebar]);
  return <>
    <button ref={button} className="sidebar-foot-button library-button" title="Library (⌘⇧L)" aria-label="Open Library" onMouseEnter={show} onMouseLeave={leave} onClick={() => { setOpen(false); api.toggleLibrary(); }}>
      <span className="zen-library-sprite" />
      {newest && <span className="toolbarbutton-badge-stack" data-downloading={newest.status === 'progressing'}><Badge entry={newest} button /></span>}
    </button>
    <div ref={list} className="zen-library-download-list" onMouseEnter={enter} onMouseLeave={leave} aria-label="Recent downloads" aria-hidden={!open} inert={!open}>
      {downloads.map(entry => <div key={entry.id} className="zen-library-download-list-download" data-downloading={entry.status === 'progressing'} data-show-in-folder={entry.status === 'completed'} role="button" tabIndex={open ? 0 : -1}
        title={entry.name} onClick={() => api.openDownload(entry.id)} onKeyDown={event => { if (event.key === 'Enter') api.openDownload(entry.id); }} onContextMenu={event => { event.preventDefault(); holdMenu.current = true; api.showDownloadMenu(entry.id); }}>
        <Badge entry={entry} />
        <span className="zen-library-download-list-title-container"><span className="zen-library-download-list-title">{entry.name}</span><span className="zen-library-download-list-subtitle">{entry.openWhenDone ? 'Opens when finished' : entry.status === 'progressing' ? `${Math.round(entry.receivedBytes / 1024)} KB${entry.paused ? ' · Paused' : ''}` : entry.status}</span></span>
        <button className="sidebar-foot-button zen-library-download-action" aria-label={entry.status === 'progressing' ? `Cancel ${entry.name}` : `Show ${entry.name} in Finder`} onClick={event => { event.stopPropagation(); if (entry.status === 'progressing') api.controlDownload(entry.id, 'cancel'); else api.openDownload(entry.id, true); }}><Icon name={entry.status === 'progressing' ? 'xmark' : 'magnifyingglass'} size={16} /></button>
      </div>)}
    </div>
  </>;
}
