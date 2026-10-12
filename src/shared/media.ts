import type { DownloadEntry } from './types';

export function mediaKind(name: string): 'image' | 'video' | 'audio' | null {
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|webm)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|m4a|ogg)$/i.test(name)) return 'audio';
  return null;
}

export function previewableDownload(entry: DownloadEntry): boolean {
  return entry.status === 'completed' && !!entry.path && !!mediaKind(entry.name);
}
