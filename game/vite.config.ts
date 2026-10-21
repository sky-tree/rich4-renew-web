import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';

/** The app's version (package.json), shown on the title screen. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Configurable base path for Web deployment (e.g. RICH4_BASE=/rich4/ or --base=/rich4/, defaulting to './').
// RICH4_NO_ASSETS=1 skips copying the linked art (public/assets, over 1 GB) for quick code-only builds,
// while still emitting the lightweight PWA App Shell files (`manifest.webmanifest` and `sw.js`).
export default defineConfig({
  base: process.env.RICH4_BASE || './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    copyPublicDir: !process.env.RICH4_NO_ASSETS,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/peerjs') || id.includes('node_modules/webrtc-adapter')) {
            return 'vendor-peer';
          }
          if (id.includes('/src/core/')) {
            return 'core-engine';
          }
          if (id.includes('/src/ui/screens/')) {
            return 'ui-screens';
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    {
      name: 'rich4-emit-pwa-shell',
      writeBundle(options, bundle) {
        const outDir = options.dir || 'dist';
        // Ensure manifest.webmanifest and app shell icons are present even when RICH4_NO_ASSETS=1 skips public/ copy
        if (process.env.RICH4_NO_ASSETS) {
          const manifestSrc = new URL('./public/manifest.webmanifest', import.meta.url);
          if (existsSync(manifestSrc)) {
            writeFileSync(join(outDir, 'manifest.webmanifest'), readFileSync(manifestSrc));
          }
          const faviconSrc = new URL('./public/favicon.ico', import.meta.url);
          if (existsSync(faviconSrc)) {
            writeFileSync(join(outDir, 'favicon.ico'), readFileSync(faviconSrc));
          }
          const iconsDir = join(outDir, 'icons');
          if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });
          for (const iconName of ['icon-192.png', 'icon-512.png', 'icon-32.png', 'icon.svg']) {
            const iconSrc = new URL(`./public/icons/${iconName}`, import.meta.url);
            if (existsSync(iconSrc)) {
              writeFileSync(join(iconsDir, iconName), readFileSync(iconSrc));
            }
          }
        }

        // Collect all emitted JS and CSS bundles so the Service Worker pre-caches the
        // complete minimal runnable App Shell (fixing P1-4 & Issue #2).
        const shellAssets = Object.keys(bundle)
          .filter((fileName) => /\.(?:js|css)$/i.test(fileName))
          .sort()
          .map((fileName) => `./${fileName}`);

        const precacheList = [
          './',
          './index.html',
          './manifest.webmanifest',
          './favicon.ico',
          './icons/icon-192.png',
          './icons/icon-512.png',
          ...shellAssets,
        ];

        const buildHash = createHash('sha256')
          .update(`${version}:${shellAssets.join(',')}`)
          .digest('hex')
          .slice(0, 12);
        const swVersion = `v${version}-${buildHash}`;

        const swTemplateUrl = new URL('./public/sw.js', import.meta.url);
        if (existsSync(swTemplateUrl)) {
          let swSource = readFileSync(swTemplateUrl, 'utf8');
          swSource = swSource.replace(
            /\/\* __RICH4_SW_VERSION__ \*\/ '[^']*'/,
            JSON.stringify(swVersion),
          );
          swSource = swSource.replace(
            /\/\* __RICH4_SW_PRECACHE__ \*\/ \[[\s\S]*?\]/,
            JSON.stringify(precacheList, null, 2),
          );
          writeFileSync(join(outDir, 'sw.js'), swSource, 'utf8');
        }
      },
    },
  ],
});
