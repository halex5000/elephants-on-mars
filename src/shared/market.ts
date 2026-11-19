// Live-market math, shared by server (authoritative) and client (smooth ticking).
// Pure arithmetic only: no catalog data lives here, so the client can import it.
//
// From the original game: "if you wait you'll get a better deal, but when anyone
// in the game buys, it resets." Two shapes of that idea:
//  - Countdown auction (animals, rockets): each listing's price drifts from HIGH
//    down to FLOOR; any team buying that listing snaps it back to HIGH for everyone.
//  - Fuel pool: one pool shared by every engineer that fills up over time; a
//    purchase takes the whole pool for a flat price and empties it.

export const AUCTION = {
  highMult: 1.5,   // price right after a reset, × base
  floorMult: 0.5,  // lowest it drifts to, × base
  decayMs: 90_000, // time to drift from high to floor
};

export const FUEL = {
  grabCost: 1,          // flat price of one purchase, however much is in the pool ("BUY $1")
  ratePerTeam: 0.6,     // units per second the pool fills, per team in the game
  minRate: 1,           // so small games still fill at a playable pace
  cap: 400,             // pool never holds more than this
};

/** Whole dollars, never below $1. */
export function auctionPrice(base: number, resetAt: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - resetAt) / AUCTION.decayMs));
  const high = base * AUCTION.highMult, floor = base * AUCTION.floorMult;
  return Math.max(1, Math.round(high - (high - floor) * t));
}

export const fuelRate = (teams: number) => Math.max(FUEL.minRate, FUEL.ratePerTeam * teams);

export function fuelInPool(resetAt: number, ratePerSec: number, now: number): number {
  return Math.min(FUEL.cap, Math.floor((Math.max(0, now - resetAt) / 1000) * ratePerSec));
}
