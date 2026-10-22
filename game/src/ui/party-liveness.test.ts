import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { watchPartyConnection } from './party-liveness';

afterEach(() => { vi.useRealTimers(); });

function channel() {
  const c = new EventEmitter() as any;
  c.open = true;
  c.send = vi.fn();
  c.close = vi.fn(() => { c.open = false; c.emit('close'); });
  return c;
}

it('closes a silent transport even while DataChannel.open still reports true', async () => {
  vi.useFakeTimers();
  const c = channel();
  watchPartyConnection(c);
  await vi.advanceTimersByTimeAsync(15000);
  expect(c.close).toHaveBeenCalledOnce();
  expect(c.send).toHaveBeenCalledWith({ t: 'ping' });
  await vi.advanceTimersByTimeAsync(30000);
  expect(c.close).toHaveBeenCalledOnce();
});

it('keeps an idle but responsive connection alive and stops its timer on close', async () => {
  vi.useFakeTimers();
  const c = channel();
  c.send.mockImplementation((m: { t: string }) => { if (m.t === 'ping') c.emit('data', { t: 'pong' }); });
  watchPartyConnection(c);
  await vi.advanceTimersByTimeAsync(60000);
  expect(c.close).not.toHaveBeenCalled();
  c.emit('data', { t: 'ping' });
  expect(c.send).toHaveBeenCalledWith({ t: 'pong' });
  c.close();
  const calls = c.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(15000);
  expect(c.send).toHaveBeenCalledTimes(calls);
});
