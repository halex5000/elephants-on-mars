// Deterministic headless simulation of whole games on the real engine (src/server/engine.ts).
// No sockets, timers, wall clock or LLM: simulated time advances in fixed ticks and every random
// choice comes from the seed, so the same (seed, scenario) always yields the same trace and summary.
// Results inform, but never replace, the human playtest (docs/simulation.md).
import { createHash } from 'node:crypto';
import * as E from '../../src/server/engine.js';
import { ANIMALS, ROCKETS, animalById, fits, rocketById } from '../../src/server/catalog.js';
import { marketBot, type Crew } from '../../src/server/market-bot.js';
import { playerView, shared, type Shared } from '../../src/server/views.js';
import { AUCTION, FUEL } from '../../src/shared/market.js';
import type { Action, PlayerView, Role } from '../../src/shared/protocol.js';
import { seeded } from '../helpers.js';

/* ---------- scenarios ---------- */
export interface Scenario {
  name: string;
  teams: number;
  rounds: number;
  /** Mission length in minutes. */
  minutes: number;
  income: number;
  /** Strategy ids, assigned to teams round-robin (team 1 gets the first). */
  strategies: string[];
  /** Same meaning as the server option: a second listing copy at this many teams or more. */
  extraListingMinTeams?: number;
  /** Simulated clock: first mission starts here, ticks advance by tickMs, missions are gapMs apart. */
  startMs: number;
  tickMs: number;
  gapMs: number;
}
const base = { startMs: 1_700_000_000_000, tickMs: 500, gapMs: 30_000, minutes: 4, income: 10 };
export const SCENARIOS: Record<string, Scenario> = {
  // Defaults mirror DEFAULT_SETTINGS (4 minutes, $10 a mission, 6 missions).
  small: { ...base, name: 'small', teams: 4, rounds: 6, strategies: ['baseline', 'adaptive'] },
  room: { ...base, name: 'room', teams: 12, rounds: 6, strategies: ['baseline', 'adaptive'] },
  large: { ...base, name: 'large', teams: 50, rounds: 6, strategies: ['baseline', 'adaptive'], extraListingMinTeams: 26, tickMs: 1000 },
  // Same teams, every strategy side by side, including the labelled omniscient one.
  shootout: { ...base, name: 'shootout', teams: 12, rounds: 6, strategies: ['baseline', 'adaptive', 'oracle'] },
};

/* ---------- trace & metrics ---------- */
export interface TraceEntry {
  /** ms since the first mission started */
  t: number;
  round: number;
  team: string;
  role: Role;
  action: Action['a'];
  /** Compact argument, e.g. the animal id or the amount. */
  arg?: string | number;
  ok: boolean;
  /** Price paid / units moved when ok, else the engine's refusal. */
  result?: number | string;
}
export interface MissionMetrics {
  kind: 'mission';
  seed: number;
  scenario: string;
  strategy: string;
  round: number;
  team: string;
  status: 'landed' | 'failed' | 'scrubbed';
  points: number;
  spend: number;
  animal: string | null;
  animalPaid: number | null;
  rocket: string | null;
  rocketPaid: number | null;
  fuelSent: number;
  fuelNeeded: number | null;
  fuelGrabs: number;
  /** ms into the mission, null when it never happened */
  animalAtMs: number | null;
  rocketAtMs: number | null;
  firstFuelAtMs: number | null;
  launchAtMs: number | null;
  rejected: number;
}
export interface GameSummary {
  kind: 'game';
  seed: number;
  scenario: string;
  teams: number;
  rounds: number;
  landed: number;
  failed: number;
  scrubbed: number;
  groupPoints: number;
  terraformTarget: number;
  species: number;
  spend: number;
  rejected: number;
  /** points per strategy id */
  pointsByStrategy: Record<string, number>;
  standings: { team: string; strategy: string; points: number }[];
  /** sha256 of the full trace + mission metrics: equal hashes mean identical games. */
  traceHash: string;
}
export interface SimResult {
  summary: GameSummary;
  missions: MissionMetrics[];
  trace: TraceEntry[];
}

