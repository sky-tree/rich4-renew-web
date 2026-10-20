import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** The app's version (package.json), shown on the title screen. */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

// Configurable base path for Web deployment (e.g. RICH4_BASE=/rich4/ or --base=/rich4/, defaulting to './').
// RICH4_NO_ASSETS=1 skips copying the linked art (public/assets, over 1 GB) for quick code-only builds,
// while still emitting the lightweight PWA App Shell files (`manifest.webmanifest` and `sw.js`).
export default defineConfig({
  base: process.env.RICH4_BASE || './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { copyPublicDir: !process.env.RICH4_NO_ASSETS },
  plugins: [
    {
      name: 'rich4-emit-pwa-shell',
      generateBundle() {
        if (!process.env.RICH4_NO_ASSETS) return;
        for (const file of ['manifest.webmanifest', 'sw.js']) {
          const url = new URL(`./public/${file}`, import.meta.url);
          if (existsSync(url)) {
            this.emitFile({
              type: 'asset',
              fileName: file,
              source: readFileSync(url),
            });
          }
        }
      },
    },
  ],
});
