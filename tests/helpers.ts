// Shared helpers for engine-level tests.
import * as E from '../src/server/engine.js';
import { AUCTION } from '../src/shared/market.js';
import type { Role } from '../src/shared/protocol.js';

/** Deterministic PRNG (mulberry32) so shuffles are reproducible. */
export function seeded(seed = 42): E.Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const T0 = 1_000_000;
/** Long enough after a reset that every auction has drifted to its floor. */
export const SETTLED = AUCTION.decayMs + 1000;

/** A game with `n` players and teams made, still in the briefing. */
export function setup(n = 8, settings: Partial<E.Game['settings']> = {}) {
  settings = { income: 5000, ...settings }; // plenty of money unless a test is about money
  const g = E.createGame('TEST', 'host-token', T0, settings);
  for (let i = 0; i < n; i++) E.addPlayer(g, `p${i}`, `tok${i}`, `Player ${i}`, T0);
  E.makeTeams(g, seeded(), settings);
  return g;
}
/** A game with mission 1 running, started at T0. */
export function started(n = 8, settings: Partial<E.Game['settings']> = {}) {
  const g = setup(n, { minutes: 10, ...settings });
  E.startRound(g, T0, seeded());
  return g;
}
export const holder = (g: E.Game, team: number, role: Role) => g.teams[team]!.members.find(m => m.roles.includes(role))!.playerId;
export const tid = (g: E.Game, team: number) => g.teams[team]!.id;

/** Fund crew roles from the captain. */
export function fund(g: E.Game, team: number, amounts: Partial<Record<Role, number>>, now = T0) {
  for (const [role, amt] of Object.entries(amounts)) E.transfer(g, holder(g, team, 'captain'), 'captain', role as Role, amt!, now);
}

/** Get `units` of fuel onto the mission: buy from the pool into stock (waiting for it to fill), then send it over. Returns the time after. */
export function gatherFuel(g: E.Game, team: number, units: number, from: number): number {
  let t = from;
  const eng = holder(g, team, 'engineer'),
    id = tid(g, team);
  while (E.picksFor(g, id, g.round).fuel + E.fuelStockOf(g, id) < units) {
    t += 30_000;
    E.buyFuel(g, eng, 1, t);
  }
  while (E.picksFor(g, id, g.round).fuel < units) E.sendFuel(g, eng, t);
  return t;
}

/** A whole mission for one team, at settled (cheapest) prices. */
export function mission(
  g: E.Game,
  team: number,
  m: { animal?: string; rocket?: string; fuel?: number; launch?: boolean },
  at = T0 + SETTLED,
) {
  let t = at;
  if (m.animal) E.buyAnimal(g, holder(g, team, 'vet'), m.animal, Infinity, t);
  if (m.rocket) E.buyRocket(g, holder(g, team, 'pilot'), m.rocket, Infinity, t);
  if (m.fuel) t = gatherFuel(g, team, m.fuel, t);
  if (m.launch !== false) E.launch(g, holder(g, team, 'captain'), t);
  return t;
}
