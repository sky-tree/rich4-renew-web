import { defaultTelemetry } from '../assets/offline-pwa';

/** Retry failed DOM art too: canvas sprites have their own loader and retry policy. */
export function initImageRecovery() {
  type Retry = { source: string; current: string; attempts: number; timer?: ReturnType<typeof setTimeout> };
  const states = new WeakMap<HTMLImageElement, Retry>();
  const failed = new Set<HTMLImageElement>();
  const schedule = (img: HTMLImageElement, state: Retry) => {
    if (state.timer || state.attempts >= 3) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (!img.isConnected || img.src !== state.current) { failed.delete(img); return; }
      if (!navigator.onLine) return; // The online event starts a fresh bounded retry batch.
      const url = new URL(state.source);
      url.searchParams.set('rich4-retry', `${__BUILD_SHA__}.${++state.attempts}`);
      state.current = url.href;
      defaultTelemetry.record('asset', 'image_retry', { attempt: state.attempts });
      img.src = state.current;
    }, 1000 * 2 ** state.attempts);
  };
  const error = (event: Event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.isConnected) return;
    const url = new URL(img.src, document.baseURI);
    if (!/^https?:$/.test(url.protocol) || !url.pathname.includes('/assets/')) return;
    let state = states.get(img);
    if (!state || img.src !== state.current) {
      if (state?.timer) clearTimeout(state.timer);
      state = { source: img.src, current: img.src, attempts: 0 };
      states.set(img, state);
    }
    defaultTelemetry.record('asset', 'image_failed', url.pathname);
    failed.add(img);
    // Detached/replaced UI elements must not accumulate in the recovery queue.
    for (const old of failed) if (!old.isConnected) failed.delete(old);
    if (failed.size > 100) failed.delete(failed.values().next().value!);
    schedule(img, state);
  };
  const loaded = (event: Event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const state = states.get(img);
    if (state?.timer) { clearTimeout(state.timer); state.timer = undefined; }
    failed.delete(img);
  };
  const online = () => {
    for (const img of failed) {
      const state = states.get(img);
      if (!img.isConnected) { failed.delete(img); continue; }
      if (state) { state.attempts = 0; schedule(img, state); }
    }
  };
  document.addEventListener('error', error, true);
  document.addEventListener('load', loaded, true);
  window.addEventListener('online', online);
}
