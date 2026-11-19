// The hidden-information contract. If one of these fails, a role can see
// something it should only learn by talking to a teammate.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/server/engine.js';
import { hostView, playerView } from '../../src/server/views.js';
import { ANIMALS, ROCKETS } from '../../src/server/catalog.js';
import { ROLES, type Role } from '../../src/shared/protocol.js';
import { started, setup, seeded, holder, fund, mission, T0, SETTLED } from '../helpers.js';

const pres = { isConnected: () => true };
const json = (v: unknown) => JSON.stringify(v);

// Animal objects carry emoji right before size; rocket objects carry their name right before size.
const secrets = {
  animalSize: () => [/"emoji":"[^"]+","size":/],
  rocketSize: () => ROCKETS.map(r => new RegExp(`"name":"${r.name}","size":`)),
  rocketFuel: () => ROCKETS.map(r => new RegExp(`"fuel":${r.fuel}[,}]`)),
  points: () => [/"points":\d+,"base"/],
};
// What each role must NOT see during a mission.
const forbidden: Record<Role, (keyof typeof secrets)[]> = {
  captain: ['animalSize', 'rocketSize', 'rocketFuel', 'points'],
  vet: ['rocketSize', 'rocketFuel'],
  pilot: ['animalSize', 'points'],
  engineer: ['animalSize', 'rocketSize', 'rocketFuel', 'points'],
};

function midMission() {
  const g = started(8);
  for (const t of [0, 1]) fund(g, t, { vet: 30, pilot: 30, engineer: 30 });
  mission(g, 0, { animal: 'elephant', rocket: 'titan', launch: false });
  mission(g, 1, { animal: 'giraffe', rocket: 'heavy', launch: false }, T0 + SETTLED + 1);
  return g;
}

describe('hidden information', () => {
  for (const role of ROLES) {
    test(`${role} sees none of the other roles' secrets mid-mission`, () => {
      const g = midMission();
      const v = json(playerView(g, holder(g, 0, role), T0 + 1));
      for (const s of forbidden[role]) for (const re of secrets[s]()) assert.doesNotMatch(v, re, `${role} leaked ${s} (${re})`);
    });
  }

  test('positive control: every leak pattern matches the role that is allowed to see it', () => {
    const g = midMission();
    const v = (r: Role) => json(playerView(g, holder(g, 0, r), T0 + 1));
    for (const re of secrets.animalSize()) assert.match(v('vet'), re);
    assert.ok(secrets.rocketSize().some(re => re.test(v('pilot'))));
    assert.ok(secrets.rocketFuel().some(re => re.test(v('pilot'))));
    for (const re of secrets.points()) assert.match(v('vet'), re);
  });

  test('each role sees its own secret', () => {
    const g = midMission();
    const c = (r: Role) => playerView(g, holder(g, 0, r), T0 + 1).console!;
    assert.equal(c('vet').vet!.animals.find(a => a.id === 'elephant')!.size, 'XL');
    assert.equal(c('pilot').pilot!.rockets.find(r => r.id === 'titan')!.size, 'XL');
    assert.equal(c('pilot').pilot!.rockets.find(r => r.id === 'titan')!.fuel, 80);
    assert.ok(c('engineer').engineer!.market.ratePerSec > 0);
    assert.equal(c('engineer').engineer!.sendStep, 10);
    assert.equal(c('captain').captain!.picks.rocket, 'Titan');
  });

  test('a player only gets consoles for roles they hold; doubled-up players get both', () => {
    const g = midMission();
    assert.deepEqual(Object.keys(playerView(g, holder(g, 0, 'pilot'), T0 + 1).console!), ['pilot']);
    const g2 = setup(2);
    E.startRound(g2, T0, seeded());
    assert.equal(Object.keys(playerView(g2, g2.teams[0]!.members[0]!.playerId, T0).console!).length, 2);
  });

  test('the public feed names what was bought but never sizes, capacities or fuel needs', () => {
    const g = midMission();
    const v = playerView(g, holder(g, 1, 'engineer'), T0 + SETTLED + 2);
    assert.ok(
      v.feed.some(f => /Elephant/.test(f.text)),
      'feed is public, like the big screen',
    );
    for (const s of Object.keys(secrets) as (keyof typeof secrets)[]) for (const re of secrets[s]()) assert.doesNotMatch(json(v.feed), re);
  });

  test('host big screen: progress, feed and fuel pool, but no secrets', () => {
    const g = midMission();
    const v = hostView(g, T0 + 1, pres);
    assert.ok(v.fuel);
    for (const s of Object.keys(secrets) as (keyof typeof secrets)[])
      for (const re of secrets[s]()) assert.doesNotMatch(json(v), re, `host leaked ${s}`);
  });

  test('tokens never appear in any view', () => {
    const g = midMission();
    const all = json(hostView(g, T0, pres)) + g.players.map(p => json(playerView(g, p.id, T0))).join('');
    assert.doesNotMatch(all, /host-token|"token"|tok\d/);
  });

  test('consoles and the feed disappear outside a mission', () => {
    const g = midMission();
    E.endRound(g);
    for (const p of g.players) {
      const v = playerView(g, p.id, T0);
      assert.equal(v.console, undefined);
      assert.equal(v.feed.length, 0);
    }
  });

  test('results reveal everything, for finished missions only', () => {
    const g = midMission();
    E.endRound(g);
    const v = playerView(g, holder(g, 1, 'pilot'), T0);
    assert.equal(v.results.length, 1);
    assert.equal(v.results[0]!.outcomes.find(o => o.team === g.teams[0]!.id)!.animal!.size, 'XL');
  });

  test('the fuel status light only turns on once enough fuel is on board for the rocket', () => {
    const g = midMission(); // team 1: giraffe + heavy (needs 55)
    const st = () => hostView(g, T0, pres).teams[1]!.status.fuel;
    E.buyFuel(g, holder(g, 1, 'engineer'), 1, T0 + SETTLED + 60_000);
    E.sendFuel(g, holder(g, 1, 'engineer'), T0 + SETTLED + 60_001);
    assert.equal(st(), false, '10 of 55');
    for (let i = 0; i < 5; i++) E.sendFuel(g, holder(g, 1, 'engineer'), T0 + SETTLED + 60_002);
    assert.equal(st(), true, '60 of 55');
  });

  test('final report lists the animals each team landed', () => {
    const g = started(4, { rounds: 1 });
    fund(g, 0, { vet: 30, pilot: 30, engineer: 30 });
    mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
    E.endRound(g);
    E.finish(g);
    assert.deepEqual(hostView(g, T0, pres).final!.byRound[0]!.landed, [{ name: 'Cat', emoji: '🐈' }]);
  });

  test('every animal and rocket is offered to its role', () => {
    const g = midMission();
    assert.equal(playerView(g, holder(g, 0, 'vet'), T0).console!.vet!.animals.length, ANIMALS.length);
    assert.equal(playerView(g, holder(g, 0, 'pilot'), T0).console!.pilot!.rockets.length, ROCKETS.length);
  });

  test('terraforming progress is shared with everyone after each mission', () => {
    const g = started(4, { rounds: 2 });
    fund(g, 0, { vet: 30, pilot: 30, engineer: 30 });
    mission(g, 0, { animal: 'giraffe', rocket: 'heavy', fuel: 55 });
    E.endRound(g);
    const v = playerView(g, holder(g, 0, 'vet'), T0);
    assert.equal(v.terraform.points, 40);
    assert.ok(v.terraform.pct > 0);
    assert.deepEqual(
      v.terraform.species.map(s => s.name),
      ['Giraffe'],
    );
  });
});
