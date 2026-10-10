// Bundles the main process and preload scripts with esbuild, and the
// interface with Vite, into out/.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
  // Provided by Electron, or resolved from node_modules at runtime
  // (the ad blocker locates its own preload file on disk).
  external: ['electron', '@ghostery/*'],
};

await Promise.all([
  esbuild({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'out/main/index.js' }),
  // Preloads run sandboxed: a single file, nothing but `electron` required.
  esbuild({ ...common, entryPoints: ['src/preload/chrome.ts'], outfile: 'out/preload/chrome.js', external: ['electron'] }),
  esbuild({ ...common, entryPoints: ['src/preload/page.ts'], outfile: 'out/preload/page.js', external: ['electron'] }),
  vite({ configFile: 'vite.config.mts', logLevel: 'warn' }),
]);
console.log('Built out/');