/* ---------- strategies ---------- */
export interface TeamPlay {
  game: E.Game;
  team: E.Team;
  rng: E.Rng;
  /** Perform an action as one team member (the engine decides whether it is legal). */
  act(playerId: string, action: Action): void;
  /** What the role-appropriate server view shows this player right now. */
  view(playerId: string): PlayerView;
  /** Who holds each role this mission. */
  holder(role: Role): string;
  /** Receive the engine's refusal text for this player's rejected actions (like a socket error message). */
  onError(playerId: string, listener: (message: string) => void): void;
  /** Simulated time in ms. Strategies with `omniscient: true` may also read `game` directly; others must only use `view`. */
  clock(): number;
}
export interface Strategy {
  id: string;
  describe: string;
  /** True only for strategies that read hidden game state. They are labelled in output. */
  omniscient: boolean;
  /** Called once per team per mission; returns a function stepped every tick. */
  mission(play: TeamPlay, round: number): () => void;
}

/** Reuses the live practice bot (src/server/market-bot.ts) unchanged, fed only role-filtered views. */
function botStrategy(id: string, adaptive: boolean, describe: string): Strategy {
  return {
    id,
    describe,
    omniscient: false,
    mission(play, round) {
      // The crew object is the team's voice chat: the vet's animal size and the pilot's fuel need are shared.
      const crew: Crew = { team: play.team.id, rocketAttempts: 0, rocketFailures: 0 };
      const bots = play.team.members.map(m => {
        const errors: string[] = [];
        const client = {
          get pv() {
            return play.view(m.playerId);
          },
          errors,
          act: (action: Action) => play.act(m.playerId, action),
        };
        // Refusals surface through the same error list the websocket client would see.
        play.onError(m.playerId, msg => errors.push(msg));
        const variant = Number(play.team.id.slice(1)) + round - 2;
        return marketBot(client, crew, variant, play.clock, adaptive, () => 900 + Math.floor(play.rng() * 1100));
      });
      return () => bots.forEach(b => b.step());
    },
  };
}

/**
 * OMNISCIENT / ADVERSARIAL REFERENCE: reads the whole game (true prices, pool size, all rocket specs)
 * to plan the best affordable payload and buys everything once prices have settled to the floor. It is an upper
 * bound for comparison, not something a real team can do. Never use it to argue a role-limited bot is "bad".
 */
const oracle: Strategy = {
  id: 'oracle',
  describe: 'OMNISCIENT reference: plans the best payload from hidden data and buys at floor prices',
  omniscient: true,
  mission(play) {
    const g = play.game;
    const id = play.team.id;
    const start = g.endsAt! - Math.round(g.settings.minutes * 60_000);
    let plan: { animal: string; rocket: string; need: number; cost: number } | undefined;
    let funded = false;
    return () => {
      const now = play.clock();
      const cap = play.holder('captain'),
        vet = play.holder('vet'),
        pilot = play.holder('pilot'),
        eng = play.holder('engineer');
      const stock = E.fuelStockOf(g, id);
      if (now - start < AUCTION.decayMs) return; // wait for the floor, then plan from what other teams already took
      if (!plan) {
        const money = E.balance(g, id, 'captain');
        let best: { points: number; cost: number; animal: string; rocket: string; need: number } | undefined;
        // Being omniscient, avoid listings other teams already bought this mission: those would be reset to a high price.
        const taken = Object.entries(g.picks).filter(([k]) => k.endsWith(`|${g.round}`) && !k.startsWith(`${id}|`));
        // If every listing is taken, fall back to paying today's (reset) price for a taken one.
        for (const avoidTaken of [true, false]) {
          for (const a of ANIMALS)
            for (const r of ROCKETS) {
              if (avoidTaken && taken.some(([, o]) => o.animal === a.id || o.rocket === r.id)) continue;
              if (!fits(a.size, r.size)) continue;
              const cost = E.animalPriceNow(g, a.id, now) + E.rocketPriceNow(g, r.id, now) + (stock >= r.fuel ? 0 : FUEL.grabCost);
              if (cost > money) continue;
              if (!best || a.points > best.points || (a.points === best.points && cost < best.cost))
                best = { points: a.points, cost, animal: a.id, rocket: r.id, need: r.fuel };
            }
          if (best) break;
        }
        if (!best) return;
        plan = best;
      }
      const a = animalById(plan.animal)!,
        r = rocketById(plan.rocket)!;
      if (!funded) {
        funded = true;
        const spare = E.balance(g, id, 'captain') - plan.cost;
        const give = (to: Role, amount: number) => amount > 0 && play.act(cap, { a: 'transfer', from: 'captain', to, amount });
        give('vet', E.animalPriceNow(g, a.id, now) + Math.ceil(spare / 2)); // spare dollars absorb a stale-price retry
        give('pilot', E.rocketPriceNow(g, r.id, now) + Math.floor(spare / 2));
        give('engineer', stock >= r.fuel ? 0 : FUEL.grabCost);
      }
      let pk = E.picksFor(g, id, g.round);
      if (!pk.animal) play.act(vet, { a: 'buyAnimal', animal: a.id, maxPrice: E.animalPriceNow(g, a.id, now) });
      if (!pk.rocket) play.act(pilot, { a: 'buyRocket', rocket: r.id, maxPrice: E.rocketPriceNow(g, r.id, now) });
      pk = E.picksFor(g, id, g.round);
      if (
        pk.animal &&
        pk.rocket &&
        pk.fuel + E.fuelStockOf(g, id) < r.fuel &&
        E.fuelPoolNow(g, now) >= r.fuel - pk.fuel - E.fuelStockOf(g, id)
      )
        play.act(eng, { a: 'buyFuel', minUnits: 1 });
      while (E.picksFor(g, id, g.round).fuel < r.fuel && E.fuelStockOf(g, id) > 0) play.act(eng, { a: 'sendFuel' });
      pk = E.picksFor(g, id, g.round);
      if (pk.animal && pk.rocket && pk.fuel >= r.fuel && pk.launchedAt == null) play.act(cap, { a: 'launch' });
    };
  },
};

