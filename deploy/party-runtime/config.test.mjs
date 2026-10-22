import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makePartyConfig } from './config.mjs';

test('private staging uses relay without requiring a query parameter', () => {
  const cfg = makePartyConfig('test-only-signing-secret-with-more-than-32-chars', '203.0.113.1');
  assert.equal(cfg.iceTransportPolicy, 'relay');
});

test('REST TURN credentials expire in one hour and never expose the signing secret', () => {
  const secret = 'test-only-signing-secret-with-more-than-32-chars';
  const now = 1700000000000;
  const cfg = makePartyConfig(secret, '203.0.113.1', now);
  assert.equal(cfg.expiresAt, now + 3600000);
  const turn = cfg.iceServers[1];
  assert.equal(turn.username.split(':')[0], String(cfg.expiresAt / 1000));
  assert.equal(turn.credential, createHmac('sha1', secret).update(turn.username).digest('base64'));
  assert.equal(JSON.stringify(cfg).includes(secret), false);
  assert.notEqual(makePartyConfig(secret, '203.0.113.1', now).iceServers[1].username, turn.username);
  assert.throws(() => makePartyConfig('', '203.0.113.1'));
});
