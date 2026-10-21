// Both services bind loopback; staging Nginx applies Basic Auth before proxying.
import { createServer } from 'node:http';
import { PeerServer } from 'peer';
import { makePartyConfig } from './config.mjs';
import { sessionHandler } from './session.mjs';

const secret = process.env.RICH4_TURN_SECRET;
const publicIp = process.env.RICH4_TURN_PUBLIC_IP;
makePartyConfig(secret, publicIp); // Fail closed before opening any listener.
const handleSession = sessionHandler(secret, async authorization => {
  const response = await fetch('http://127.0.0.1:18184/', { headers: { authorization }, signal: AbortSignal.timeout(3000) });
  await response.arrayBuffer();
  return response.status === 200;
});
const api = createServer(async (request, response) => {
  if (await handleSession(request, response)) return;
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET' || request.url !== '/api/party-config') {
    response.writeHead(404); response.end(); return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(makePartyConfig(secret, publicIp)));
});
api.listen(18182, '127.0.0.1');
let signalHttp;
PeerServer({ host: '127.0.0.1', port: 18183, path: '/peerjs',
  proxied: true, allow_discovery: false, concurrent_limit: 32 }, server => { signalHttp = server; });
const shutdown = () => { api.close(); signalHttp?.close(); setTimeout(() => process.exit(0), 1000).unref(); };
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, shutdown);
