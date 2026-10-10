import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, shell, type Session, type WebContents } from 'electron';
import type { DownloadState } from '../shared/types';

interface Download extends DownloadState {
  path: string;
}

export interface DownloadsHost {
  changed(): void;
  downloadStarted(source: WebContents): void;
}

/** Saves every download straight to ~/Downloads and tracks its progress. */
export class Downloads {
  private items: Download[] = [];
  hasUnseenFinished = false;
  host: DownloadsHost | null = null;

  start(session: Session): void {
    session.on('will-download', (_event, item, source) => {
      const destination = uniqueDestination(app.getPath('downloads'), item.getFilename());
      item.setSavePath(destination);

      const download: Download = {
        id: randomUUID(),
        filename: path.basename(destination),
        progress: 0,
        isFinished: false,
        failed: false,
        path: destination,
      };
      this.items.unshift(download);

      item.on('updated', () => {
        const total = item.getTotalBytes();
        download.progress = total > 0 ? item.getReceivedBytes() / total : 0;
        this.host?.changed();
      });
      item.once('done', (_e, state) => {
        download.isFinished = true;
        if (state === 'completed') {
          download.progress = 1;
          this.hasUnseenFinished = true;
        } else {
          download.failed = true;
        }
        this.host?.changed();
      });

      this.host?.downloadStarted(source);
      this.host?.changed();
    });
  }

  list(): DownloadState[] {
    return this.items.map(({ path: _path, ...state }) => state);
  }

  markSeen(): void {
    this.hasUnseenFinished = false;
    this.host?.changed();
  }

  find(id: string): Download | undefined {
    return this.items.find((item) => item.id === id);
  }

  open(id: string): void {
    const item = this.find(id);
    if (item?.isFinished && !item.failed) void shell.openPath(item.path);
  }

  reveal(id: string): void {
    const item = this.find(id);
    if (item) shell.showItemInFolder(item.path);
  }
}

/** "name.ext", or "name (1).ext", "name (2).ext"… if that's taken. */
function uniqueDestination(directory: string, filename: string): string {
  let candidate = path.join(directory, filename);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  for (let counter = 1; fs.existsSync(candidate); counter++) {
    candidate = path.join(directory, `${base} (${counter})${ext}`);
  }
  return candidate;
}
