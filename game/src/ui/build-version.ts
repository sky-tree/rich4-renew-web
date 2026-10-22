/** Check only on the title screen; an update must never interrupt a running game. */
export async function checkTitleUpdate(title: HTMLElement) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}release-manifest.json`, {
      cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return;
    const manifest: unknown = await response.json();
    const sha = (manifest as { gitSha?: unknown } | null)?.gitSha;
    // Older manifests, login HTML, offline failures and source archives have no comparable revision.
    if (typeof sha !== 'string' || !/^[a-f0-9]{7,40}$/.test(sha) || !/^[a-f0-9]{7,40}$/.test(__BUILD_SHA__)) return;
    if (!title.isConnected || sha === __BUILD_SHA__) return;
    const update = title.querySelector<HTMLButtonElement>('.title-update');
    if (update) update.hidden = false;
  } catch { /* Offline play and local development do not require a release manifest. */ }
}
