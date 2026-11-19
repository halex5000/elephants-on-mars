// Wire protocol shared by server and client. TYPES ONLY: nothing here may hold
// game data, so importing it from the client can never leak hidden info.

export type Role = 'captain' | 'vet' | 'pilot' | 'engineer';
export const ROLES: readonly Role[] = ['captain', 'vet', 'pilot', 'engineer'];
export type Phase = 'lobby' | 'teams' | 'play' | 'results' | 'final';

/** income = money the Captain receives at the start of every mission (unspent money carries over) */
export interface Settings {
  minutes: number;
  income: number;
  teamSize: number;
  rounds: number;
}

/* ---------- client -> server ---------- */
export type Action =
  | { a: 'makeTeams'; settings?: Partial<Settings> }
  | { a: 'startRound' }
  | { a: 'endRound' }
  | { a: 'finish' }
  | { a: 'newGame' }
  | { a: 'addTime'; seconds: number }
  | { a: 'seatLatecomers' }
  | { a: 'removePlayer'; playerId: string }
  | { a: 'transfer'; from: Role; to: Role; amount: number }
  /** maxPrice: the price the player saw; refused if someone reset the auction meanwhile */
  | { a: 'buyAnimal'; animal: string; maxPrice: number }
  | { a: 'buyRocket'; rocket: string; maxPrice: number }
  /** Takes the shared pool into the team's stock. minUnits: refused if someone else emptied it since the player looked */
  | { a: 'buyFuel'; minUnits: number }
  /** Moves up to 10 units from the team's stock into this mission's rocket */
  | { a: 'sendFuel' }
  | { a: 'launch' };

export type ClientMsg =
  | { t: 'create'; settings?: Partial<Settings>; passcode?: string }
  | { t: 'host'; code: string; hostToken: string }
  /** Read-only projector view: the host's screen without controls. Needs the host token. */
  | { t: 'screen'; code: string; hostToken: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; playerId: string; token: string }
  | { t: 'act'; action: Action }
  | { t: 'ping' };

/* ---------- server -> client ---------- */
export interface Outcome {
  team: string;
  teamName: string;
  round: number;
  status: 'landed' | 'failed' | 'scrubbed';
  message: string;
  points: number;
  animal?: { id: string; name: string; emoji: string; size: string };
  rocket?: { name: string; size: string; fuel: number };
  fuel: number;
  spent: number;
}
export interface Standing {
  team: string;
  name: string;
  points: number;
}
export interface RoundSummary {
  receipt?: string;
  round: number;
  outcomes: Outcome[];
}
export interface Terraform {
  points: number;
  target: number;
  pct: number;
  species: { name: string; emoji: string }[];
  speciesTotal: number;
}
export interface FinalSummary {
  winner?: string;
  topPoints: number;
  failed: number;
  scrubbed: number;
  byRound: { team: string; name: string; points: number[]; total: number; wins: number[]; landed: { name: string; emoji: string }[] }[];
}
/** fuel = enough fuel has been sent to the mission (or any, if the rocket isn't known yet) */
export interface TeamStatus {
  animal: boolean;
  rocket: boolean;
  fuel: boolean;
  launched: boolean;
}
/** Public, game-wide activity: what the original shows on the big shared screen. */
export interface FeedItem {
  at: number;
  round: number;
  teamName: string;
  kind: 'animal' | 'rocket' | 'fuel' | 'launch';
  text: string;
}
/** Shared-screen totals for the current mission, across every team. */
export interface MissionStats {
  distributed: number;
  spent: number;
  launched: number;
  teams: number;
}
/** Live fuel pool. Client computes the current amount with fuelInPool(resetAt, ratePerSec, now). */
export interface FuelMarket {
  resetAt: number;
  ratePerSec: number;
  grabCost: number;
}

export interface Common {
  code: string;
  phase: Phase;
  round: number;
  totalRounds: number;
  endsAt: number | null;
  serverNow: number;
  settings: Settings;
  /** game-clock speed vs real time (1 in real games; >1 only for demos/tests via GAME_SPEED) */
  speed: number;
  results: RoundSummary[];
  standings: Standing[];
  terraform: Terraform;
  final?: FinalSummary;
  feed: FeedItem[];
  stats: MissionStats;
}

export interface HostView extends Common {
  kind: 'host';
  players: { id: string; name: string; connected: boolean; seated: boolean }[];
  teams: { id: string; name: string; members: { name: string; roles: Role[]; connected: boolean }[]; status: TeamStatus }[];
  fuel?: FuelMarket;
}

/** Auction listings carry base + resetAt; the client computes the live price with auctionPrice(). */
export interface CaptainConsole {
  picks: { animal?: string; rocket?: string; fuel?: number };
}
export interface VetConsole {
  animals: { id: string; name: string; emoji: string; size: string; points: number; base: number; resetAt: number }[];
  bought?: string;
}
export interface PilotConsole {
  rockets: { id: string; name: string; size: string; fuel: number; base: number; resetAt: number }[];
  bought?: string;
}
/** stock = the team's fuel reserve (carries over between missions); sent = fuel loaded into this mission's rocket */
export interface EngineerConsole {
  market: FuelMarket;
  stock: number;
  sent: number;
  sendStep: number;
}

export interface PlayerView extends Common {
  kind: 'player';
  me: { id: string; name: string };
  team?: {
    id: string;
    name: string;
    roles: Role[];
    roster: { role: Role; names: string[]; balance: number }[];
    status: TeamStatus;
  };
  console?: { captain?: CaptainConsole; vet?: VetConsole; pilot?: PilotConsole; engineer?: EngineerConsole };
}

export type ServerMsg =
  | { t: 'created'; code: string; hostToken: string }
  | { t: 'joined'; code: string; playerId: string; token: string }
  | { t: 'view'; view: HostView | PlayerView }
  | { t: 'error'; message: string; fatal?: boolean; needPasscode?: boolean }
  | { t: 'pong' };
