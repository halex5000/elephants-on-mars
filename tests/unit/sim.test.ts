import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, STRATEGIES, simulate, type Scenario } from '../sim/sim.js';

const tiny: Scenario = { ...SCENARIOS.small!, name: 'tiny', teams: 3, rounds: 2, strategies: ['baseline', 'adaptive', 'oracle'] };

test('same seed and scenario give an identical trace, metrics and hash', () => {
  const a = simulate(7, tiny),
    b = simulate(7, tiny);
  assert.deepEqual(a, b);
  assert.ok(a.trace.length > 0);
});

test('a different seed changes the game', () => {
  assert.notEqual(simulate(1, tiny).summary.traceHash, simulate(2, tiny).summary.traceHash);
});

test('emits one metrics row per team per mission with consistent outcomes', () => {
  const { summary, missions } = simulate(3, tiny);
  assert.equal(missions.length, tiny.teams * tiny.rounds);
  assert.equal(summary.landed + summary.failed + summary.scrubbed, missions.length);
  assert.equal(
    summary.groupPoints,
    missions.reduce((n, m) => n + m.points, 0),
  );
  for (const m of missions) {
    assert.equal(m.status === 'landed', m.points > 0);
    if (m.status !== 'scrubbed') assert.ok(m.launchAtMs !== null);
    if (m.animalPaid !== null) assert.ok(m.animalAtMs !== null);
  }
  assert.ok(summary.groupPoints > 0, 'bots should land something');
  assert.ok(JSON.parse(JSON.stringify(summary)));
});

test('simulation uses the engine rules: every landing in the trace was a legal launch', () => {
  const { trace, missions } = simulate(5, tiny);
  const launches = trace.filter(t => t.action === 'launch' && t.ok).length;
  assert.equal(launches, missions.filter(m => m.launchAtMs !== null).length);
});

test('only labelled strategies are omniscient', () => {
  assert.deepEqual(
    Object.values(STRATEGIES)
      .filter(s => s.omniscient)
      .map(s => s.id),
    ['oracle'],
  );
});

test('the omniscient reference does not do worse than the role-limited baseline', () => {
  const r = simulate(11, { ...SCENARIOS.shootout!, teams: 6, rounds: 3 });
  const by = r.summary.pointsByStrategy;
  assert.ok(by.oracle! >= by.baseline!, JSON.stringify(by));
});