export const STRATEGIES: Record<string, Strategy> = {
  baseline: botStrategy('baseline', false, 'Practice bot: fixed animal wishlist, frugal rocket, role-limited views'),
  adaptive: botStrategy('adaptive', true, 'Practice bot that downsizes its animal late and tops up the pilot; role-limited views'),
  oracle,
};

/* ---------- the runner ---------- */
const apply = (g: E.Game, pid: string, a: Action, now: number): number | string | undefined => {
  switch (a.a) {
    case 'transfer':
      E.transfer(g, pid, a.from, a.to, a.amount, now);
      return a.amount;
    case 'reclaim':
      E.reclaim(g, pid, a.from, a.amount, now);
      return a.amount;
    case 'buyAnimal':
      return E.buyAnimal(g, pid, a.animal, a.maxPrice, now);
    case 'buyRocket':
      return E.buyRocket(g, pid, a.rocket, a.maxPrice, now);
    case 'buyFuel':
      return E.buyFuel(g, pid, a.minUnits, now);
    case 'sendFuel':
      return E.sendFuel(g, pid, now);
    case 'launch':
      E.launch(g, pid, now);
      return undefined;
    default:
      throw new Error(`Simulation does not drive host action ${a.a}`);
  }
};
const argOf = (a: Action): string | number | undefined =>
  a.a === 'buyAnimal' ? a.animal : a.a === 'buyRocket' ? a.rocket : a.a === 'transfer' || a.a === 'reclaim' ? a.amount : undefined;

export function simulate(seed: number, scenarioOrName: Scenario | string): SimResult {
  const sc =
    typeof scenarioOrName === 'string' ? (SCENARIOS[scenarioOrName] ?? fail(`Unknown scenario ${scenarioOrName}`)) : scenarioOrName;
  const strategies = sc.strategies.map(s => STRATEGIES[s] ?? fail(`Unknown strategy ${s}`));
  const engineRng = seeded(seed);
  const g = E.createGame('SIM', 'host', sc.startMs, { minutes: sc.minutes, income: sc.income, teamSize: 4, rounds: sc.rounds });
  for (let i = 0; i < sc.teams * 4; i++) E.addPlayer(g, `p${i}`, `t${i}`, `Player ${i}`, sc.startMs);
  E.makeTeams(g, engineRng);
  const stratOf = new Map(g.teams.map((t, i) => [t.id, strategies[i % strategies.length]!]));
  const trace: TraceEntry[] = [];
  const missions: MissionMetrics[] = [];
  let now = sc.startMs;
  let sh: Shared = shared(g, now);

  for (let round = 1; round <= sc.rounds; round++) {
    E.startRound(g, now, engineRng, sc.extraListingMinTeams);
    const startedAt = now;
    const rejects = new Map<string, number>();
    const hooks = new Map<string, (m: string) => void>();
    const steps = g.teams.map((team, i) => {
      const strat = stratOf.get(team.id)!;
      const rng = seeded(seed * 100_003 + round * 1_009 + i);
      const holder = (role: Role) => team.members.find(m => m.roles.includes(role))!.playerId;
      const play: TeamPlay = {
        game: g,
        team,
        rng,
        clock: () => now,
        holder,
        view: pid => playerView(g, pid, now, sh),
        onError: (pid, f) => hooks.set(pid, f),
        act(pid, action) {
          const roles = team.members.find(m => m.playerId === pid)!.roles;
          const role = roles.find(r => roleOf(action, r)) ?? roles[0]!;
          const entry: TraceEntry = { t: now - sc.startMs, round, team: team.id, role, action: action.a, arg: argOf(action), ok: true };
          try {
            const r = apply(g, pid, action, now);
            if (r !== undefined) entry.result = r;
          } catch (e) {
            if (!(e instanceof E.GameError)) throw e;
            entry.ok = false;
            entry.result = e.message;
            rejects.set(team.id, (rejects.get(team.id) ?? 0) + 1);
            hooks.get(pid)?.(e.message);
          }
          trace.push(entry);
        },
      };
      return strat.mission(play, round);
    });
    for (; now < g.endsAt!; now += sc.tickMs) {
      sh = shared(g, now);
      for (const step of steps) step();
    }
    E.endRound(g);
    for (const team of g.teams) {
      const strat = stratOf.get(team.id)!;
      missions.push(metricsFor(g, seed, sc.name, strat.id, team.id, round, startedAt, sc.startMs, trace, rejects.get(team.id) ?? 0));
    }
    now += sc.gapMs;
  }
  E.finish(g);
  return finalize(g, sc, seed, missions, trace, stratOf);
}

