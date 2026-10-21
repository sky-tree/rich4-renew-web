/**
 * App Shell Service Worker for Rich4 Renew Web (M6-01 / M6-02).
 *
 * Design principles:
 * 1. Scoped strictly to the current registration directory (e.g. `/rich4/` or `/`).
 * 2. Pre-caches the complete minimal runnable App Shell (`./`, `./index.html`,
 *    `./manifest.webmanifest`, plus the build's JS and CSS bundles injected at build time).
 *    NEVER silently pre-caches the 1.64 GB full map/audio asset corpus.
 * 3. Serves fingerprinted build bundles (`assets/*.js`, `assets/*.css`, `assets/*.woff2`)
 *    with Cache-First, while HTML navigations use Network-First with App Shell fallback.
 * 4. Checks explicit opt-in offline map caches (`rich4-offline-map-*`) when matching
 *    game asset requests (`assets/maps/*`, `assets/ground/*`, `assets/hd/*`, `assets/orig/*`).
 * 5. Supports emergency kill-switch (`SKIP_WAITING` / `PURGE_ALL_CACHES` message).
 */

const SHELL_CACHE_VERSION = /* __RICH4_SW_VERSION__ */ 'v1';
const SHELL_CACHE_NAME = `rich4-app-shell-${SHELL_CACHE_VERSION}`;
const OFFLINE_MAP_PREFIX = 'rich4-offline-map-';

const SHELL_URLS = /* __RICH4_SW_PRECACHE__ */ [
  './',
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith('rich4-app-shell-') && k !== SHELL_CACHE_NAME,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'PURGE_ALL_CACHES') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith('rich4-') || k.startsWith(OFFLINE_MAP_PREFIX))
              .map((k) => caches.delete(k)),
          ),
        ),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: Network-first with cached App Shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE_NAME).then((c) => c.put('./', copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((r) => r || caches.match('./index.html') || caches.match('./')),
        ),
    );
    return;
  }

  // Build bundles (JS/CSS/Fonts) and opt-in offline map assets: Cache-first, then network.
  if (url.pathname.includes('/assets/') || url.pathname.endsWith('manifest.webmanifest')) {
    const isCodeOrFontBundle = /\.(?:js|css|woff2?)$/i.test(url.pathname);
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && isCodeOrFontBundle) {
            const copy = res.clone();
            caches.open(SHELL_CACHE_NAME).then((c) => c.put(req, copy)).catch(() => undefined);
          }
          return res;
        });
      }),
    );
  }
});
