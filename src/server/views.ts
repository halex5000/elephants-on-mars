// Projects the full game state into what one viewer is allowed to see.
// This is the hidden-information boundary: tests assert nothing leaks past it.
//   Vet       → animal sizes, points and live animal prices
//   Pilot     → rocket capacity, fuel each rocket needs, live rocket prices
//   Engineer  → the shared fuel pool, how much fuel the team has on board
//   Captain   → money for everyone, what has been bought (names only), the launch button
// Everyone (like the original's big screen) sees the public activity feed and results.
import { missionReceipt } from './receipt.js';
import { ANIMALS, ROCKETS, FUEL_SEND_STEP, animalById, rocketById } from './catalog.js';
import { FUEL } from '../shared/market.js';
import {
  type Game,
  balance,
  completedRounds,
  fuelRateFor,
  fuelStockOf,
  launched,
  missionStats,
  outcomes,
  picksFor,
  teamOf,
  SPECIES_TOTAL,
} from './engine.js';
import {
  ROLES,
  type Common,
  type HostView,
  type PlayerView,
  type TeamStatus,
  type FinalSummary,
  type FuelMarket,
} from '../shared/protocol.js';

export interface Presence {
  isConnected(playerId: string): boolean;
}

/** Everything that is the same for every viewer, computed once per broadcast. */
export interface Shared {
  common: Common;
  outcomes: ReturnType<typeof outcomes>;
}

function status(g: Game, team: string): TeamStatus {
  const p = g.phase === 'play' ? picksFor(g, team, g.round) : undefined;
  const need = p?.rocket ? rocketById(p.rocket)!.fuel : Infinity;
  // "fuel" lights up when the mission has enough on board for the rocket bought (or any fuel, before there is one)
  const fuel = !!p?.fuel && (p.rocket ? p.fuel >= need : true);
  return { animal: !!p?.animal, rocket: !!p?.rocket, fuel, launched: g.phase === 'play' && launched(g, team, g.round) };
}
const fuelMarket = (g: Game): FuelMarket => ({ resetAt: g.market.fuelResetAt, ratePerSec: fuelRateFor(g), grabCost: FUEL.grabCost });

export function shared(g: Game, now: number, speed = 1): Shared {
  const o = outcomes(g, completedRounds(g));
  let final: FinalSummary | undefined;
  if (g.phase === 'final') {
    const flat = o.rounds.flat();
    const best = o.rounds.map(row => Math.max(0, ...row.map(x => x.points)));
    final = {
      winner: o.standings[0] && o.standings[0].points > 0 ? o.standings[0].name : undefined,
      topPoints: o.standings[0]?.points ?? 0,
      failed: flat.filter(x => x.status === 'failed').length,
      scrubbed: flat.filter(x => x.status === 'scrubbed').length,
      byRound: o.standings.map(s => {
        const pts = o.rounds.map(row => row.find(x => x.team === s.team)!.points);
        const landed = o.rounds.flatMap(row =>
          row.filter(x => x.team === s.team && x.status === 'landed').map(x => ({ name: x.animal!.name, emoji: x.animal!.emoji })),
        );
        return {
          team: s.team,
          name: s.name,
          bots: g.botsEnabled
            ? g.teams.find(t => t.id === s.team)?.members.flatMap(m => g.players.filter(p => p.bot && p.id === m.playerId).map(p => p.name))
            : undefined,
          points: pts,
          total: s.points,
          wins: pts.flatMap((p, i) => (p > 0 && p === best[i] ? [i + 1] : [])),
          landed,
        };
      }),
    };
  }
  const common: Common = {
    code: g.code,
    phase: g.phase,
    round: g.round,
    totalRounds: g.settings.rounds,
    endsAt: g.endsAt,
    serverNow: now,
    settings: g.settings,
    speed,
    results: o.rounds.map((row, i) => ({ round: i + 1, outcomes: row, receipt: missionReceipt(g, row) })),
    standings: o.standings,
    terraform: {
      points: o.groupPoints,
      target: o.target,
      pct: Math.min(100, Math.round((o.groupPoints / o.target) * 100)),
      species: [...o.species].map(id => {
        const a = animalById(id)!;
        return { name: a.name, emoji: a.emoji };
      }),
      speciesTotal: SPECIES_TOTAL,
    },
    final,
    feed:
      g.phase === 'play'
        ? g.feed
            .filter(f => f.round === g.round)
            .slice(-25)
            .reverse()
        : [],
    stats: missionStats(g),
  };
  return { common, outcomes: o };
}

