// Pure game engine: no I/O, no timers, no randomness except the injected rng.
// Every rule lives here so it can be unit-tested without a server.
//
// Rules follow the original game (MeetMax Games' Elephants on Mars):
//  - teams of 4: Captain allocates money and launches, Vet buys the animal,
//    Pilot buys a rocket big enough for it, Engineer gathers enough fuel for that rocket
//  - roles reshuffle at random within each team every mission
//  - live markets shared by every team (see shared/market.ts)
//  - fuel: the Engineer buys the shared pool into the team's stock, then sends it to
//    the mission 10 units at a time; stock carries over between missions
//  - a landed animal scores its points; the group's total terraforms Mars
import { ANIMALS, ROCKETS, TEAM_NAMES, TERRAFORM_POINTS_PER_TEAM_ROUND, FUEL_SEND_STEP, animalById, rocketById, fits } from './catalog.js';
import { auctionPrice, fuelInPool, fuelRate, FUEL } from '../shared/market.js';
import { ROLES, type Role, type Phase, type Settings, type Outcome, type Standing, type FeedItem } from '../shared/protocol.js';

export class GameError extends Error {}
const fail = (msg: string): never => {
  throw new GameError(msg);
};

export type Rng = () => number;

export interface Player {
  id: string;
  name: string;
  token: string;
  joinedAt: number;
}
export interface Member {
  playerId: string;
  roles: Role[];
}
export interface Team {
  id: string;
  name: string;
  members: Member[];
}
/** One team's purchases in one mission. Re-buying replaces the item; nothing is refunded. fuel = units sent to this mission. */
export interface Picks {
  animal?: string;
  rocket?: string;
  fuel: number;
  fuelGrabs: number;
  spent: { vet: number; pilot: number; engineer: number };
  launchedAt?: number;
  launchMsLeft?: number;
  lastPurchase?: string;
}
export interface Transfer {
  team: string;
  from: Role;
  to: Role;
  amount: number;
  round: number;
  at: number;
}
interface Listings {
  animals: Record<string, number>;
  rockets: Record<string, number>;
}
export interface Market extends Listings {
  fuelResetAt: number;
  secondCopy?: Listings;
}

// The displayed clock is always the older (cheaper) offer. After a sale the freshly
// reset offer is the newest, so the other clock becomes the next advertised offer.
function resetListing(market: Market, kind: keyof Listings, id: string, now: number) {
  const second = market.secondCopy?.[kind];
  market[kind][id] = second?.[id] ?? now;
  if (second) second[id] = now;
}

