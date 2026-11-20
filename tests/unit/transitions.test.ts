import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as E from '../../src/server/engine.js';
import { hostView, playerView } from '../../src/server/views.js';
import { cuesForEvents } from '../../src/client/sound.js';
import { eventsBetween } from '../../src/client/transitions.js';
import { SETTLED, T0, fund, holder, mission, started } from '../helpers.js';

const pres = { isConnected: () => true };
const host = (g: E.Game, now = T0) => hostView(g, now, pres);
const player = (g: E.Game, team: number, role: Parameters<typeof holder>[2], now = T0) => playerView(g, holder(g, team, role), now);

function launchedGame() {
  const g = started(8);
  fund(g, 0, { vet: 50, pilot: 50, engineer: 50 });
  const t = mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20, launch: false });
  const ready = host(g, t),
    readyCaptain = player(g, 0, 'captain', t);
  E.launch(g, holder(g, 0, 'captain'), t);
  return { g, t, ready, readyCaptain, launched: host(g, t) };
}

test('a first view, a different game, or a different viewer kind produces no events', () => {
  const { g, t, launched } = launchedGame();
  assert.deepEqual(eventsBetween(null, launched), []);
  assert.deepEqual(eventsBetween({ ...launched, code: 'ZZZZ' }, launched), []);
  assert.deepEqual(eventsBetween(player(g, 0, 'captain', t), launched), []);
});

test('a real launch is one room event naming the team, once; the same view again is silent', () => {
  const { ready, launched, g } = launchedGame();
  const events = eventsBetween(ready, launched);
  assert.deepEqual(events, [{ type: 'launch', audience: 'room', teams: [{ id: launched.teams[0]!.id, name: launched.teams[0]!.name }] }]);
  assert.deepEqual(eventsBetween(launched, launched), []);
  // a reconnect or late join starts from nothing: the already-launched team is history, not news
  assert.deepEqual(eventsBetween(null, launched), []);
  assert.equal(g.round, launched.round);
});

test('two teams launching in one view are one event, in team order', () => {
  const g = started(8);
  fund(g, 0, { vet: 50, pilot: 50, engineer: 50 });
  fund(g, 1, { vet: 50, pilot: 50, engineer: 50 });
  const t = mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20, launch: false });
  mission(g, 1, { animal: 'cat', rocket: 'compact', fuel: 20, launch: false }, t + 60_000);
  const before = host(g, t);
  E.launch(g, holder(g, 0, 'captain'), t);
  E.launch(g, holder(g, 1, 'captain'), t);
  const [e, ...rest] = eventsBetween(before, host(g, t));
  assert.equal(rest.length, 0);
  assert.equal(e?.type === 'launch' && e.audience === 'room' ? e.teams.length : 0, 2);
});

test('a phone hears only its own team launch', () => {
  const { g, t, readyCaptain } = launchedGame();
  const mine = eventsBetween(readyCaptain, player(g, 0, 'captain', t));
  assert.deepEqual(mine, [{ type: 'launch', audience: 'team', teamId: readyCaptain.team!.id }]);
  const other = player(g, 1, 'captain', t);
  assert.deepEqual(eventsBetween(other, player(g, 1, 'captain', t)), []);
});

test('launch events do not cross a round boundary', () => {
  const { launched } = launchedGame();
  assert.deepEqual(
    eventsBetween(
      { ...launched, round: launched.round - 1, teams: launched.teams.map(t => ({ ...t, status: { ...t.status, launched: false } })) },
      launched,
    ),
    [],
  );
});

test('mission results: room event carries what occurred, a phone gets its own outcome', () => {
  const g = started(8);
  fund(g, 0, { vet: 50, pilot: 50, engineer: 50 });
  mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
  const roomBefore = host(g, T0 + SETTLED);
  const mineBefore = player(g, 0, 'captain', T0 + SETTLED);
  const otherBefore = player(g, 1, 'captain', T0 + SETTLED);
  E.endRound(g);
  const now = T0 + SETTLED + 1;
  assert.deepEqual(eventsBetween(roomBefore, host(g, now)), [
    { type: 'mission-result', audience: 'room', round: 1, landed: true, failed: true },
  ]);
  assert.deepEqual(eventsBetween(mineBefore, player(g, 0, 'captain', now)), [
    { type: 'mission-result', audience: 'team', round: 1, teamId: mineBefore.team!.id, landed: true },
  ]);
  assert.deepEqual(eventsBetween(otherBefore, player(g, 1, 'captain', now)), [
    { type: 'mission-result', audience: 'team', round: 1, teamId: otherBefore.team!.id, landed: false },
  ]);
  // a late joiner arriving after the results sees them as history
  assert.deepEqual(eventsBetween(null, host(g, now)), []);
});

test('events map to cues: landings come before the fanfare, failures only when something failed', () => {
  assert.deepEqual(cuesForEvents([{ type: 'mission-result', audience: 'room', round: 1, landed: true, failed: false }]), [
    'landed',
    'results',
  ]);
  assert.deepEqual(cuesForEvents([{ type: 'mission-result', audience: 'room', round: 1, landed: true, failed: true }]), [
    'landed',
    'failed',
    'results',
  ]);
  assert.deepEqual(cuesForEvents([{ type: 'mission-result', audience: 'team', round: 1, teamId: 'a', landed: null }]), ['results']);
  assert.deepEqual(
    cuesForEvents([
      { type: 'launch', audience: 'room', teams: [] },
      { type: 'purchase', audience: 'room' },
    ]),
    ['launch', 'purchase'],
  );
  assert.deepEqual(cuesForEvents([{ type: 'team-purchase', audience: 'team', teamId: 'a' }]), ['won']);
});
