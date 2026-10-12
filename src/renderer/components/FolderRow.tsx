/* MPL-2.0. Per-item visibility follows Zen folder collapse/expand; the
 * interrupted-animation handling is the original ZenFolders implementation. */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { animateFolderRow, cancelFolderRow } from '../zen/folder-motion.js';

export function FolderRow({ visible, children }: { visible: boolean; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const row = element.current!;
    if (!initialized.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelFolderRow(row);
      row.style.height = visible ? '' : '0px'; row.style.minHeight = visible ? '' : '0px'; row.style.opacity = visible ? '' : '0';
    } else {
      void animateFolderRow(row, { opacity: visible ? '' : 0, height: visible ? '' : 0, minHeight: visible ? '' : 0 }, { duration: 0.18, ease: 'easeInOut' });
    }
    initialized.current = true;
  }, [visible]);
  useLayoutEffect(() => { const row = element.current!; return () => cancelFolderRow(row); }, []);
  return <div ref={element} className="zen-folder-row" inert={!visible}>{children}</div>;
}