export interface Game {
  code: string;
  hostToken: string;
  createdAt: number;
  touchedAt: number;
  phase: Phase;
  round: number;
  endsAt: number | null;
  settings: Settings;
  players: Player[];
  teams: Team[];
  picks: Record<string, Picks>; // key `${teamId}|${round}`
  transfers: Transfer[];
  market: Market;
  feed: FeedItem[];
  /** each team's fuel reserve, kept across missions */
  fuelStock: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = { minutes: 4, income: 10, teamSize: 4, rounds: 6 };
export const LIMITS = { maxPlayers: 300, nameLength: 24, maxAddSeconds: 600, feedKept: 60 };

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
export function cleanSettings(s: Partial<Settings> = {}, base: Settings = DEFAULT_SETTINGS): Settings {
  return {
    minutes: Math.min(30, Math.max(0.5, Number(s.minutes ?? base.minutes) || base.minutes)),
    income: clampInt(s.income ?? base.income, 1, 10000, base.income),
    teamSize: clampInt(s.teamSize ?? base.teamSize, 1, 8, base.teamSize),
    rounds: clampInt(s.rounds ?? base.rounds, 1, 12, base.rounds),
  };
}

function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
const key = (team: string, round: number) => `${team}|${round}`;
const freshMarket = (now: number): Market => ({
  animals: Object.fromEntries(ANIMALS.map(a => [a.id, now])),
  rockets: Object.fromEntries(ROCKETS.map(r => [r.id, now])),
  fuelResetAt: now,
});

/* ---------- creation & lobby ---------- */
export function createGame(code: string, hostToken: string, now: number, settings?: Partial<Settings>): Game {
  return {
    code,
    hostToken,
    createdAt: now,
    touchedAt: now,
    phase: 'lobby',
    round: 0,
    endsAt: null,
    settings: cleanSettings(settings),
    players: [],
    teams: [],
    picks: {},
    transfers: [],
    market: freshMarket(now),
    feed: [],
    fuelStock: {},
  };
}

export function addPlayer(g: Game, id: string, token: string, rawName: string, now: number): Player {
  const name = String(rawName ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.nameLength);
  if (!name) fail('Enter a name to join.');
  if (g.players.length >= LIMITS.maxPlayers) fail('This game is full.');
  if (g.phase === 'final') fail('This game has finished.');
  const p = { id, token, name, joinedAt: now };
  g.players.push(p);
  return p;
}

export function removePlayer(g: Game, playerId: string) {
  if (g.phase !== 'lobby' && g.phase !== 'teams') fail('Players can only be removed before the first mission.');
  g.players = g.players.filter(p => p.id !== playerId);
  for (const t of g.teams) t.members = t.members.filter(m => m.playerId !== playerId);
  g.teams = g.teams.filter(t => t.members.length);
  for (const t of g.teams) assignRoles(t);
}

/** Every team covers all four roles; with fewer than 4 members, people double up. */
export function assignRoles(team: Team) {
  const k = team.members.length;
  team.members.forEach(m => (m.roles = []));
  if (k >= 4) team.members.forEach((m, i) => (m.roles = [ROLES[i % 4]!]));
  else ROLES.forEach((r, j) => team.members[j % k]!.roles.push(r));
}

/**
 * Random roles for a new mission, giving nobody the same role twice in a row when possible.
 * Random retries, keeping the best attempt: a team of 4 only gets a full reshuffle ~37% of the
 * time per try, so 200 tries make a miss astronomically unlikely, and if one ever happens we
 * keep the attempt with the fewest repeats rather than whatever came last.
 */
export function reshuffleRoles(team: Team, rng: Rng) {
  if (team.members.length < 2) return;
  const before = new Map(team.members.map(m => [m.playerId, m.roles.join()]));
  const repeats = () => team.members.filter(m => before.get(m.playerId) === m.roles.join()).length;
  let best = team.members,
    fewest = Infinity;
  for (let attempt = 0; attempt < 200 && fewest > 0; attempt++) {
    team.members = shuffle(team.members, rng);
    assignRoles(team);
    const n = repeats();
    if (n < fewest) {
      fewest = n;
      best = team.members.map(m => ({ ...m, roles: [...m.roles] }));
    }
  }
  team.members = best;
}

export function makeTeams(g: Game, rng: Rng, settings?: Partial<Settings>) {
  if (g.phase !== 'lobby' && g.phase !== 'teams') fail('Teams can only be made before the first mission.');
  if (!g.players.length) fail('Nobody has joined yet.');
  g.settings = cleanSettings(settings, g.settings);
  const ids = shuffle(
    g.players.map(p => p.id),
    rng,
  );
  const nTeams = Math.max(1, Math.round(ids.length / g.settings.teamSize));
  const names = shuffle(TEAM_NAMES, rng);
  g.teams = Array.from({ length: nTeams }, (_, i) => ({
    id: `t${i + 1}`,
    name: names[i % names.length]! + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ''),
    members: [],
  }));
  ids.forEach((id, i) => g.teams[i % nTeams]!.members.push({ playerId: id, roles: [] }));
  g.teams.forEach(assignRoles);
  g.picks = {};
  g.transfers = [];
  g.feed = [];
  g.fuelStock = {};
  g.round = 0;
  g.endsAt = null;
  g.phase = 'teams';
}

/** Put anyone who joined after teams were made onto the smallest team, in its least-covered role. */
export function seatLatecomers(g: Game) {
  if (!g.teams.length) fail('Make teams first.');
  if (g.phase === 'final') fail('The game is over.');
  for (const p of g.players) {
    if (teamOf(g, p.id)) continue;
    const t = g.teams.reduce((a, b) => (b.members.length < a.members.length ? b : a));
    const count = (r: Role) => t.members.filter(m => m.roles.includes(r)).length;
    const role = ROLES.reduce((a, b) => (count(b) < count(a) ? b : a));
    t.members.push({ playerId: p.id, roles: [role] });
  }
}

