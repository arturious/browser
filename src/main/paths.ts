import path from 'node:path';

// Everything is bundled into out/: main/index.js, preload/*.js, renderer/.
export const CHROME_PRELOAD = path.join(__dirname, '../preload/chrome.js');
export const PAGE_PRELOAD = path.join(__dirname, '../preload/page.js');
export const RENDERER_HTML = path.join(__dirname, '../renderer/index.html');
