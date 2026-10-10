// Bundles the main process and preload scripts with esbuild, and the
// interface with Vite, into out/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

// The Liquid Glass addon (native/glass.mm). It uses Node-API, which is
// stable across Node and Electron versions, so it's built once with
// node-gyp and only rebuilt when its source changes.
if (process.platform === 'darwin') {
  const source = 'native/glass.mm';
  const built = 'native/build/Release/glass.node';
  if (!fs.existsSync(built) || fs.statSync(built).mtimeMs < fs.statSync(source).mtimeMs) {
    execFileSync('npx', ['node-gyp', 'rebuild', '--directory', 'native'], { stdio: 'inherit' });
  }
  fs.mkdirSync('out/native', { recursive: true });
  // A new file rather than overwriting in place: macOS caches a binary's
  // code signature per file and kills a process loading one changed under it.
  fs.rmSync('out/native/glass.node', { force: true });
  fs.copyFileSync(built, 'out/native/glass.node');
}

await Promise.all([
  esbuild({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'out/main/index.js' }),
  // Preloads run sandboxed: a single file, nothing but `electron` required.
  esbuild({ ...common, entryPoints: ['src/preload/chrome.ts'], outfile: 'out/preload/chrome.js', external: ['electron'] }),
  esbuild({ ...common, entryPoints: ['src/preload/page.ts'], outfile: 'out/preload/page.js', external: ['electron'] }),
  vite({ configFile: 'vite.config.mts', logLevel: 'warn' }),
]);
console.log('Built out/');