/* ---------- round flow (host) ---------- */
export function startRound(g: Game, now: number, rng: Rng, extraListingMinTeams?: number) {
  if (g.phase !== 'teams' && g.phase !== 'results') fail('A mission is already running.');
  if (g.round >= g.settings.rounds) fail('All missions are done. Show the final debrief.');
  if (g.round > 0) g.teams.forEach(t => reshuffleRoles(t, rng)); // mission 1 keeps the roles from the briefing
  g.round += 1;
  g.phase = 'play';
  g.endsAt = now + Math.round(g.settings.minutes * 60_000);
  g.market = freshMarket(now);
  if (extraListingMinTeams && g.teams.length >= extraListingMinTeams) {
    g.market.secondCopy = { animals: { ...g.market.animals }, rockets: { ...g.market.rockets } };
  }
}
export function endRound(g: Game) {
  if (g.phase !== 'play') fail('No mission is running.');
  g.phase = 'results';
  g.endsAt = null;
}
export function addTime(g: Game, seconds: number, now: number) {
  if (g.phase !== 'play' || g.endsAt == null) fail('No mission is running.');
  const s = clampInt(seconds, 1, LIMITS.maxAddSeconds, 60);
  g.endsAt = Math.max(g.endsAt!, now) + s * 1000;
}
export function finish(g: Game) {
  if (g.phase !== 'results') fail(g.phase === 'play' ? 'End the current mission first.' : 'Play at least one mission first.');
  g.phase = 'final';
}
export function newGame(g: Game, now: number) {
  g.phase = 'lobby';
  g.round = 0;
  g.endsAt = null;
  g.teams = [];
  g.picks = {};
  g.transfers = [];
  g.feed = [];
  g.fuelStock = {};
  g.market = freshMarket(now);
}

/* ---------- queries ---------- */
export function teamOf(g: Game, playerId: string): { team: Team; roles: Role[] } | undefined {
  for (const team of g.teams) {
    const m = team.members.find(x => x.playerId === playerId);
    if (m) return { team, roles: m.roles };
  }
  return undefined;
}
const EMPTY: Picks = Object.freeze({ fuel: 0, fuelGrabs: 0, spent: Object.freeze({ vet: 0, pilot: 0, engineer: 0 }) }) as Picks;
export const picksFor = (g: Game, team: string, round: number): Picks => g.picks[key(team, round)] ?? EMPTY;
export const launched = (g: Game, team: string, round: number) => picksFor(g, team, round).launchedAt != null;

/** The Captain gets `income` at the start of every mission reached so far; everything else moves by transfer or purchase. */
export function balance(g: Game, team: string, role: Role): number {
  let b = role === 'captain' ? g.settings.income * Math.max(1, g.round) : 0;
  for (const t of g.transfers)
    if (t.team === team) {
      if (t.to === role) b += t.amount;
      if (t.from === role) b -= t.amount;
    }
  if (role !== 'captain') for (const [k, p] of Object.entries(g.picks)) if (k.startsWith(`${team}|`)) b -= p.spent[role];
  return b;
}

export const fuelRateFor = (g: Game) => fuelRate(g.teams.length);
export const animalPriceNow = (g: Game, id: string, now: number) =>
  auctionPrice((animalById(id) ?? fail('Unknown animal.')).base, g.market.animals[id] ?? now, now);
export const rocketPriceNow = (g: Game, id: string, now: number) =>
  auctionPrice((rocketById(id) ?? fail('Unknown rocket.')).base, g.market.rockets[id] ?? now, now);
export const fuelPoolNow = (g: Game, now: number) => fuelInPool(g.market.fuelResetAt, fuelRateFor(g), now);

export const missionOpen = (g: Game, now: number) => g.phase === 'play' && g.endsAt != null && now < g.endsAt;
export const completedRounds = (g: Game) => (g.phase === 'results' || g.phase === 'final' ? g.round : Math.max(0, g.round - 1));

