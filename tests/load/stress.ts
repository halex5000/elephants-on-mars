// Load test: one big game (default 200 players = 50 teams) plus several small
// games at once, all bots playing full missions. Fails if anything doesn't land
// or the server is too slow to fan out updates.
//   npm run test:load            (spins up its own server)
//   LOAD_URL=http://host:3000 npm run test:load   (hit a running server)
//   PLAYERS=300 GAMES=10 npm run test:load
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { startServer } from '../../src/server/server.js';
import { host, join, playBot, fastClock, type Radio, type Client } from '../bot.js';

const PLAYERS = Number(process.env.PLAYERS ?? 200);
const SIDE_GAMES = Number(process.env.GAMES ?? 5);
const SIDE_SIZE = 12;
const ROUNDS = 2;
const MAX_LAUNCH_MS = Number(process.env.MAX_LAUNCH_MS ?? 30000);
// In-process runs fast-forward the game clock so the fuel pool fills in seconds, not minutes.
const clock = process.env.LOAD_URL ? Date.now : fastClock(20);

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/public');
const own = process.env.LOAD_URL ? null : await startServer({ port: 0, host: '127.0.0.1', publicDir, log: () => {}, now: clock, speed: process.env.LOAD_URL ? 1 : 20 });
const url = process.env.LOAD_URL ?? own!.url;
const plans = ['giraffe', 'croc', 'cat', 'rabbit', 'kangaroo', 'penguin', 'gorilla', 'rhino', 'hippo', 'cat'];

async function runGame(n: number, label: string) {
  const radios = new Map<string, Radio>();
  const h = await host(url);
  const code = h.creds!.code;
  const t0 = performance.now();
  const players: Client[] = [];
  for (let i = 0; i < n; i += 25) players.push(...await Promise.all(Array.from({ length: Math.min(25, n - i) }, (_, k) => join(url, code, `Bot ${i + k}`, playBot(radios, (r, ti) => plans[(r + ti) % plans.length]!, { clock }), false))));
  await h.until(() => h.hv.players.length === n, 20000, 'all joined');
  const joinMs = performance.now() - t0;
  h.act({ a: 'makeTeams', settings: { rounds: ROUNDS, minutes: 10, income: 40 } });
  await h.until(() => h.hv.phase === 'teams', 10000, 'teams');
  const launchTimes: number[] = [];
  let landed = 0, total = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    const s = performance.now();
    h.act({ a: 'startRound' });
    await h.until(() => h.hv.phase === 'play' && h.hv.teams.every(t => t.status.launched), MAX_LAUNCH_MS * 2, `${label} r${r} all launched`);
    launchTimes.push(performance.now() - s);
    h.act({ a: 'endRound' });
    await h.until(() => h.hv.phase === 'results' && h.hv.results.length === r, 10000, 'results');
    for (const o of h.hv.results[r - 1]!.outcomes) { total++; if (o.status === 'landed') landed++; }
  }
  h.act({ a: 'finish' });
  await h.until(() => h.hv.phase === 'final', 10000, 'final');
  // Market collisions are the game working as designed (two teams went for the same thing), not failures.
  const MARKET = /Price jumped|just took the fuel|pool is empty/;
  const all = players.flatMap(p => p.errors);
  const collisions = all.filter(e => MARKET.test(e)).length;
  const errors = all.filter(e => !MARKET.test(e) && !/Slow down/.test(e));
  players.forEach(p => p.close()); h.close();
  return { label, players: n, teams: total / ROUNDS, joinMs: Math.round(joinMs), launchMs: launchTimes.map(Math.round), landed, total, errors, collisions };
}

const started = performance.now();
const results = await Promise.all([runGame(PLAYERS, 'big'), ...Array.from({ length: SIDE_GAMES }, (_, i) => runGame(SIDE_SIZE, `side${i + 1}`))]);
const mem = process.memoryUsage();
console.table(results.map(r => ({ game: r.label, players: r.players, teams: r.teams, 'join ms': r.joinMs, 'all launched ms': r.launchMs.join(' / '), landed: `${r.landed}/${r.total}`, 'market collisions': r.collisions, errors: r.errors.length })));
console.log(`total ${Math.round(performance.now() - started)} ms, ${PLAYERS + SIDE_GAMES * SIDE_SIZE} players, rss ${Math.round(mem.rss / 1e6)} MB${own ? ' (server in-process)' : ''}`);

const problems = results.flatMap(r => [
  ...(r.landed !== r.total ? [`${r.label}: only ${r.landed}/${r.total} landed`] : []),
  ...(r.errors.length ? [`${r.label}: ${r.errors.length} errors, e.g. ${r.errors[0]}`] : []),
  ...r.launchMs.filter(ms => ms > MAX_LAUNCH_MS).map(ms => `${r.label}: a round took ${Math.round(ms)} ms to fully launch`),
]);
await own?.close();
if (problems.length) { console.error(`LOAD TEST FAILED\n${problems.join('\n')}`); process.exit(1); }
console.log('LOAD TEST PASSED');
