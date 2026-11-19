import assert from 'node:assert/strict';
import { test } from 'node:test';
import { landingMap } from '../../src/client/landing-map.js';
import { shared } from '../../src/server/views.js';
import { endRound } from '../../src/server/engine.js';
import { started, fund, mission, T0 } from '../helpers.js';

test('postcard records successful landings once each, escapes crew names and omits failed or scrubbed cargo', () => {
  const g = started(8);
  fund(g, 0, { vet: 10, pilot: 10, engineer: 10 });
  mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
  g.teams[0]!.name = 'Cats <&>';
  endRound(g);
  const v = shared(g, T0).common;
  const map = landingMap(v, false);
  assert.match(map, /Landing register \(1\)/);
  assert.match(map, /Clipboard, Cat · Cats &lt;&amp;&gt; · Mission 1/);
  assert.doesNotMatch(map, /<button/);
  const second = v.results[0]!.outcomes.map(o => ({ ...o, round: 2, status: 'failed' as const }));
  v.results.push({ round: 2, outcomes: second });
  assert.equal(landingMap(v, false), map);
});