/* ---------- player actions ---------- */
function actor(g: Game, playerId: string, role: Role) {
  const t = teamOf(g, playerId) ?? fail("You're not on a team yet.");
  if (!t.roles.includes(role)) fail(`Only the ${role} can do that.`);
  return t.team;
}
function guardMission(g: Game, team: Team, now: number) {
  if (!missionOpen(g, now)) fail(g.phase === 'play' ? "Time's up for this mission." : 'No mission is running.');
  if (launched(g, team.id, g.round)) fail('Your rocket already launched.');
}
function slot(g: Game, team: string): Picks {
  const k = key(team, g.round);
  g.picks[k] ??= { fuel: 0, fuelGrabs: 0, spent: { vet: 0, pilot: 0, engineer: 0 } };
  return g.picks[k];
}
function log(g: Game, now: number, team: Team, kind: FeedItem['kind'], text: string) {
  if (kind !== 'launch') slot(g, team.id).lastPurchase = text.replace(/^bought /, '');
  g.feed.push({ at: now, round: g.round, teamName: team.name, kind, text });
  if (g.feed.length > LIMITS.feedKept) g.feed.splice(0, g.feed.length - LIMITS.feedKept);
}
const afford = (g: Game, team: Team, role: Role, cost: number) => {
  if (cost > balance(g, team.id, role)) fail('Not enough money in your wallet. Ask the Captain.');
};

export function transfer(g: Game, playerId: string, from: Role, to: Role, amount: number, now: number) {
  if (!ROLES.includes(from) || !ROLES.includes(to)) fail('Unknown role.');
  if (from === to) fail('Pick someone else to send money to.');
  if (!['teams', 'play', 'results'].includes(g.phase)) fail("Money can't move right now.");
  const team = actor(g, playerId, from);
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) fail('Enter an amount above zero.');
  if (amt > balance(g, team.id, from)) fail("You don't have that much.");
  g.transfers.push({ team: team.id, from, to, amount: amt, round: g.round, at: now });
}

export function buyAnimal(g: Game, playerId: string, animalId: string, maxPrice: number, now: number) {
  const team = actor(g, playerId, 'vet');
  guardMission(g, team, now);
  const a = animalById(animalId) ?? fail('Unknown animal.');
  const price = animalPriceNow(g, a.id, now);
  if (Number.isFinite(Number(maxPrice)) && price > Number(maxPrice))
    fail(`Price jumped to $${price}: another team just bought ${a.name.toLowerCase()}.`);
  afford(g, team, 'vet', price);
  const s = slot(g, team.id);
  s.animal = a.id;
  s.spent.vet += price;
  resetListing(g.market, 'animals', a.id, now);
  log(g, now, team, 'animal', `bought ${a.emoji} ${a.name} for $${price}`);
  return price;
}

export function buyRocket(g: Game, playerId: string, rocketId: string, maxPrice: number, now: number) {
  const team = actor(g, playerId, 'pilot');
  guardMission(g, team, now);
  const r = rocketById(rocketId) ?? fail('Unknown rocket.');
  const price = rocketPriceNow(g, r.id, now);
  if (Number.isFinite(Number(maxPrice)) && price > Number(maxPrice))
    fail(`Price jumped to $${price}: another team just bought a ${r.name}.`);
  afford(g, team, 'pilot', price);
  const s = slot(g, team.id);
  s.rocket = r.id;
  s.spent.pilot += price;
  resetListing(g.market, 'rockets', r.id, now);
  log(g, now, team, 'rocket', `bought a ${r.name} for $${price}`);
  return price;
}

export const fuelStockOf = (g: Game, team: string) => g.fuelStock[team] ?? 0;

/** Takes everything in the shared pool into the team's stock for a flat price, and empties it for every engineer. */
export function buyFuel(g: Game, playerId: string, minUnits: number, now: number) {
  const team = actor(g, playerId, 'engineer');
  guardMission(g, team, now);
  const units = fuelPoolNow(g, now);
  if (units < 1) fail('The fuel pool is empty. Give it a few seconds to fill.');
  const min = Math.max(1, Math.floor(Number(minUnits) || 1));
  if (units < Math.ceil(min / 2)) fail(`Another engineer just took the fuel. Only ${units} units left in the pool.`);
  afford(g, team, 'engineer', FUEL.grabCost);
  const s = slot(g, team.id);
  s.fuelGrabs += 1;
  s.spent.engineer += FUEL.grabCost;
  g.fuelStock[team.id] = fuelStockOf(g, team.id) + units;
  g.market.fuelResetAt = now;
  log(g, now, team, 'fuel', `bought ${units} fuel for $${FUEL.grabCost}`);
  return units;
}

