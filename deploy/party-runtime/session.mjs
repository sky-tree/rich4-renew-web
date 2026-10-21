import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-rich4-staging';
const TTL = 8 * 3600;
const ORIGIN = 'https://rich4-staging.gopeaks.club';
const signature = (secret, value) => createHmac('sha256', secret).update(`rich4-session-v1:${value}`).digest('base64url');

export function issueSession(secret, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('A private signing secret is required');
  const value = `${Math.floor(now / 1000) + TTL}.${randomBytes(16).toString('hex')}`;
  return `${value}.${signature(secret, value)}`;
}

export function validSession(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || !/^\d{10}\.[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expiry, nonce, mac] = token.split('.');
  const seconds = Math.floor(now / 1000);
  if (Number(expiry) <= seconds || Number(expiry) > seconds + TTL + 60) return false;
  const expected = signature(secret, `${expiry}.${nonce}`);
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

const loginPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Rich4 私享测试登录</title>
<style>body{font:18px system-ui;background:#15282c;color:#fff;margin:0;min-height:100dvh;display:grid;place-items:center}main{width:min(340px,80vw);padding:24px}label{display:block;margin:18px 0}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:8px;border:0;margin-top:6px}button{background:#ffd05c;color:#30220d}p{line-height:1.5;font-size:15px}</style>
<main><h1>Rich4 私享测试</h1><p>请使用现有测试账号登录。登录后可在同一浏览器中继续游戏。</p><form method="post" action="/api/session"><label>用户名<input name="username" autocomplete="username" required maxlength="128"></label><label>密码<input name="password" type="password" autocomplete="current-password" required maxlength="512"></label><button>登录</button></form></main></html>`;

/** The verifier delegates password checking to loopback Nginx's existing htpasswd. */
export function sessionHandler(secret, verifyBasic) {
  issueSession(secret); // Validate configuration before listening.
  return async (request, response) => {
    if (!['/api/session', '/api/session-check'].includes(request.url)) return false;
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const token = request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    const basic = request.headers.authorization;
    const basicOk = async value => typeof value === 'string' && /^Basic [A-Za-z0-9+/=]{1,2048}$/.test(value) && await verifyBasic(value);
    const authorize = async value => {
      if (!await basicOk(value)) return false;
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${issueSession(secret)}; Path=/; Max-Age=${TTL}; HttpOnly; Secure; SameSite=Lax`);
      return true;
    };
    try {
      if (request.url === '/api/session-check') {
        const allowed = validSession(secret, token) || await authorize(basic);
        response.writeHead(allowed ? 204 : 401); response.end(); return true;
      }
      if (request.method === 'GET') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(loginPage); return true;
      }
      if (request.method !== 'POST') { response.writeHead(405); response.end(); return true; }
      if (request.headers.origin && request.headers.origin !== ORIGIN) { response.writeHead(403); response.end(); return true; }
      if (basic && !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        const allowed = await authorize(basic);
        response.writeHead(allowed ? 204 : 401); response.end(); return true;
      }
      if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
        response.writeHead(415); response.end(); return true;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) { response.writeHead(413); response.end(); return true; }
      }
      const fields = new URLSearchParams(body);
      const user = fields.get('username') ?? '', password = fields.get('password') ?? '';
      if (!user || user.includes(':') || user.length > 128 || !password || password.length > 512 ||
        !await authorize(`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`)) {
        response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(loginPage.replace('请使用现有测试账号登录。', '账号或密码不正确，请重新输入。')); return true;
      }
      response.writeHead(303, { Location: '/' }); response.end(); return true;
    } catch {
      response.writeHead(503); response.end('Sign-in temporarily unavailable'); return true;
    }
  };
}
