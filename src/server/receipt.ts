import type { Outcome } from '../shared/protocol.js';
import { picksFor, type Game } from './engine.js';

// A receipt is derived only from a completed mission. Never infer that a purchase caused a landing.
export function missionReceipt(g: Game, outcomes: Outcome[]): string | undefined {
  const launches = outcomes.flatMap(outcome => {
    const picks = picksFor(g, outcome.team, outcome.round);
    return picks.launchMsLeft === undefined ? [] : [{ outcome, picks, left: picks.launchMsLeft }];
  });
  const closest = launches.sort((a, b) => a.left - b.left)[0];
  if (!closest) {
    if (!outcomes.length || outcomes.some(o => o.status !== 'scrubbed')) return;
    const supplied = outcomes.filter(o => o.animal && o.rocket).length;
    return supplied
      ? `${supplied} of ${outcomes.length} crews had both an animal and a rocket when the mission closed. What held up the launch?`
      : undefined;
  }
  const { outcome, picks, left } = closest;
  const seconds = Math.ceil(left / 1000);
  const timing = left <= 10_000 ? ` with ${seconds} second${seconds === 1 ? '' : 's'} left` : '';
  const cargo = outcome.animal!.name.toLowerCase();
  const launch = `${outcome.teamName} launched the ${cargo}${timing}.`;
  const purchase = picks.lastPurchase ? ` Their last purchase: ${picks.lastPurchase}.` : '';
  const result = outcome.status === 'landed' ? ` The ${cargo} landed for ${outcome.points} points.` : ` ${outcome.message}.`;
  return launch + purchase + result;
}