/** Loads fuel from the team's stock into this mission's rocket, FUEL_SEND_STEP units at a time. */
export function sendFuel(g: Game, playerId: string, now: number) {
  const team = actor(g, playerId, 'engineer');
  guardMission(g, team, now);
  const n = Math.min(FUEL_SEND_STEP, fuelStockOf(g, team.id));
  if (n < 1) fail('No fuel in stock. Buy from the market first.');
  g.fuelStock[team.id] = fuelStockOf(g, team.id) - n;
  slot(g, team.id).fuel += n;
  return n;
}

export function launch(g: Game, playerId: string, now: number) {
  const team = actor(g, playerId, 'captain');
  guardMission(g, team, now);
  const s = slot(g, team.id);
  if (!s.animal || !s.rocket || !s.fuel) fail('You need an animal, a rocket and fuel sent to the mission before you can launch.');
  s.launchedAt = now;
  s.launchMsLeft = g.endsAt! - now;
  log(g, now, team, 'launch', 'launched! 🚀');
}

export const allLaunched = (g: Game) => g.phase === 'play' && g.teams.every(t => launched(g, t.id, g.round));

/** Shared-screen totals for the current mission. */
export function missionStats(g: Game) {
  const r = g.round;
  let distributed = 0,
    spent = 0,
    nLaunched = 0;
  for (const t of g.transfers) if (t.round === r && t.from === 'captain') distributed += t.amount;
  for (const t of g.teams) {
    const p = picksFor(g, t.id, r);
    spent += p.spent.vet + p.spent.pilot + p.spent.engineer;
    if (p.launchedAt != null) nLaunched++;
  }
  return { distributed, spent, launched: nLaunched, teams: g.teams.length };
}

/* ---------- scoring ---------- */
export function outcomes(g: Game, upTo = completedRounds(g)) {
  const res: Outcome[][] = [];
  const totals: Record<string, number> = {};
  const species = new Set<string>();
  for (const t of g.teams) totals[t.id] = 0;
  for (let r = 1; r <= upTo; r++) {
    const row: Outcome[] = [];
    for (const t of g.teams) {
      const p = picksFor(g, t.id, r);
      const a = p.animal ? animalById(p.animal) : undefined,
        rk = p.rocket ? rocketById(p.rocket) : undefined;
      const o: Outcome = {
        team: t.id,
        teamName: t.name,
        round: r,
        status: 'scrubbed',
        message: 'Never launched',
        points: 0,
        animal: a && { id: a.id, name: a.name, emoji: a.emoji, size: a.size },
        rocket: rk && { name: rk.name, size: rk.size, fuel: rk.fuel },
        fuel: p.fuel,
        spent: p.spent.vet + p.spent.pilot + p.spent.engineer,
      };
      if (p.launchedAt != null && a && rk) {
        if (!fits(a.size, rk.size)) {
          o.status = 'failed';
          o.message = `The ${a.name.toLowerCase()} (${a.size}) didn't fit in the ${rk.name} (${rk.size})`;
        } else if (p.fuel < rk.fuel) {
          o.status = 'failed';
          o.message = `Ran out of fuel (${p.fuel} of ${rk.fuel} needed)`;
        } else {
          o.status = 'landed';
          o.points = a.points;
          o.message = `${a.name} landed safely`;
          species.add(a.id);
        }
      }
      totals[t.id]! += o.points;
      row.push(o);
    }
    res.push(row);
  }
  const standings: Standing[] = g.teams.map(t => ({ team: t.id, name: t.name, points: totals[t.id]! })).sort((a, b) => b.points - a.points);
  const groupPoints = standings.reduce((s, x) => s + x.points, 0);
  const target = Math.max(1, g.teams.length * g.settings.rounds * TERRAFORM_POINTS_PER_TEAM_ROUND);
  return { rounds: res, totals, standings, species, groupPoints, target };
}

export const SPECIES_TOTAL = ANIMALS.length;
