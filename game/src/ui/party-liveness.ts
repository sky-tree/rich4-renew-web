import type { DataConnection } from 'peerjs';

/** DataChannel.open can stay true after a mobile network disappears. */
export function watchPartyConnection(connection: DataConnection) {
  let heard = Date.now();
  let stopped = false;
  const close = () => { if (!stopped) { stop(); connection.close(); } };
  const returned = () => { if (connection.open) close(); };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (typeof window !== 'undefined') window.removeEventListener('online', returned);
  };
  const timer = setInterval(() => {
    if (!connection.open) return;
    if (Date.now() - heard >= 15000) { close(); return; }
    try { connection.send({ t: 'ping' }); } catch { close(); }
  }, 3000);
  connection.on('open', () => { heard = Date.now(); });
  connection.on('data', message => {
    heard = Date.now();
    if (message && typeof message === 'object' && (message as { t?: string }).t === 'ping') {
      try { connection.send({ t: 'pong' }); } catch { close(); }
    }
  });
  connection.on('close', stop);
  connection.on('error', close);
  // On return from airplane mode, abandon the old ICE path rather than waiting
  // indefinitely for Safari to report a closed channel. The room owns reconnection.
  if (typeof window !== 'undefined') window.addEventListener('online', returned);
}
