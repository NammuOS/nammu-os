import react from '@vitejs/plugin-react';
import { cpSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));
const desktopRoot = resolve(repositoryRoot, 'desktop');
const desktopDist = resolve(repositoryRoot, 'dist-desktop');
const publicRoot = resolve(repositoryRoot, 'public');

function desktopPublicAssets() {
  return {
    name: 'nammu-desktop-public-assets',
    closeBundle() {
      cpSync(publicRoot, desktopDist, {
        recursive: true,
        filter(source) {
          const path = relative(publicRoot, source).replaceAll('\\', '/');
          return path !== 'firefox-wasm' && !path.startsWith('firefox-wasm/');
        },
      });
    },
  };
}

export default defineConfig({
  root: desktopRoot,
  base: './',
  // Gecko/WASM remains a Web-only compatibility layer. Desktop remote apps
  // use NativeWebSurface, so copying Firefox runtime assets would add dead
  // payload and could disguise an accidental Desktop fallback.
  publicDir: false,
  plugins: [react(), desktopPublicAssets()],
  resolve: {
    alias: {
      '@': resolve(repositoryRoot, 'src'),
    },
  },
  css: {
    postcss: repositoryRoot,
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Permissions-Policy': 'geolocation=(self), cross-origin-isolated=(self)',
      'X-Content-Type-Options': 'nosniff',
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: desktopDist,
    emptyOutDir: true,
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});
