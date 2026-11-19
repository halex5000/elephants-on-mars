// The "Copy results" text: what the group pastes into chat after the debrief.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/server/engine.js';
import { hostView, playerView } from '../../src/server/views.js';
import { resultsText } from '../../src/client/export.js';
import { started, seeded, holder, fund, mission, T0, SETTLED } from '../helpers.js';

const pres = { isConnected: () => true };
const T1 = T0 + 3_600_000;

/** Two teams, two missions: team 0 lands a cat then scrubs; team 1 mis-sizes a giraffe then lands one. */
function playedGame() {
  const g = started(8, { rounds: 2 });
  fund(g, 0, { vet: 30, pilot: 30, engineer: 30 });
  fund(g, 1, { vet: 30, pilot: 30, engineer: 30 });
  const t = mission(g, 0, { animal: 'cat', rocket: 'compact', fuel: 20 });
  mission(g, 1, { animal: 'giraffe', rocket: 'compact', fuel: 20 }, t + 60_000); // after team 0 emptied the shared pool
  E.endRound(g);
  E.startRound(g, T1, seeded(7));
  fund(g, 1, { vet: 30, pilot: 30, engineer: 30 }, T1);
  mission(g, 1, { animal: 'giraffe', rocket: 'heavy', fuel: 55 }, T1 + SETTLED);
  E.endRound(g);
  E.finish(g);
  return g;
}

describe('results export', () => {
  test('headline, leaderboard in rank order with the zoo, and every mission outcome', () => {
    const g = playedGame();
    const text = resultsText(hostView(g, T1, pres));
    const [a, b] = [g.teams[0]!.name, g.teams[1]!.name];
    const lines = text.split('\n');
    assert.equal(lines[0], 'Elephants on Mars: mission report (game TEST)');
    assert.equal(lines[1], `🏆 ${b} wins with 40 points`);
    assert.match(lines[2]!, /^Mars is \d+% terraformed: 50 of \d+ points, 2 of \d+ species$/);
    const board = lines.slice(lines.indexOf('Leaderboard') + 1);
    assert.equal(board[0], `1. ${b}: 40 points  🦒`);
    assert.equal(board[1], `2. ${a}: 10 points  🐈`);
    assert.ok(text.includes(`Mission 1\n- ${a}: Cat landed safely (+10)\n- ${b}: The giraffe (L) didn't fit in the`), text);
    assert.ok(text.includes(`Mission 2\n- ${a}: Never launched\n- ${b}: Giraffe landed safely (+40)`), text);
  });

  test('players get the same text as the host (it only uses what the final report shows everyone)', () => {
    const g = playedGame();
    assert.equal(resultsText(playerView(g, holder(g, 0, 'vet'), T1)), resultsText(hostView(g, T1, pres)));
  });

  test('a game where nobody landed anything says so instead of naming a winner', () => {
    const g = started(4, { rounds: 1 });
    E.endRound(g); E.finish(g);
    const text = resultsText(hostView(g, T0, pres));
    assert.match(text, /No team landed an animal\. Mars is still waiting\./);
    assert.doesNotMatch(text, /🏆/);
    assert.match(text, /1\. .+: 0 points\n/);
  });

  test('nothing to export before the final report', () => {
    const g = started(4, { rounds: 2 });
    assert.equal(resultsText(hostView(g, T0, pres)), '');
  });
});
