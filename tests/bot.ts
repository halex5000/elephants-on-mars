// A WebSocket client that plays the game like a person would: it only knows what
// the server shows its role, and learns everything else from its team's "radio"
// (standing in for the breakout-room voice chat).
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg, PlayerView, HostView, Role, Action } from '../src/shared/protocol.js';

export class Client {
  ws: WebSocket;
  view: PlayerView | HostView | null = null;
  raw: string[] = [];
  errors: string[] = [];
  creds: { code: string; playerId?: string; token?: string; hostToken?: string } | null = null;
  private waiters: { pred: () => boolean; resolve: () => void }[] = [];
  opened: Promise<void>;
  closed = false;
  /** Keep every raw message (for leak tests). Off for load tests to save memory. */
  keepRaw = true;

  constructor(
    public url: string,
    public onView?: (c: Client) => void,
  ) {
    this.ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
    this.opened = new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
    this.ws.on('message', d => {
      const s = String(d);
      if (this.keepRaw) this.raw.push(s);
      const m = JSON.parse(s) as ServerMsg;
      if (m.t === 'view') this.view = m.view;
      if (m.t === 'error') this.errors.push(m.message);
      if (m.t === 'created') this.creds = { code: m.code, hostToken: m.hostToken };
      if (m.t === 'joined') this.creds = { code: m.code, playerId: m.playerId, token: m.token };
      if (m.t === 'view' && this.onView) this.onView(this);
      this.waiters = this.waiters.filter(w => {
        if (!w.pred()) return true;
        w.resolve();
        return false;
      });
    });
    this.ws.on('close', () => {
      this.closed = true;
      this.waiters.forEach(w => w.pred() && w.resolve());
    });
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  act(action: Action) {
    this.send({ t: 'act', action });
  }
  until(pred: () => boolean, ms = 5000, label = 'condition'): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}; last errors: ${this.errors.slice(-3).join(' | ')}`)),
        ms,
      );
      this.waiters.push({
        pred,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
  get pv() {
    return this.view as PlayerView;
  }
  get hv() {
    return this.view as HostView;
  }
}

export async function host(url: string) {
  const c = new Client(url);
  await c.opened;
  c.send({ t: 'create' });
  await c.until(() => c.view?.kind === 'host', 5000, 'host view');
  return c;
}
export async function join(url: string, code: string, name: string, onView?: (c: Client) => void, keepRaw = true) {
  const c = new Client(url, onView);
  c.keepRaw = keepRaw;
  await c.opened;
  c.send({ t: 'join', code, name });
  await c.until(() => c.view?.kind === 'player', 5000, `${name} joined`);
  return c;
}

/* ---------- team radio + playing strategy ---------- */
import { auctionPrice, fuelInPool } from '../src/shared/market.js';

/** What a team has said out loud in its breakout room this mission. */
export interface Radio {
  round: number;
  size?: string;
  fuelNeed?: number;
  onBoard?: number;
}
const RANK = ['S', 'M', 'L', 'XL'];
export type Strategy = (round: number, teamIndex: number) => string; // which animal the vet buys

export interface BotOpts {
  /** Game clock, shared with an in-process server (lets tests fast-forward time). */
  clock?: () => number;
  /** Pilot ignores the Vet and buys the smallest rocket. */
  tinyRocket?: boolean;
  /** Engineer won't grab until the pool holds at least this much (or what's still needed, if less). */
  patience?: number;
}

/** Returns an onView handler that plays its roles competently. `radios` is shared per team id. */
export function playBot(radios: Map<string, Radio>, pickAnimal: Strategy = () => 'giraffe', opts: BotOpts = {}) {
  const clock = opts.clock ?? Date.now;
  const patience = opts.patience ?? 40;
  // Teammates "talk" asynchronously, so every bot re-checks the radio a few times a second.
  const clients = new Set<Client>();
  const lastTry = new Map<string, number>();
  const attempt = (k: string, fn: () => void, gapMs = 400) => {
    const t = Date.now();
    if (t - (lastTry.get(k) ?? 0) < gapMs) return;
    lastTry.set(k, t);
    fn();
  };
  let timer: NodeJS.Timeout | undefined;
  const step = (c: Client) => {
    if (c.closed) {
      clients.delete(c);
      return;
    }
    if (!clients.has(c)) {
      clients.add(c);
      timer ??= setInterval(() => {
        clients.forEach(step);
        if (!clients.size) {
          clearInterval(timer);
          timer = undefined;
        }
      }, 40);
      timer.unref();
    }
    const v = c.view;
    if (v?.kind !== 'player' || !v.team || v.phase !== 'play' || !v.console) return;
    const t = v.team,
      r = v.round,
      now = clock();
    let radio = radios.get(t.id);
    if (!radio || radio.round !== r) {
      radio = { round: r };
      radios.set(t.id, radio);
    }
    const has = (role: Role) => t.roles.includes(role);
    const bal = (role: Role) => t.roster.find(x => x.role === role)!.balance;
    const ti = Number(t.id.slice(1)) - 1;

    if (has('captain')) {
      const cap = v.console.captain!;
      const want: [Role, number][] = [
        ['vet', 12],
        ['pilot', 12],
        ['engineer', 8],
      ];
      let capLeft = bal('captain'); // spend from one running total, not the same stale balance three times
      for (const [role, amt] of want) {
        const top = Math.min(amt - bal(role), capLeft);
        capLeft -= Math.max(0, top);
        if (top > 0) attempt(`fund${r}${role}`, () => c.act({ a: 'transfer', from: 'captain', to: role, amount: top }), 1500);
      }
      const enough = radio.fuelNeed != null && (radio.onBoard ?? 0) >= radio.fuelNeed;
      if (cap.picks.animal && cap.picks.rocket && cap.picks.fuel && enough && !t.status.launched)
        attempt(`launch${r}`, () => c.act({ a: 'launch' }), 1000);
    }
    if (has('vet')) {
      const vet = v.console.vet!;
      const want = pickAnimal(r, ti);
      const a = vet.animals.find(x => x.id === want)!;
      if (!vet.bought) {
        const price = auctionPrice(a.base, a.resetAt, now);
        if (price <= bal('vet')) attempt(`animal${r}`, () => c.act({ a: 'buyAnimal', animal: want, maxPrice: price + 2 }));
      } else radio.size = vet.animals.find(x => x.id === vet.bought)!.size;
    }
    if (has('pilot') && radio.size != null) {
      const p = v.console.pilot!;
      const need = RANK.indexOf(radio.size);
      const fit = (opts.tinyRocket ? [...p.rockets] : p.rockets.filter(k => RANK.indexOf(k.size) >= need)).sort(
        (x, y) => RANK.indexOf(x.size) - RANK.indexOf(y.size) || x.fuel - y.fuel,
      )[0]!;
      if (!p.bought) {
        const price = auctionPrice(fit.base, fit.resetAt, now);
        if (price <= bal('pilot')) attempt(`rocket${r}`, () => c.act({ a: 'buyRocket', rocket: fit.id, maxPrice: price + 2 }));
      } else radio.fuelNeed = p.rockets.find(k => k.id === p.bought)!.fuel;
    }
    if (has('engineer')) {
      const e = v.console.engineer!;
      radio.onBoard = e.sent;
      if (radio.fuelNeed != null) {
        const still = radio.fuelNeed - e.sent;
        const pool = fuelInPool(e.market.resetAt, e.market.ratePerSec, now);
        if (still > 0 && e.stock > 0) attempt(`send${r}`, () => c.act({ a: 'sendFuel' }), 150);
        else if (still > 0 && pool >= Math.min(still - e.stock, patience) && bal('engineer') >= e.market.grabCost)
          attempt(`fuel${r}`, () => c.act({ a: 'buyFuel', minUnits: pool }), 300);
      }
    }
  };
  return step;
}

/** A clock that runs `speed` times faster than real time, for in-process server + bots. */
export function fastClock(speed: number) {
  const start = Date.now();
  return () => start + (Date.now() - start) * speed;
}
