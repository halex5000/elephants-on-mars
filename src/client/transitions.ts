// Semantic game events derived from two successive views of the same game. Pure: no DOM, no audio, no timers.
//
// One mapper feeds every state-derived effect (sound cues in sound.ts, the host lift-off in main.ts, and whatever
// cinematic presentation comes next), so they can't disagree about what just happened. It is deliberately not a
// plugin or event framework: a function from (prev view, next view) to a list of plain events.
//
// Rules, all tested in tests/unit/transitions.test.ts:
//  - First view, a different game, or a different kind of viewer (host vs player): no events. A reload, reconnect
//    or late join never replays history.
//  - A real transition is reported once, on the view that first shows it. The same view again reports nothing.
//  - Room events (host view) describe the whole game; team events (player view) describe only the player's own team.
import type { HostView, PlayerView } from '../shared/protocol.js';

export type View = HostView | PlayerView;

export type GameEvent =
  /** Room: someone bought something (animal, rocket or fuel) during a mission. */
  | { type: 'purchase'; audience: 'room' }
  /** Room: these teams just launched. Order follows the team list. */
  | { type: 'launch'; audience: 'room'; teams: { id: string; name: string }[] }
  /** Team: this player's own team just launched. */
  | { type: 'launch'; audience: 'team'; teamId: string }
  /** Team: this player's own team just bought or loaded something. */
  | { type: 'team-purchase'; audience: 'team'; teamId: string }
  /** Room: a mission closed. `landed`/`failed` say which kinds of outcome occurred (unlaunched missions count as failed). */
  | { type: 'mission-result'; audience: 'room'; round: number; landed: boolean; failed: boolean }
  /** Team: a mission closed. `landed` is this team's outcome, or null if it has none in that result. */
  | { type: 'mission-result'; audience: 'team'; round: number; teamId: string | null; landed: boolean | null };

const feedKey = (f: { at: number; teamName: string; text: string }) => `${f.at}|${f.teamName}|${f.text}`;

/** The mission summary that appeared between the two views, if any. */
function newResult(prev: View, next: View) {
  return next.results.length > prev.results.length ? next.results[next.results.length - 1] : undefined;
}

/** What happened between two views of the same game, for this kind of viewer. */
export function eventsBetween(prev: View | null, next: View): GameEvent[] {
  if (!prev || prev.code !== next.code || prev.kind !== next.kind) return [];
  const out: GameEvent[] = [];
  const result = newResult(prev, next);

  if (next.kind === 'host' && prev.kind === 'host') {
    if (next.phase === 'play' && prev.round === next.round) {
      const seen = new Set(prev.feed.map(feedKey));
      if (next.feed.some(f => f.kind !== 'launch' && !seen.has(feedKey(f)))) out.push({ type: 'purchase', audience: 'room' });
      const before = new Set(prev.teams.filter(t => t.status.launched).map(t => t.id));
      const fresh = next.teams.filter(t => t.status.launched && !before.has(t.id));
      if (fresh.length) out.push({ type: 'launch', audience: 'room', teams: fresh.map(t => ({ id: t.id, name: t.name })) });
    }
    if (result) {
      const statuses = result.outcomes.map(o => o.status);
      out.push({
        type: 'mission-result',
        audience: 'room',
        round: result.round,
        landed: statuses.includes('landed'),
        failed: statuses.some(s => s !== 'landed'),
      });
    }
  } else if (next.kind === 'player' && prev.kind === 'player') {
    const was = prev.team,
      now = next.team;
    if (was && now && was.id === now.id && prev.round === next.round) {
      const c = next.console,
        p = prev.console;
      const bought = (c?.vet?.bought && c.vet.bought !== p?.vet?.bought) || (c?.pilot?.bought && c.pilot.bought !== p?.pilot?.bought);
      const fuel = (c?.engineer?.stock ?? 0) > (p?.engineer?.stock ?? 0);
      if (bought || fuel) out.push({ type: 'team-purchase', audience: 'team', teamId: now.id });
      if (now.status.launched && !was.status.launched) out.push({ type: 'launch', audience: 'team', teamId: now.id });
    }
    if (result && now) {
      const mine = result.outcomes.find(o => o.team === now.id);
      out.push({
        type: 'mission-result',
        audience: 'team',
        round: result.round,
        teamId: now.id,
        landed: mine ? mine.status === 'landed' : null,
      });
    }
  }
  return out;
}
