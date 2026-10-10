import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Only the browser's own interface goes through Vite; main and preload
// scripts are bundled with esbuild (scripts/build.mjs).
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../out/renderer',
    emptyOutDir: true,
    target: 'chrome140',
  },
});
