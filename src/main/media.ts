import { pathToFileURL } from 'node:url';
import { net, protocol, session } from 'electron';
import { libraryStore } from './store';
import { previewableDownload } from '../shared/media';

// Only the isolated interface session receives this protocol; webpages never
// get access to local download files or arbitrary paths supplied over IPC.
export function declareMediaProtocol(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'browser-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
}

export function registerMediaProtocol(): void {
  session.fromPartition('chrome').protocol.handle('browser-media', async request => {
    const url = new URL(request.url);
    const entry = url.hostname === 'download' && !url.search && libraryStore.get().downloads.find(download => download.id === url.pathname.slice(1));
    if (!entry || !previewableDownload(entry)) return new Response('Not found', { status: 404 });
    try { return await net.fetch(pathToFileURL(entry.path).href, { headers: request.headers }); }
    catch { return new Response('File unavailable', { status: 404 }); }
  });
}
