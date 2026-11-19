import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../../src/server/server.js';
import { fastClock, host, join, type Client } from '../bot.js';
import { seeded } from '../helpers.js';
import { marketBot, type Crew } from './market-bot.js';

const speed = 8;
async function run(teams: number, trial: number) {
  const clock = fastClock(speed);
  const app = await startServer({ host: '127.0.0.1', port: 0, publicDir: resolve('dist/public'),
    speed, now: clock, rng: seeded(trial), log: () => {} });
  const players: Client[] = [];
  const rows = [];
  try {
    const h = await host(app.url);
    for (let i = 0; i < teams * 4; i += 16) {
      const batch = Array.from({ length: Math.min(16, teams * 4 - i) }, (_, j) => join(app.url, h.creds!.code, 'Crew ' + (i + j), undefined, false));
      players.push(...await Promise.all(batch));
    }
    h.act({ a: 'makeTeams' });
    await h.until(() => h.hv.phase === 'teams');
    assert.equal(h.hv.teams.length, teams);
    assert.equal(h.hv.settings.income, 10);
    assert.equal(h.hv.settings.minutes, 4);
    for (let round = 1; round <= 2; round++) {
      const crews = new Map<string, Crew>(h.hv.teams.map(t => [t.id, { team: t.id, rocketAttempts: 0, rocketFailures: 0 }]));
      h.act({ a: 'startRound' });
      await Promise.all(players.map(p => p.until(() => p.view?.phase === 'play' && p.view.round === round)));
      const end = players[0]!.pv.endsAt!;
      const start = end - 240_000;
      const bots = players.map(p => {
        const team = p.pv.team!.id;
        return marketBot(p, crews.get(team)!, Number(team.slice(1)) + trial + round - 3, clock);
      });
      while (h.hv.phase === 'play') {
        if (clock() > end + 15_000) throw new Error('Server did not close the mission');
        for (const bot of bots) bot.step();
        await delay(25);
      }
      await Promise.all(players.map(p => p.until(() => p.view?.phase === 'results')));
      for (const b of bots) { b.observe(); assert.deepEqual(b.unexpected, []); }
      const outcomes = h.hv.results[round - 1]!.outcomes;
      assert.equal(outcomes.length, teams);
      for (const result of outcomes) {
        const c = crews.get(result.team)!;
        assert.equal(c.rocketAttempts, c.rocketFailures + Number(Boolean(result.rocket)), 'unaccounted rocket attempt');
        const picks = app.games.get(h.creds!.code)!.picks[result.team + '|' + round];
        assert.equal(c.firstFuel !== undefined, (picks?.fuelGrabs ?? 0) > 0, 'unobserved fuel purchase');
        const since = (at?: number) => at === undefined ? null : at - start;
        const wait = (from?: number) => from === undefined ? null : (c.firstFuel ?? end) - from;
        rows.push({ trial, teams, round, team: c.team, openingFuel: c.openingStock, readyMs: since(c.ready),
          attemptMs: since(c.firstAttempt), firstFuelMs: since(c.firstFuel), waitFromReadyMs: wait(c.ready),
          waitFromAttemptMs: wait(c.firstAttempt), rocketAttempts: c.rocketAttempts, rocketFailures: c.rocketFailures,
          boughtAnimal: Boolean(result.animal), boughtRocket: Boolean(result.rocket),
          fuelSent: result.fuel, fuelNeeded: result.rocket?.fuel ?? null, landed: result.status === 'landed' });
      }
    }
    console.log('Completed trial %d with %d teams', trial, teams);
    return rows;
  } finally { await app.close(); }
}

const rows = [];
for (const trial of [1, 2, 3]) for (const teams of [2, 25, 50]) rows.push(...await run(teams, trial));
for (const teams of [2, 25, 50]) {
  for (const round of [1, 2]) {
    const group = rows.filter(r => r.teams === teams && r.round === round);
    const longWait = group.filter(r => r.waitFromAttemptMs !== null && r.waitFromAttemptMs > 60_000);
    console.log(JSON.stringify({ teams, round, observations: group.length,
      landed: group.filter(r => r.landed).length, rocketFailures: group.reduce((n, r) => n + r.rocketFailures, 0),
      rocketAttempts: group.reduce((n, r) => n + r.rocketAttempts, 0),
      firstFuelOver60s: longWait.length, noFuelAttempt: group.filter(r => r.attemptMs === null).length,
      attemptedWithoutPurchase: group.filter(r => r.attemptMs !== null && r.firstFuelMs === null).length }));
  }
}
const json = JSON.stringify(rows);
if (process.env.MARKET_REPORT) await writeFile(process.env.MARKET_REPORT, json + '\n');
else console.log(json);
