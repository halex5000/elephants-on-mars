// Real server, real WebSockets, bot players.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../../src/server/server.js';
import { Client, host, join, playBot, fastClock, type Radio } from '../bot.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/public');
let app: Awaited<ReturnType<typeof startServer>>;
// Fuel takes minutes to build up in real games; run the game clock 20x so tests take seconds.
const clock = fastClock(20);
const bot = (radios: Map<string, Radio>, pick?: (r: number, t: number) => string, extra: Parameters<typeof playBot>[2] = {}) => playBot(radios, pick, { clock, ...extra });
const RICH = { income: 40 };
const quiet = () => {};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

before(async () => { app = await startServer({ port: 0, host: '127.0.0.1', publicDir, log: quiet, now: clock, speed: 20 }); });
after(async () => { await app.close(); });

async function lobby(n: number, onView?: (i: number) => ((c: Client) => void) | undefined) {
  const h = await host(app.url);
  const code = h.creds!.code;
  const players = await Promise.all(Array.from({ length: n }, (_, i) => join(app.url, code, `Bot ${i}`, onView?.(i))));
  await h.until(() => h.hv.players.length === n, 5000, 'all joined');
  return { h, code, players };
}
const closeAll = (...cs: Client[]) => cs.forEach(c => c.close());

describe('full game over WebSockets', () => {
  test('8 bots play 3 missions; every rocket lands; final debrief names a winner', async () => {
    const radios = new Map<string, Radio>();
    const plan = ['giraffe', 'croc', 'cat'];
    const { h, players } = await lobby(8, () => bot(radios, r => plan[r - 1]!));
    h.act({ a: 'makeTeams', settings: { rounds: 3, minutes: 4, ...RICH } });
    await h.until(() => h.hv.phase === 'teams', 5000, 'teams');
    assert.equal(h.hv.teams.length, 2);
    for (let r = 1; r <= 3; r++) {
      h.act({ a: 'startRound' });
      await h.until(() => h.hv.phase === 'play' && h.hv.round === r, 5000, `round ${r}`);
      await h.until(() => h.hv.teams.every(t => t.status.launched), 20000, `all launched r${r}`);
      h.act({ a: 'endRound' });
      await h.until(() => h.hv.phase === 'results', 5000, 'results');
      for (const o of h.hv.results[r - 1]!.outcomes) assert.equal(o.status, 'landed', `${o.teamName} r${r}: ${o.message}`);
    }
    h.act({ a: 'finish' });
    await h.until(() => h.hv.phase === 'final', 5000, 'final');
    assert.ok(h.hv.final!.winner);
    assert.equal(h.hv.final!.failed, 0);
    // players see the same final
    await players[0]!.until(() => players[0]!.pv.phase === 'final', 5000, 'player final');
    assert.deepEqual(players[0]!.pv.standings, h.hv.standings);
    closeAll(h, ...players);
  });

  test('a Pilot who ignores the Vet: every rocket fails over the wire', async () => {
    const radios = new Map<string, Radio>();
    const { h, players } = await lobby(4, () => bot(radios, () => 'hippo', { tinyRocket: true }));
    h.act({ a: 'makeTeams', settings: { rounds: 1, ...RICH } }); await h.until(() => h.hv.phase === 'teams');
    h.act({ a: 'startRound' }); await h.until(() => h.hv.teams.every(t => t.status.launched), 20000, 'launched');
    h.act({ a: 'endRound' }); await h.until(() => h.hv.phase === 'results');
    assert.equal(h.hv.results[0]!.outcomes[0]!.status, 'failed');
    assert.match(h.hv.results[0]!.outcomes[0]!.message, /didn't fit/);
    closeAll(h, ...players);
  });

  test('roles reshuffle between missions over the wire', async () => {
    const radios = new Map<string, Radio>();
    const { h, players } = await lobby(4, () => bot(radios));
    h.act({ a: 'makeTeams', settings: { rounds: 2, ...RICH } }); await h.until(() => h.hv.phase === 'teams');
    h.act({ a: 'startRound' }); await h.until(() => h.hv.phase === 'play');
    await Promise.all(players.map(p => p.until(() => p.pv.phase === 'play')));
    const before = players.map(p => p.pv.team!.roles.join());
    h.act({ a: 'endRound' }); await h.until(() => h.hv.phase === 'results');
    h.act({ a: 'startRound' }); await h.until(() => h.hv.phase === 'play' && h.hv.round === 2);
    await Promise.all(players.map(p => p.until(() => p.pv.round === 2)));
    const after = players.map(p => p.pv.team!.roles.join());
    assert.ok(after.every((r, i) => r !== before[i]), `${before} -> ${after}`);
    closeAll(h, ...players);
  });

  test('teams of 2 and 3 (doubled-up roles) can still finish a mission', async () => {
    for (const n of [1, 2, 3]) {
      const radios = new Map<string, Radio>();
      const { h, players } = await lobby(n, () => bot(radios));
      h.act({ a: 'makeTeams', settings: { rounds: 1, ...RICH } }); await h.until(() => h.hv.phase === 'teams');
      h.act({ a: 'startRound' }); await h.until(() => h.hv.teams.every(t => t.status.launched), 20000, `launched n=${n}`);
      h.act({ a: 'endRound' }); await h.until(() => h.hv.phase === 'results');
      assert.equal(h.hv.results[0]!.outcomes[0]!.status, 'landed', `n=${n}`);
      closeAll(h, ...players);
    }
  });
});

describe('hidden information on the wire', () => {
  test('only Vets ever receive animal sizes; only Pilots ever receive rocket sizes and fuel needs', async () => {
    const radios = new Map<string, Radio>();
    const { h, players } = await lobby(8, () => bot(radios, () => 'giraffe'));
    h.act({ a: 'makeTeams', settings: { rounds: 1, ...RICH } }); await h.until(() => h.hv.phase === 'teams');
    players.forEach(p => (p.raw = []));
    h.act({ a: 'startRound' }); await h.until(() => h.hv.teams.every(t => t.status.launched), 20000, 'launched');
    let checked = 0;
    for (const p of players) {
      const roles = p.pv.team!.roles;
      for (const m of p.raw) {
        if (!roles.includes('vet')) assert.doesNotMatch(m, /"emoji":"[^"]+","size":/, `${roles} got an animal size`);
        if (!roles.includes('pilot')) assert.doesNotMatch(m, /"fuel":\d+,"base"/, `${roles} got a rocket's fuel need`);
        checked++;
      }
    }
    assert.ok(checked > 10, 'actually inspected messages');
    assert.ok(h.raw.every(m => !/"size":|"fuel":\d+,"base"/.test(m)), 'host got a secret');
    closeAll(h, ...players);
  });
});

describe('auth and abuse', () => {
  test('bad host token, bad resume token, bad code', async () => {
    const h = await host(app.url);
    const x = new Client(app.url); await x.opened;
    x.send({ t: 'host', code: h.creds!.code, hostToken: 'nope' });
    await x.until(() => x.errors.length > 0); assert.match(x.errors[0]!, /host link/);
    x.send({ t: 'resume', code: h.creds!.code, playerId: 'p_fake', token: 'nope' });
    await x.until(() => x.errors.length > 1); assert.match(x.errors[1]!, /Join again/);
    x.send({ t: 'join', code: 'ZZZZ', name: 'Lost' });
    await x.until(() => x.errors.length > 2); assert.match(x.errors[2]!, /No game with that code/);
    closeAll(h, x);
  });

  test('players cannot use host actions; unjoined sockets cannot act', async () => {
    const { h, players } = await lobby(1);
    const p = players[0]!;
    for (const a of ['makeTeams', 'startRound', 'endRound', 'finish', 'newGame', 'seatLatecomers'] as const) p.act({ a } as never);
    await p.until(() => p.errors.length >= 6);
    assert.ok(p.errors.every(e => /Only the host/.test(e)), p.errors.join(','));
    const x = new Client(app.url); await x.opened; x.act({ a: 'launch' });
    await x.until(() => x.errors.length > 0); assert.match(x.errors[0]!, /Join a game first/);
    assert.equal(h.hv.phase, 'lobby');
    closeAll(h, p, x);
  });

  test('a player cannot act for a role they do not hold', async () => {
    const { h, players } = await lobby(8);
    h.act({ a: 'makeTeams' }); await h.until(() => h.hv.phase === 'teams');
    h.act({ a: 'startRound' }); await h.until(() => h.hv.phase === 'play');
    await Promise.all(players.map(p => p.until(() => p.pv.phase === 'play')));
    const pilot = players.find(p => p.pv.team!.roles.includes('pilot') && p.pv.team!.roles.length === 1)!;
    pilot.act({ a: 'launch' }); pilot.act({ a: 'transfer', from: 'captain', to: 'pilot', amount: 2000 });
    await pilot.until(() => pilot.errors.length >= 2);
    assert.match(pilot.errors[0]!, /Only the captain/); assert.match(pilot.errors[1]!, /Only the captain/);
    closeAll(h, ...players);
  });

  test('malformed JSON, unknown messages and floods get errors; server survives', async () => {
    const x = new Client(app.url); await x.opened;
    x.ws.send('{not json'); x.send({ t: 'nonsense' } as never);
    await x.until(() => x.errors.length >= 2);
    assert.deepEqual(x.errors.slice(0, 2), ['Bad message.', 'Unknown message.']);
    for (let i = 0; i < 40; i++) x.send({ t: 'ping' });
    await x.until(() => x.errors.includes('Slow down a little.'), 3000, 'rate limit');
    x.close();
    const res = await fetch(app.url + '/healthz'); assert.equal(res.status, 200);
  });

  test('oversized message closes only that connection', async () => {
    const x = new Client(app.url); await x.opened;
    x.ws.send('x'.repeat(10_000));
    await x.until(() => x.closed, 3000, 'closed');
    const y = new Client(app.url); await y.opened; y.send({ t: 'ping' });
    await y.until(() => y.raw.some(m => m.includes('pong'))); y.close();
  });
});

describe('host passcode (public deploys)', () => {
  const PASS = 'tusk-and-thrust';
  let locked: Awaited<ReturnType<typeof startServer>>;
  before(async () => { locked = await startServer({ port: 0, host: '127.0.0.1', publicDir, log: quiet, now: clock, speed: 20, hostPasscode: PASS }); });
  after(async () => { await locked.close(); });
  const lastError = (c: Client) => [...c.raw].reverse().map(r => JSON.parse(r)).find(m => m.t === 'error');

  test('no passcode or a wrong one creates nothing; the right one works; players never need it', async () => {
    const c = new Client(locked.url); await c.opened;
    c.send({ t: 'create' });
    await c.until(() => c.errors.length === 1, 2000, 'missing passcode error');
    assert.equal(lastError(c).needPasscode, true);
    c.send({ t: 'create', passcode: 'nope' });
    await c.until(() => c.errors.length === 2, 2000, 'wrong passcode error');
    assert.match(c.errors[1]!, /isn't right/);
    assert.equal(locked.games.size, 0);
    c.send({ t: 'create', passcode: ` ${PASS} ` });
    await c.until(() => c.view?.kind === 'host', 2000, 'created');
    assert.equal(locked.games.size, 1);
    const p = await join(locked.url, c.creds!.code, 'Player');
    assert.equal(p.view?.kind, 'player');
    closeAll(c, p);
  });

  test('guessing is throttled server-wide, even across new connections', async () => {
    for (let i = 0; i < 4; i++) {
      const c = new Client(locked.url); await c.opened;
      for (let j = 0; j < 5; j++) c.send({ t: 'create', passcode: `guess-${i}-${j}` });
      await c.until(() => c.errors.length === 5, 2000, 'guesses rejected');
      c.close();
    }
    const c = new Client(locked.url); await c.opened;
    c.send({ t: 'create', passcode: PASS });
    await c.until(() => c.errors.length === 1, 2000, 'throttled');
    assert.match(c.errors[0]!, /Too many wrong passcodes/);
    c.close();
  });

  test('a server without a passcode stays open (local dev, internal deploy)', async () => {
    const h = await host(app.url);
    assert.ok(h.creds?.hostToken);
    h.close();
  });
});

describe('connections', () => {
  test('refresh/reconnect keeps your team and role; host sees offline then online', async () => {
    const { h, code, players } = await lobby(4);
    h.act({ a: 'makeTeams' }); await h.until(() => h.hv.phase === 'teams');
    const p = players[0]!; await p.until(() => !!p.pv.team);
    const before = p.pv.team!;
    const creds = p.creds!;
    p.close();
    await h.until(() => h.hv.players.some(x => !x.connected), 3000, 'offline');
    const back = new Client(app.url); await back.opened;
    back.send({ t: 'resume', code, playerId: creds.playerId!, token: creds.token! });
    await back.until(() => back.view?.kind === 'player' && !!back.pv.team);
    assert.equal(back.pv.team!.id, before.id); assert.deepEqual(back.pv.team!.roles, before.roles);
    await h.until(() => h.hv.players.every(x => x.connected), 3000, 'online');
    closeAll(h, back, ...players.slice(1));
  });

  test('host can reconnect with the host token', async () => {
    const h = await host(app.url); const { code, hostToken } = h.creds!; h.close();
    const h2 = new Client(app.url); await h2.opened; h2.send({ t: 'host', code, hostToken: hostToken! });
    await h2.until(() => h2.view?.kind === 'host'); h2.close();
  });

  test('timer runs out → server ends the mission by itself', async () => {
    const { h, players } = await lobby(4);
    h.act({ a: 'makeTeams' }); await h.until(() => h.hv.phase === 'teams');
    h.act({ a: 'startRound' }); await h.until(() => h.hv.phase === 'play');
    const g = app.games.get(h.creds!.code)!;
    g.endsAt = clock() + 1_000; // the server waits ~1.25 s real before checking; by then the fast clock is well past it
    h.act({ a: 'addTime', seconds: 1 }); // any action reschedules the timer
    await h.until(() => h.hv.phase === 'results', 4000, 'auto end');
    closeAll(h, ...players);
  });

  test('two games on one server stay separate', async () => {
    const a = await lobby(2), b = await lobby(3);
    assert.notEqual(a.code, b.code);
    assert.equal(a.h.hv.players.length, 2); assert.equal(b.h.hv.players.length, 3);
    closeAll(a.h, b.h, ...a.players, ...b.players);
  });
});

describe('http', () => {
  test('healthz, app routes, security headers, no path traversal', async () => {
    const hz = await (await fetch(app.url + '/healthz')).json() as { ok: boolean };
    assert.equal(hz.ok, true);
    for (const p of ['/', '/host/ABCD', '/play/ABCD', '/join/ABCD']) {
      const r = await fetch(app.url + p); assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    }
    assert.equal((await fetch(app.url + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    const trav = await fetch(app.url + '/..%2f..%2fpackage.json'); assert.ok([403, 404].includes(trav.status), String(trav.status));
    assert.equal((await fetch(app.url + '/nope.js')).status, 404);
    assert.equal((await fetch(app.url + '/', { method: 'POST' })).status, 405);
  });

  test('websocket only on /ws', async () => {
    const ws = new WebSocket(app.url.replace('http', 'ws') + '/elsewhere');
    await new Promise<void>(res => { ws.on('error', () => res()); ws.on('close', () => res()); });
    await sleep(10);
  });
});