export function hostView(g: Game, now: number, pres: Presence, sh: Shared = shared(g, now)): HostView {
  const name = (id: string) => g.players.find(p => p.id === id)?.name ?? 'Someone';
  return {
    ...sh.common,
    kind: 'host',
    botsEnabled: g.botsEnabled,
    players: g.players.map(p => ({ id: p.id, name: p.name, connected: pres.isConnected(p.id), seated: !!teamOf(g, p.id) })),
    teams: g.teams.map(t => ({
      id: t.id,
      name: t.name,
      status: status(g, t.id),
      members: t.members.map(m => ({
        id: m.playerId,
        name: name(m.playerId),
        roles: m.roles,
        bot: g.players.find(p => p.id === m.playerId)?.bot,
        connected: pres.isConnected(m.playerId),
      })),
    })),
    fuel: g.phase === 'play' ? fuelMarket(g) : undefined,
  };
}

export function playerView(g: Game, playerId: string, now: number, sh: Shared = shared(g, now)): PlayerView {
  const me = g.players.find(p => p.id === playerId);
  const base: PlayerView = { ...sh.common, kind: 'player', me: { id: playerId, name: me?.name ?? '' } };
  const mine = teamOf(g, playerId);
  if (!mine) return base;
  const { team, roles } = mine;
  const name = (id: string) => g.players.find(p => p.id === id)?.name ?? 'Someone';
  base.team = {
    id: team.id,
    name: team.name,
    roles,
    roster: ROLES.map(role => ({
      role,
      names: team.members.filter(m => m.roles.includes(role)).map(m => name(m.playerId)),
      balance: balance(g, team.id, role),
    })),
    status: status(g, team.id),
  };
  if (g.phase !== 'play') return base;

  const p = picksFor(g, team.id, g.round);
  // Practice crews automatically radio their own purchased payload size and fuel order.
  if (g.botsEnabled && team.members.some(m => g.players.some(p => p.id === m.playerId && p.bot))) {
    base.team.radio = { size: p.animal ? animalById(p.animal)?.size : undefined, need: p.rocket ? rocketById(p.rocket)?.fuel : undefined };
  }
  const c: NonNullable<PlayerView['console']> = {};
  if (roles.includes('captain')) {
    const a = p.animal ? animalById(p.animal) : undefined;
    // names only: the Captain learns sizes and fuel needs by asking
    c.captain = {
      picks: { animal: a && `${a.emoji} ${a.name}`, rocket: p.rocket ? rocketById(p.rocket)!.name : undefined, fuel: p.fuel || undefined },
    };
  }
  if (roles.includes('vet'))
    c.vet = {
      animals: ANIMALS.map(a => ({
        id: a.id,
        name: a.name,
        emoji: a.emoji,
        size: a.size,
        points: a.points,
        base: a.base,
        resetAt: g.market.animals[a.id]!,
      })),
      bought: p.animal,
      paid: p.animal ? p.animalPaid : undefined,
    };
  if (roles.includes('pilot'))
    c.pilot = {
      rockets: ROCKETS.map(k => ({ id: k.id, name: k.name, size: k.size, fuel: k.fuel, base: k.base, resetAt: g.market.rockets[k.id]! })),
      bought: p.rocket,
      paid: p.rocket ? p.rocketPaid : undefined,
    };
  if (roles.includes('engineer'))
    c.engineer = { market: fuelMarket(g), stock: fuelStockOf(g, team.id), sent: p.fuel, sendStep: FUEL_SEND_STEP };
  base.console = c;
  return base;
}
