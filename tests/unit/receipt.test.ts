import { test } from 'node:test';
import assert from 'node:assert/strict';
import { started, fund, mission, holder, T0, SETTLED } from '../helpers.js';
import { launch, addTime, endRound } from '../../src/server/engine.js';
import { shared } from '../../src/server/views.js';

test('the closest launch uses its own deadline and last purchase even after the live feed rolls over', () => {
  const g = started(8);
  const end = g.endsAt!;
  for (const team of [0, 1]) {
    fund(g, team, { vet: 10, pilot: 10, engineer: 10 });
    mission(g, team, { animal: 'cat', rocket: 'compact', fuel: 20, launch: false }, T0 + SETTLED + team * 60_000);
  }
  launch(g, holder(g, 0, 'captain'), end - 2000);
  addTime(g, 60, end - 1000);
  launch(g, holder(g, 1, 'captain'), end + 20_000);
  g.feed.length = 0;
  assert.equal(shared(g, end + 21_000).common.results.length, 0);
  endRound(g);
  const receipt = shared(g, end + 21_000).common.results[0]?.receipt;
  assert.ok(receipt?.startsWith(g.teams[0]!.name));
  assert.match(receipt!, /cat with 2 seconds left/);
  assert.match(receipt!, /last purchase: .* fuel for \$1/);
  assert.match(receipt!, /landed for 10 points/);
});
