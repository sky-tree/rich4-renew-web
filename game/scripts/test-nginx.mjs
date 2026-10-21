// Real Nginx HTTP checks; all fixtures, credentials and listeners are temporary.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { sessionHandler } from '../../deploy/party-runtime/session.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(join(tmpdir(), 'rich4-nginx-'));
mkdirSync(join(temp, 'logs'));
const password = randomBytes(24).toString('hex');
const authorization = `Basic ${Buffer.from(`candidate:${password}`).toString('base64')}`;
const hash = execFileSync('openssl', ['passwd', '-apr1', '-stdin'], { input: password, encoding: 'utf8' }).trim();
const authFile = join(temp, 'htpasswd');
writeFileSync(authFile, `candidate:${hash}\n`, { mode: 0o600 });
const runtime = join(temp, 'runtime');
const fixture = join(runtime, 'rich4');
mkdirSync(join(fixture, 'assets/maps'), { recursive: true });
mkdirSync(join(fixture, 'icons'));
for (const [file, body] of Object.entries({
  'index.html': '<!doctype html><div id="app">candidate</div>',
  'assets/index-test.js': 'export const candidate = true;',
  'assets/index-test.css': 'body { color: green; }',
  'assets/maps/maps.json': '[]', 'sw.js': '// candidate', 'manifest.webmanifest': '{}',
  'icons/icon-192.png': 'test-icon', 'release-manifest.json': '{"buildId":"candidate-A"}',
})) writeFileSync(join(fixture, file), body);
const failures = [];

async function freePort() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

try {
  for (const name of ['nginx-rich4.conf', 'web-gateway-rich4.conf', 'staging-rich4.locations.conf']) {
    const port = await freePort();
    const staging = name === 'staging-rich4.locations.conf';
    const verifierPort = staging ? await freePort() : 0;
    const auth = staging ? createHttpServer(sessionHandler(randomBytes(32).toString('hex'), async authorization => {
      const response = await fetch(`http://127.0.0.1:${verifierPort}/`, { headers: { authorization } });
      await response.arrayBuffer(); return response.status === 200;
    })) : null;
    if (auth) await new Promise(resolve => auth.listen(0, '127.0.0.1', resolve));
    const authPort = auth?.address().port;
    const snippet = readFileSync(join(repo, 'deploy', name), 'utf8')
      .replaceAll('/srv/www/apps', runtime)
      .replaceAll('/srv/devspace/repos/rich4-runtime/state/htpasswd', authFile)
      .replaceAll('/srv/devspace/repos/rich4-runtime/rich4-staging', fixture)
      .replaceAll('/srv/devspace/repos/rich4-runtime', runtime)
      .replaceAll('127.0.0.1:18182', `127.0.0.1:${authPort}`);
    const config = join(temp, `${name}.full`);
    const mime = process.env.NGINX_MIME_TYPES || '/etc/nginx/mime.types';
    const serverAuth = name === 'staging-rich4.locations.conf' ? '' : `auth_basic "candidate"; auth_basic_user_file ${authFile};`;
    const verifier = staging ? `server { listen 127.0.0.1:${verifierPort}; auth_basic "candidate"; auth_basic_user_file ${authFile}; location / { empty_gif; } }` : '';
    writeFileSync(config, `pid ${temp}/nginx.pid; error_log stderr warn;\nevents {}\nhttp { include ${mime}; access_log off;\n${verifier}\nserver { listen 127.0.0.1:${port}; ${serverAuth}\n${snippet}\n}}\n`);
    const child = spawn(process.env.NGINX_BIN || 'nginx', ['-p', `${temp}/`, '-c', config, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', err => { errors += err.message; });
    const exited = once(child, 'close').catch(() => {});
    const base = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        try { await fetch(`${base}/rich4/`); ready = true; break; } catch {}
        if (child.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert(ready, `Nginx did not start: ${errors}`);
      async function check(path, status, header, pattern, authenticated = true) {
        const actualPath = name === 'staging-rich4.locations.conf' ? path.replace(/^\/rich4/, '') : path;
        const response = await fetch(`${base}${actualPath}`, { headers: authenticated ? { authorization } : {}, redirect: 'manual' });
        try {
          assert.equal(response.status, status, `${path} HTTP status`);
          if (header) assert.match(response.headers.get(header) || '', pattern, `${path} ${header}`);
          console.log(`PASS ${name}: ${authenticated ? 'authenticated' : 'anonymous'} ${path}`);
        } catch (err) { failures.push(`${name}: ${err.message}`); }
        await response.arrayBuffer();
      }
      await check('/rich4/', 401, null, null, false);
      await check('/rich4/assets/maps/maps.json', 401, null, null, false);
      await check('/rich4/', 200, 'cache-control', /no-store/);
      await check('/rich4/assets/index-test.js', 200, 'content-type', /(?:application|text)\/javascript/);
      await check('/rich4/assets/index-test.css', 200, 'content-type', /text\/css/);
      await check('/rich4/manifest.webmanifest', 200, 'content-type', /application\/manifest\+json/);
      await check('/rich4/icons/icon-192.png', 200, 'content-type', /image\/png/, false);
      await check('/rich4/sw.js', 200, 'cache-control', /no-store/);
      await check('/rich4/sw.js', 200, 'service-worker-allowed', name === 'staging-rich4.locations.conf' ? /^\/$/ : /^\/rich4\/$/);
      await check('/rich4/assets/maps/maps.json', 200, 'cache-control', /private/);
      await check('/rich4/assets/maps/maps.json', 200, 'vary', /Authorization/);
      await check('/rich4/assets/missing.png', 404);
      if (staging) {
        const login = await fetch(`${base}/api/session`, { method: 'POST', headers: { authorization } });
        assert.equal(login.status, 204);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const authorized = await fetch(`${base}/assets/maps/maps.json`, { headers: { cookie } });
        assert.equal(authorized.status, 200); await authorized.arrayBuffer();
        const tampered = await fetch(`${base}/assets/maps/maps.json`, { headers: { cookie: `${cookie}tampered` } });
        assert.equal(tampered.status, 401); assert.equal(tampered.headers.get('www-authenticate'), null);
        await tampered.arrayBuffer();
        const code = await fetch(`${base}/assets/index-test.js`, { headers: { authorization } });
        assert.equal(code.headers.get('set-cookie'), null, 'Publicly cacheable code must never carry a private session cookie');
        await code.arrayBuffer();
        console.log('PASS staging session cookie, tamper rejection and no private cookies on public bundles');
      }
      const next = join(temp, 'release-B');
      mkdirSync(next);
      writeFileSync(join(next, 'release-manifest.json'), '{"buildId":"candidate-B"}');
      const previous = join(runtime, 'previous');
      renameSync(fixture, previous);
      symlinkSync(next, fixture);
      const manifestPath = name === 'staging-rich4.locations.conf' ? '/release-manifest.json' : '/rich4/release-manifest.json';
      assert.equal((await (await fetch(`${base}${manifestPath}`, { headers: { authorization } })).json()).buildId, 'candidate-B');
      rmSync(fixture);
      renameSync(previous, fixture);
      assert.equal((await (await fetch(`${base}${manifestPath}`, { headers: { authorization } })).json()).buildId, 'candidate-A');
      rmSync(next, { recursive: true });
    } finally { child.kill('SIGTERM'); await exited; if (auth) await new Promise(resolve => auth.close(resolve)); }
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
