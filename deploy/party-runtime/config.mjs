import { createHmac, randomBytes } from 'node:crypto';

export function makePartyConfig(secret, publicIp, now = Date.now()) {
  if (!secret || secret.length < 32) throw new Error('A private TURN secret is required');
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(publicIp)) throw new Error('A public IPv4 address is required');
  const expires = Math.floor(now / 1000) + 3600;
  const username = `${expires}:${randomBytes(8).toString('hex')}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return {
    expiresAt: expires * 1000,
    peerServer: { host: 'rich4-staging.gopeaks.club', port: 443, path: '/peerjs', secure: true },
    iceServers: [
      { urls: `stun:${publicIp}:3478` },
      { urls: [`turn:${publicIp}:3478?transport=udp`, `turn:${publicIp}:3478?transport=tcp`], username, credential },
    ],
  };
}
