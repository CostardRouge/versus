/**
 * The server the end-to-end tests run against (`npm run e2e` starts it through playwright.config.ts): the app built
 * as the Worker serves it (`--mode worker`: publishing on, the service worker registered), then the real Worker in
 * Wrangler's local runtime with a fresh D1 registry, R2 bucket and boards, on E2E_PORT.
 *
 * Its settings are the tests': the admin token, pictures through review, and notification keys made for this run
 * (nothing is sent: the browsers here can't reach a push service).
 */

import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { E2E_ADMIN, E2E_PORT } from './env.ts';

const CONFIG = ['-c', 'worker/wrangler.jsonc'];
// The tools themselves, not through npx: stopping this script must stop them.
const bin = (name: string): string => `node_modules/.bin/${name}`;
const STATE = '.wrangler/e2e';

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', key.publicKey)).toString('base64url');
const priv = (await crypto.subtle.exportKey('jwk', key.privateKey)).d ?? '';

run(bin('vite'), ['build', '--mode', 'worker', '--logLevel', 'warn']);
rmSync(STATE, { recursive: true, force: true });
run(bin('wrangler'), ['d1', 'migrations', 'apply', 'versus-registry', '--local', '--persist-to', STATE, ...CONFIG]);
const vars = { ADMIN_TOKEN: E2E_ADMIN, IMAGES_UPLOAD: 'review', VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv };
const dev = spawn(
  bin('wrangler'),
  [
    'dev',
    ...CONFIG,
    '--port',
    String(E2E_PORT),
    '--persist-to',
    STATE,
    '--show-interactive-dev-session=false',
    '--log-level',
    'error',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ],
  { stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
