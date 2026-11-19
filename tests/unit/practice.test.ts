import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/server/engine.js';
import { playerView } from '../../src/server/views.js';

test('practice seats respect the room cap and only see their assigned consoles', () => {
  const g = E.createGame('MARS', 'host', 0);
  E.addPlayer(g, 'human', 'secret', 'Alex', 0);
  let serial = 0;
  const add = (count: number | 'fill') => E.addPracticeBots(g, count, 4, 0, () => String(++serial));
  assert.throws(() => add('fill'));
  E.setBots(g, true);
  add('fill');
  assert.equal(g.players.length, 4);
  assert.throws(() => add(40));
  assert.equal(g.players.length, 4);
  E.makeTeams(g, () => 0.4);
  E.startRound(g, 0, () => 0.4);
  for (const p of g.players.filter(p => p.bot)) {
    const v = playerView(g, p.id, 1);
    assert.deepEqual(Object.keys(v.console!), v.team!.roles);
    assert.equal(v.team!.radio?.size, undefined);
  }
  const old = g.players.find(p => p.bot)!;
  E.addPlayer(g, 'late', 'new', 'River', 1);
  E.swapSeat(g, old.id, 'late');
  assert.equal(g.players.find(p => p.id === 'late')!.name, 'River');
  assert.ok(!g.players.includes(old));
});

test('practice radio relays only purchases by the same crew, including at the 40-bot limit', () => {
  const g = E.createGame('MARS', 'host', 100);
  let id = 0;
  E.setBots(g, true);
  E.addPracticeBots(g, 40, 4, 100, () => String(++id));
  assert.throws(() => E.addPracticeBots(g, 1, 4, 100, () => String(++id)));
  E.makeTeams(g, () => 0.999);
  E.startRound(g, 100, () => 0.999);
  const crew = g.teams[0]!,
    other = g.teams[1]!;
  const seat = (role: string) => crew.members.find(m => m.roles.some(r => r === role))!.playerId;
  E.transfer(g, seat('captain'), 'captain', 'vet', 4, 101);
  E.buyAnimal(g, seat('vet'), 'cat', 4, 102);
  for (const m of crew.members) {
    const view = playerView(g, m.playerId, 103);
    assert.equal(view.team!.radio!.size, 'S');
    assert.deepEqual(Object.keys(view.console!), m.roles);
  }
  const outsider = playerView(g, other.members[0]!.playerId, 103);
  assert.equal(outsider.team!.radio!.size, undefined);
  assert.equal(outsider.console!.vet, undefined);
});
