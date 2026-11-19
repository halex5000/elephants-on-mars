import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
// dist/server/index.js -> dist/public ; src/server/index.ts (tsx) -> dist/public too
const publicDir = process.env.PUBLIC_DIR ?? resolve(here, '../../dist/public');

// GAME_SPEED > 1 fast-forwards the game clock (timers, fuel pool, auctions) for demos and tests.
const speed = Math.max(1, Number(process.env.GAME_SPEED ?? 1) || 1);
const startedAt = Date.now();
const now = speed === 1 ? Date.now : () => startedAt + (Date.now() - startedAt) * speed;
if (speed !== 1) console.log(JSON.stringify({ t: new Date().toISOString(), event: 'game_speed', speed }));

const app = await startServer({
  now, speed,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  publicDir,
  stateFile: process.env.STATE_FILE,
  extraListingMinTeams: process.env.EXTRA_LISTING_MIN_TEAMS ? Number(process.env.EXTRA_LISTING_MIN_TEAMS) : undefined,
  maxGames: Number(process.env.MAX_GAMES ?? 200),
  hostPasscode: process.env.HOST_PASSCODE,
});
console.log(JSON.stringify({ t: new Date().toISOString(), event: 'host_passcode', required: Boolean(process.env.HOST_PASSCODE?.trim()) }));

let stopping = false;
const shutdown = (sig: string) => {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ t: new Date().toISOString(), event: 'shutdown', sig }));
  app.close().then(() => process.exit(0)).catch(err => { console.error('Shutdown failed', err); process.exit(1); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
