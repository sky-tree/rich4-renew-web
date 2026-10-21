import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { issueSession, validSession, sessionHandler, SESSION_COOKIE } from './session.mjs';

const secret = 'test-only-session-signing-secret-at-least-32-characters';

test('session rejects tampering, expiry, future expiry and a different signing key', () => {
  const now = 1700000000000, token = issueSession(secret, now);
  assert(validSession(secret, token, now));
  assert(!validSession(secret, token, now + 8 * 3600000));
  assert(!validSession(secret, token.replace(/^./, '9'), now));
  assert(!validSession(`${secret}other`, token, now));
  assert(!validSession(secret, token, now - 120000));
  assert(!validSession(secret, undefined, now));
  assert(!token.includes(secret));
});

test('login uses existing credentials once, then cookie authenticates subrequests without Basic prompts', async () => {
  const credential = `Basic ${Buffer.from('test-user:test-password').toString('base64')}`;
  let checks = 0;
  const handler = sessionHandler(secret, async value => { checks++; return value === credential; });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/api/session`);
    assert.match(await page.text(), /autocomplete="current-password"/);
    const missing = await fetch(`${base}/api/session-check`);
    assert.equal(missing.status, 401); assert.equal(missing.headers.get('www-authenticate'), null);
    const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { authorization: credential } });
    assert.equal(login.status, 204);
    const cookie = login.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert(cookie.includes(flag));
    assert(!cookie.includes('test-password')); assert(cookie.startsWith(`${SESSION_COOKIE}=`));
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${base}/api/session-check`, { headers: { cookie: cookie.split(';')[0] } });
      assert.equal(response.status, 204); assert.equal(response.headers.get('www-authenticate'), null);
    }
    assert.equal(checks, 1);
    assert.equal((await fetch(`${base}/api/session-check`, { headers: { cookie: `${SESSION_COOKIE}=invalid` } })).status, 401);
    const form = await fetch(`${base}/api/session`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://rich4-staging.gopeaks.club' }, body: new URLSearchParams({ username: 'test-user', password: 'test-password' }) });
    assert.equal(form.status, 303); assert.equal(form.headers.get('location'), '/');
    assert.equal((await fetch(`${base}/api/session`, { method: 'POST', headers: { origin: 'https://other.example', authorization: credential } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
