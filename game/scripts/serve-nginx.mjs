// Isolated loopback production fixture for benchmarks; no credentials or private
// art are copied, and only sanitized per-request transfer data is logged.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const port = Number(process.env.E2E_NGINX_PORT || 5189);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid E2E_NGINX_PORT');
const temp = mkdtempSync(join(tmpdir(), 'rich4-benchmark-nginx-'));
mkdirSync(join(temp, 'logs'));
symlinkSync(resolve(process.env.E2E_DIST_DIR || 'dist'), join(temp, 'rich4'));
const log = process.env.E2E_ORIGIN_LOG || join(temp, 'origin.jsonl');
writeFileSync(log, '');
const snippet = readFileSync(resolve('../deploy/nginx-rich4.conf'), 'utf8').replaceAll('/srv/www/apps', temp);
const config = join(temp, 'nginx.conf');
writeFileSync(config, `pid ${temp}/nginx.pid; error_log stderr warn;
events {} http {
  include ${process.env.NGINX_MIME_TYPES || '/etc/nginx/mime.types'};
  log_format transfer escape=json '{"path":"$uri","status":$status,"bytesSent":$bytes_sent}';
  access_log ${log} transfer;
  gzip on; gzip_vary on; gzip_min_length 1024;
  gzip_types text/css application/json application/javascript application/manifest+json image/svg+xml;
  server { listen 127.0.0.1:${port}; ${snippet} }
}`);
const child = spawn(process.env.NGINX_BIN || 'nginx', ['-p', `${temp}/`, '-c', config, '-g', 'daemon off;'], { stdio: 'inherit' });
console.log(`Loopback fixture: http://127.0.0.1:${port}/rich4/\nSanitized origin log: ${log}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { rmSync(temp, { recursive: true, force: true }); process.exitCode = code || 0; });