// Which role an action belongs to (so the trace shows the role even for people holding several).
const roleOf = (a: Action, r: Role) =>
  ({
    transfer: 'captain',
    reclaim: 'captain',
    launch: 'captain',
    buyAnimal: 'vet',
    buyRocket: 'pilot',
    buyFuel: 'engineer',
    sendFuel: 'engineer',
  })[a.a as string] === r;

function metricsFor(
  g: E.Game,
  seed: number,
  scenario: string,
  strategy: string,
  team: string,
  round: number,
  startedAt: number,
  t0: number,
  trace: TraceEntry[],
  rejected: number,
): MissionMetrics {
  const o = E.outcomes(g, round).rounds[round - 1]!.find(x => x.team === team)!;
  const p = E.picksFor(g, team, round);
  const mine = trace.filter(e => e.team === team && e.round === round && e.ok);
  const at = (action: TraceEntry['action']) => {
    const e = mine.find(x => x.action === action);
    return e ? e.t + t0 - startedAt : null;
  };
  return {
    kind: 'mission',
    seed,
    scenario,
    strategy,
    round,
    team,
    status: o.status,
    points: o.points,
    spend: o.spent,
    animal: p.animal ?? null,
    animalPaid: p.animalPaid ?? null,
    rocket: p.rocket ?? null,
    rocketPaid: p.rocketPaid ?? null,
    fuelSent: p.fuel,
    fuelNeeded: o.rocket?.fuel ?? null,
    fuelGrabs: p.fuelGrabs,
    animalAtMs: at('buyAnimal'),
    rocketAtMs: at('buyRocket'),
    firstFuelAtMs: at('buyFuel'),
    launchAtMs: p.launchedAt != null ? p.launchedAt - startedAt : null,
    rejected,
  };
}

function finalize(
  g: E.Game,
  sc: Scenario,
  seed: number,
  missions: MissionMetrics[],
  trace: TraceEntry[],
  stratOf: Map<string, Strategy>,
): SimResult {
  const o = E.outcomes(g);
  const count = (s: MissionMetrics['status']) => missions.filter(m => m.status === s).length;
  const pointsByStrategy: Record<string, number> = {};
  for (const m of missions) pointsByStrategy[m.strategy] = (pointsByStrategy[m.strategy] ?? 0) + m.points;
  const summary: GameSummary = {
    kind: 'game',
    seed,
    scenario: sc.name,
    teams: sc.teams,
    rounds: sc.rounds,
    landed: count('landed'),
    failed: count('failed'),
    scrubbed: count('scrubbed'),
    groupPoints: o.groupPoints,
    terraformTarget: o.target,
    species: o.species.size,
    spend: missions.reduce((n, m) => n + m.spend, 0),
    rejected: missions.reduce((n, m) => n + m.rejected, 0),
    pointsByStrategy,
    standings: o.standings.map(s => ({ team: s.team, strategy: stratOf.get(s.team)!.id, points: s.points })),
    traceHash: createHash('sha256').update(JSON.stringify({ trace, missions })).digest('hex'),
  };
  return { summary, missions, trace };
}

const fail = (m: string): never => {
  throw new Error(m);
};
