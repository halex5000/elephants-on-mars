import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as E from '../../src/server/engine.js';
import { hostView, playerView } from '../../src/server/views.js';
import {
  AUDIENCE_CUES,
  AUDIENCE_GAIN,
  CUES,
  type Cue,
  audienceOf,
  cueForError,
  cueLength,
  cuesBetween,
  createDeduper,
  loadEnabled,
  saveEnabled,
  tickFor,
} from '../../src/client/sound.js';
import { SETTLED, T0, fund, holder, mission, started } from '../helpers.js';

const pres = { isConnected: () => true };
const host = (g: E.Game, now = T0) => hostView(g, now, pres);
const player = (g: E.Game, team: number, role: Parameters<typeof holder>[2], now = T0) => playerView(g, holder(g, team, role), now);

test('short cues stay under a second; only launch and the results fanfare run longer', () => {
  const long: Cue[] = ['launch', 'results'];
  for (const c of Object.keys(CUES) as Cue[]) {
    if (long.includes(c)) assert.ok(cueLength(c) > 1, `${c} is the long one`);
    else assert.ok(cueLength(c) < 1, `${c} is ${cueLength(c)}s`);
  }
});

test('room and phone cue sets: room-wide ticks and purchases never reach phones, personal bids never reach the room, phones are quieter', () => {
  const room = AUDIENCE_CUES.room,
    me = AUDIENCE_CUES.personal;
  for (const c of ['tick', 'purchase'] as Cue[]) assert.ok(room.includes(c) && !me.includes(c));
  for (const c of ['bid', 'outbid', 'won'] as Cue[]) assert.ok(me.includes(c) && !room.includes(c));
  for (const c of ['launch', 'landed', 'failed', 'results'] as Cue[]) assert.ok(room.includes(c) && me.includes(c));
  assert.ok(AUDIENCE_GAIN.personal < AUDIENCE_GAIN.room);
  assert.equal(audienceOf('host'), 'room');
  assert.equal(audienceOf('player'), 'personal');
});

test('purchase and launch cues reach the room exactly once', () => {
  const g = started(8);
  fund(g, 0, { vet: 50, pilot: 50, engineer: 50 });
  const before = host(g, T0);
  E.buyAnimal(g, holder(g, 0, 'vet'), 'cat', Infinity, T0 + SETTLED);
  const bought = host(g, T0 + SETTLED);
  assert.deepEqual(cuesBetween(before, bought), ['purchase']);
  assert.deepEqual(cuesBetween(bought, host(g, T0 + SETTLED)), []); // same view again: silence
  const t = mission(g, 0, { rocket: 'compact', fuel: 20, launch: false });
  const ready = host(g, t);
  E.launch(g, holder(g, 0, 'captain'), t);
  const launched = host(g, t);
  assert.deepEqual(cuesBetween(ready, launched), ['launch']);
  assert.deepEqual(cuesBetween({ ...launched, code: 'ZZZZ' }, launched), []);
});

test('mission results: room hears landings then the fanfare; a phone hears only its own team', () => {
  const g = started(8);
  fund(g, 0, { vet: 50, pilot: 50, engineer: 50 });
  mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
  const roomBefore = host(g, T0 + SETTLED);
  const mine = player(g, 0, 'captain', T0 + SETTLED);
  const other = player(g, 1, 'captain', T0 + SETTLED);
  E.endRound(g);
  const now = T0 + SETTLED + 1;
  assert.deepEqual(cuesBetween(roomBefore, host(g, now)), ['landed', 'failed', 'results']);
  assert.deepEqual(cuesBetween(mine, playerView(g, holder(g, 0, 'captain'), now)), ['landed', 'results']);
  assert.deepEqual(cuesBetween(other, playerView(g, holder(g, 1, 'captain'), now)), ['failed', 'results']);
});

test('a phone hears "won" when its team buys, and not for anyone else', () => {
  const g = started(8);
  fund(g, 0, { vet: 50 });
  const vet = player(g, 0, 'vet'),
    bystander = player(g, 1, 'vet');
  E.buyAnimal(g, holder(g, 0, 'vet'), 'cat', Infinity, T0 + SETTLED);
  assert.deepEqual(cuesBetween(vet, player(g, 0, 'vet', T0 + SETTLED)), ['won']);
  assert.deepEqual(cuesBetween(bystander, player(g, 1, 'vet', T0 + SETTLED)), []);
});

test('mission clock ticks once a second for the last five seconds only', () => {
  assert.equal(tickFor(6, 7), null);
  assert.equal(tickFor(5, 6), 'tick');
  assert.equal(tickFor(5, 5), null);
  assert.equal(tickFor(1, 2), 'tick');
  assert.equal(tickFor(0, 1), null);
});

test('only refused purchases count as outbid', () => {
  assert.equal(cueForError('Price jumped to $12: another team just bought a Compact.'), 'outbid');
  assert.equal(cueForError('Another engineer just took the fuel. Only 3 units left in the pool.'), 'outbid');
  assert.equal(cueForError('Enter your name.'), null);
});

test('the same cue within 100 ms is dropped; a different cue or a later one is not', () => {
  const ok = createDeduper();
  assert.equal(ok('purchase', 1000), true);
  assert.equal(ok('purchase', 1099), false);
  assert.equal(ok('launch', 1050), true);
  assert.equal(ok('purchase', 1100), true);
});

test('mute preference: room starts on, phones start muted, the saved choice wins, broken storage is survivable', () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(loadEnabled('room', store), true);
  assert.equal(loadEnabled('personal', store), false);
  saveEnabled('personal', true, store);
  saveEnabled('room', false, store);
  assert.equal(loadEnabled('personal', store), true);
  assert.equal(loadEnabled('room', store), false);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(loadEnabled('room', broken), true);
  saveEnabled('room', false, broken);
});
