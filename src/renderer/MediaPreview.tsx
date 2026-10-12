/* MPL-2.0. ZenLibraryMediaPreview lifecycle adapted to Electron's native
 * overlay; the morph and stylesheet are imported directly from Zen. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useAppState } from './state';
import { useZenTheme } from './useZenTheme';
import { mediaKind, previewableDownload } from '../shared/media';
import { Icon } from './components/Icon';
import { morphMedia } from './zen/media-morph.js';
import './zen/media-preview-source.css';

export function MediaPreview() {
  const state = useAppState();
  useZenTheme(state);
  const preview = state.ui.mediaPreview;
  const entry = state.downloads.find(download => download.id === preview?.id);
  const entries = state.downloads.filter(previewableDownload);
  const index = entries.findIndex(download => download.id === entry?.id);
  const root = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const closing = useRef(false);
  const alive = useRef(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const parts = () => ({
    panel: root.current!.querySelector<HTMLElement>('.zen-library-media-preview-panel')!,
    backdrop: root.current!.querySelector<HTMLElement>('.zen-library-media-preview-backdrop')!,
    header: root.current!.querySelector<HTMLElement>('.zen-library-media-preview-header')!,
    stage: root.current!.querySelector<HTMLElement>('.zen-library-media-preview-stage')!,
  });
  const reveal = useCallback(() => {
    if (!alive.current) return;
    setReady(true);
    if (opened.current || !root.current || !preview) return;
    opened.current = true;
    requestAnimationFrame(() => {
      if (!alive.current || !root.current || closing.current) return;
      root.current.style.visibility = 'visible';
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) morphMedia(parts(), preview.origin, true);
    });
  }, [preview]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true; setLeaving(true);
    if (!opened.current || !root.current || !preview || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { api.closeMediaPreview(); return; }
    void morphMedia(parts(), preview.origin, false).finished.then(() => { if (alive.current) api.closeMediaPreview(); }).catch(() => {});
  }, [preview]);
  useEffect(() => () => {
    alive.current = false;
    root.current?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  }, []);
  useEffect(() => {
    setFailed(false);
    if (!entry) return;
    const media = root.current?.querySelector<HTMLImageElement | HTMLVideoElement>('.zen-library-media-preview-media');
    if (media instanceof HTMLImageElement && media.complete || media instanceof HTMLVideoElement && media.readyState >= 2) reveal();
    const timer = setTimeout(reveal, mediaKind(entry.name) === 'video' ? 900 : 400);
    return () => clearTimeout(timer);
  }, [entry?.id, reveal]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (leaving) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); api.stepMediaPreview(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close, leaving]);
  if (!entry || !preview) return null;
  const kind = mediaKind(entry.name);
  const src = `browser-media://download/${encodeURIComponent(entry.id)}`;
  const error = () => { setFailed(true); reveal(); };
  return <div ref={root} className="zen-library-media-preview" role="dialog" aria-modal="true" aria-label={entry.name} style={{ visibility: ready ? 'visible' : 'hidden' }}>
    <div className="zen-library-media-preview-backdrop" onClick={close} />
    <div className="zen-library-media-preview-panel">
      <div className="zen-library-media-preview-header">
        <button className="sidebar-foot-button" autoFocus aria-label="Close preview" onClick={close}><Icon name="xmark" size={15} /></button>
        <button className="sidebar-foot-button" aria-label="Previous media" disabled={index <= 0 || leaving} onClick={() => api.stepMediaPreview(-1)}><Icon name="arrow.backward" size={15} /></button>
        <button className="sidebar-foot-button" aria-label="Next media" disabled={index >= entries.length - 1 || leaving} onClick={() => api.stepMediaPreview(1)}><Icon name="arrow.forward" size={15} /></button>
        <span className="zen-library-media-preview-name">{entry.name}</span>
        <span className="zen-library-media-preview-date">{new Date(entry.startedAt).toLocaleDateString()}</span>
        <button className="sidebar-foot-button" aria-label="Media options" onClick={() => api.showDownloadMenu(entry.id)}><Icon name="ellipsis" size={15} /></button>
        <button className="zen-library-media-preview-open" onClick={() => api.openDownload(entry.id)}><span className="toolbarbutton-text">Open in app</span></button>
      </div>
      <div className="zen-library-media-preview-stage" onContextMenu={event => { event.preventDefault(); api.showDownloadMenu(entry.id); }}>
        {failed ? <p>File unavailable</p> : kind === 'image' ? <img key={entry.id} className="zen-library-media-preview-media" src={src} alt={entry.name} onLoad={reveal} onError={error} />
          : kind === 'video' ? <video key={entry.id} className="zen-library-media-preview-media" src={src} controls autoPlay onLoadedData={reveal} onError={error} />
            : <audio key={entry.id} className="zen-library-media-preview-media" src={src} controls autoPlay onLoadedData={reveal} onError={error} />}
      </div>
    </div>
  </div>;
}
