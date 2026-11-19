import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../src/server/server.js';
import { fastClock, host, join } from '../bot.js';

test('a human Captain and three socket bots land a cat on the default budget', async () => {
  const app = await startServer({
    port: 0,
    host: '127.0.0.1',
    publicDir: 'dist/public',
    rng: () => 0.999,
    speed: 20,
    now: fastClock(20),
    log: () => {},
  });
  try {
    const h = await host(app.url),
      code = h.hv.code;
    const human = await join(app.url, code, 'Alex');
    human.act({ a: 'setBots', enabled: true });
    await human.until(() => human.errors.some(e => e.includes('Only the host')));
    h.act({ a: 'setBots', enabled: true });
    h.act({ a: 'addBots', count: 'fill', teamSize: 4 });
    await h.until(() => h.hv.players.length === 4);
    h.act({ a: 'setBots', enabled: false });
    await h.until(() => h.hv.players.length === 1);
    h.act({ a: 'setBots', enabled: true });
    h.act({ a: 'addBots', count: 3, teamSize: 4 });
    h.act({ a: 'makeTeams' });
    await h.until(() => h.hv.phase === 'teams');
    h.act({ a: 'startRound' });
    await human.until(() => human.pv.phase === 'play');
    assert.deepEqual(human.pv.team!.roles, ['captain']);
    for (const [to, amount] of [
      ['vet', 4],
      ['pilot', 4],
      ['engineer', 2],
    ] as const)
      human.act({ a: 'transfer', from: 'captain', to, amount });
    await human.until(() => !!human.pv.team?.status.fuel, 10000);
    human.act({ a: 'launch' });
    await h.until(() => h.hv.stats.launched === 1, 11000);
    h.act({ a: 'endRound' });
    h.act({ a: 'finish' });
    await h.until(() => h.hv.phase === 'final');
    assert.equal(h.hv.results[0]!.outcomes[0]!.status, 'landed');
    assert.equal(h.hv.final!.byRound[0]!.bots!.length, 3);
  } finally {
    await app.close();
  }
});
