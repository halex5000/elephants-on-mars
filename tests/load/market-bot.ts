import type { Client } from '../bot.js';
import type { Role } from '../../src/shared/protocol.js';
import { auctionPrice, fuelInPool } from '../../src/shared/market.js';

export interface Crew {
  team: string;
  switchedAnimal?: boolean;
  extraPilotDollar?: boolean;
  // Teammates communicate their selected animal size and purchased rocket's fuel requirement.
  size?: string;
  need?: number;
  openingStock?: number;
  firstAttempt?: number;
  firstFuel?: number;
  ready?: number;
  rocketAttempts: number;
  rocketFailures: number;
}

const sizes = ['S', 'M', 'L', 'XL'];
const funding: Role[] = ['engineer', 'pilot', 'vet', 'pilot', 'vet', 'engineer', 'pilot', 'vet', 'pilot', 'vet'];
const animals = ['cat', 'kangaroo', 'rhino', 'penguin', 'gorilla', 'elephant', 'rabbit', 'croc', 'hippo', 'giraffe'];

// Each role acts from its own WebSocket view. Observe the last action before sending another.
export function marketBot(client: Client, crew: Crew, variant: number, clock: () => number, adaptive = false) {
  let next = 0,
    dollarsSent = 0,
    errorIndex = client.errors.length;
  let confirmed: (() => boolean) | undefined;
  const desired = animals[variant % animals.length]!;
  const unexpected: string[] = [];

  function observe() {
    const v = client.pv;
    const engineer = v.console?.engineer;
    if (engineer) {
      crew.openingStock ??= engineer.stock + engineer.sent;
      if (engineer.stock + engineer.sent > crew.openingStock) crew.firstFuel ??= v.serverNow;
    }
    for (const error of client.errors.slice(errorIndex)) {
      if (v.team?.roles.includes('pilot')) crew.rocketFailures++;
      if (!/Price jumped|just took the fuel|pool is empty|Time's up|No mission is running/.test(error)) unexpected.push(error);
      confirmed = undefined;
    }
    errorIndex = client.errors.length;
  }

  function step() {
    observe();
    const v = client.pv,
      team = v.team,
      consoles = v.console;
    const now = clock();
    if (!team || !consoles || !v.endsAt || now >= v.endsAt || team.status.launched || now < next) return;
    // Vary reaction times by team, role and action; retry stale prices on the next decision.
    next = now + 900 + ((variant * 271 + Math.floor(now % 997)) % 1100);
    if (confirmed && !confirmed()) return;
    confirmed = undefined;
    const balance = (role: Role) => team.roster.find(r => r.role === role)!.balance;
    if (consoles.captain) {
      let to = funding[dollarsSent];
      if (adaptive && dollarsSent === funding.length - 1 && team.status.animal && !team.status.rocket) {
        to = 'pilot';
        crew.extraPilotDollar = true;
      }
      if (to && balance('captain') >= 1) {
        const before = balance('captain');
        client.act({ a: 'transfer', from: 'captain', to, amount: 1 });
        dollarsSent++;
        confirmed = () => client.pv.team!.roster.find(r => r.role === 'captain')!.balance < before;
      } else if (team.status.animal && team.status.rocket && team.status.fuel) {
        client.act({ a: 'launch' });
        confirmed = () => client.pv.team!.status.launched;
      }
    }
    if (consoles.vet) {
      const vet = consoles.vet;
      const preferred = vet.animals.find(a => a.id === desired)!;
      let animal = preferred;
      // Once a minute has elapsed, accept an affordable smaller payload. It also
      // fits a rocket the Pilot may already be buying for the original target.
      if (adaptive && !vet.bought && now >= v.endsAt - 180_000 && auctionPrice(preferred.base, preferred.resetAt, now) > balance('vet')) {
        animal =
          vet.animals
            .filter(a => sizes.indexOf(a.size) <= sizes.indexOf(preferred.size) && auctionPrice(a.base, a.resetAt, now) <= balance('vet'))
            .sort((a, b) => b.points - a.points)[0] ?? preferred;
      }
      if (vet.bought) {
        animal = vet.animals.find(a => a.id === vet.bought)!;
        crew.switchedAnimal = animal.id !== desired;
      }
      crew.size = vet.bought ? animal.size : preferred.size;
      const price = auctionPrice(animal.base, animal.resetAt, now);
      if (!consoles.vet.bought && price <= balance('vet')) {
        client.act({ a: 'buyAnimal', animal: animal.id, maxPrice: price });
        confirmed = () => Boolean(client.pv.console?.vet?.bought);
      }
    }
    if (consoles.pilot && crew.size) {
      const pilot = consoles.pilot;
      if (pilot.bought) crew.need = pilot.rockets.find(r => r.id === pilot.bought)!.fuel;
      else {
        const fit = pilot.rockets
          .filter(r => sizes.indexOf(r.size) >= sizes.indexOf(crew.size!))
          .map(rocket => ({ rocket, price: auctionPrice(rocket.base, rocket.resetAt, now) }))
          .filter(r => r.price <= balance('pilot'))
          .sort((a, b) => a.rocket.fuel - b.rocket.fuel)[0];
        if (fit) {
          crew.rocketAttempts++;
          client.act({ a: 'buyRocket', rocket: fit.rocket.id, maxPrice: fit.price });
          confirmed = () => Boolean(client.pv.console?.pilot?.bought);
        }
      }
    }
    if (consoles.engineer && crew.need) {
      const e = consoles.engineer;
      if (e.sent >= crew.need) return;
      if (e.stock > 0) {
        client.act({ a: 'sendFuel' });
        confirmed = () => (client.pv.console?.engineer?.sent ?? 0) > e.sent;
      } else if (balance('engineer') >= e.market.grabCost) {
        crew.ready ??= now;
        const pool = fuelInPool(e.market.resetAt, e.market.ratePerSec, now);
        // Two fuel dollars. Aim to cover the remaining requirement with one grab.
        if (pool >= crew.need - e.sent) {
          crew.firstAttempt ??= now;
          client.act({ a: 'buyFuel', minUnits: pool });
          confirmed = () => (client.pv.console?.engineer?.stock ?? 0) > 0;
        }
      }
    }
  }
  return { step, observe, unexpected };
}
