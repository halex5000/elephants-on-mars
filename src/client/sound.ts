// Sound effects, synthesized with Web Audio: no audio files, nothing fetched, nothing leaves the server.
//
// Two audiences. The projector and host screens carry room-wide cues (what the whole room should hear).
// Phones carry only quieter personal cues about their own team, so a room full of phones never
// echoes the projector. The mapping from game events to cues is pure and tested; only `play` touches Web Audio.
import type { HostView, PlayerView } from '../shared/protocol.js';

export type Audience = 'room' | 'personal';
export type Cue = 'tick' | 'bid' | 'outbid' | 'won' | 'purchase' | 'launch' | 'landed' | 'failed' | 'results';

/** Which cues each kind of device may play. Disjoint on purpose except for the team-outcome cues, which differ in loudness. */
export const AUDIENCE_CUES: Record<Audience, readonly Cue[]> = {
  room: ['tick', 'purchase', 'launch', 'landed', 'failed', 'results'],
  personal: ['bid', 'outbid', 'won', 'launch', 'landed', 'failed', 'results'],
};
/** Phones are quieter than the room speaker. */
export const AUDIENCE_GAIN: Record<Audience, number> = { room: 1, personal: 0.35 };
export const DEDUPE_MS = 100;
export const audienceOf = (kind: 'host' | 'player'): Audience => (kind === 'host' ? 'room' : 'personal');

/* ---------- the sounds themselves (data, so tests can check lengths) ---------- */
interface Voice {
  at: number; // seconds after the cue starts
  dur: number;
  wave: OscillatorType | 'noise';
  from: number; // Hz (noise: low-pass cutoff)
  to?: number;
  gain: number;
}
export const CUES: Record<Cue, Voice[]> = {
  tick: [{ at: 0, dur: 0.07, wave: 'square', from: 1200, gain: 0.25 }],
  bid: [{ at: 0, dur: 0.09, wave: 'sine', from: 520, to: 700, gain: 0.5 }],
  outbid: [
    { at: 0, dur: 0.14, wave: 'triangle', from: 380, gain: 0.5 },
    { at: 0.13, dur: 0.22, wave: 'triangle', from: 250, to: 200, gain: 0.5 },
  ],
  won: [
    { at: 0, dur: 0.12, wave: 'sine', from: 523, gain: 0.5 },
    { at: 0.1, dur: 0.12, wave: 'sine', from: 659, gain: 0.5 },
    { at: 0.2, dur: 0.25, wave: 'sine', from: 880, gain: 0.5 },
  ],
  purchase: [
    { at: 0, dur: 0.1, wave: 'sine', from: 1319, gain: 0.35 },
    { at: 0.09, dur: 0.22, wave: 'sine', from: 1760, gain: 0.35 },
  ],
  launch: [
    { at: 0, dur: 2.2, wave: 'noise', from: 200, to: 2600, gain: 0.5 },
    { at: 0, dur: 2.2, wave: 'sawtooth', from: 50, to: 160, gain: 0.3 },
  ],
  landed: [
    { at: 0, dur: 0.18, wave: 'triangle', from: 523, gain: 0.5 },
    { at: 0.14, dur: 0.18, wave: 'triangle', from: 659, gain: 0.5 },
    { at: 0.28, dur: 0.4, wave: 'triangle', from: 784, gain: 0.5 },
  ],
  failed: [
    { at: 0, dur: 0.7, wave: 'sawtooth', from: 330, to: 90, gain: 0.3 },
    { at: 0, dur: 0.7, wave: 'noise', from: 1500, to: 150, gain: 0.25 },
  ],
  results: [
    { at: 0, dur: 0.25, wave: 'triangle', from: 392, gain: 0.45 },
    { at: 0.22, dur: 0.25, wave: 'triangle', from: 523, gain: 0.45 },
    { at: 0.44, dur: 0.25, wave: 'triangle', from: 659, gain: 0.45 },
    { at: 0.66, dur: 1.0, wave: 'triangle', from: 784, gain: 0.5 },
  ],
};
export const cueLength = (c: Cue) => Math.max(...CUES[c].map(v => v.at + v.dur));

/* ---------- game events -> cues (pure) ---------- */
type View = HostView | PlayerView;
const feedKey = (f: { at: number; teamName: string; text: string }) => `${f.at}|${f.teamName}|${f.text}`;

/** Cues for a successful or failed landing, in the order a person should hear them. */
function landingCues(statuses: string[]): Cue[] {
  const out: Cue[] = [];
  if (statuses.includes('landed')) out.push('landed');
  if (statuses.some(s => s !== 'landed')) out.push('failed');
  return out;
}

/**
 * What changed between two views of the same game, as cues for this kind of viewer.
 * First view, or a different game: nothing (a reload or late join must not replay history).
 * Bids and outbids aren't here: they come from this player's own actions and the server's refusals.
 */
export function cuesBetween(prev: View | null, next: View): Cue[] {
  if (!prev || prev.code !== next.code || prev.kind !== next.kind) return [];
  const out: Cue[] = [];
  const newResult = next.results.length > prev.results.length ? next.results[next.results.length - 1] : undefined;

  if (next.kind === 'host' && prev.kind === 'host') {
    if (next.phase === 'play' && prev.round === next.round) {
      const seen = new Set(prev.feed.map(feedKey));
      if (next.feed.some(f => f.kind !== 'launch' && !seen.has(feedKey(f)))) out.push('purchase');
      const before = new Set(prev.teams.filter(t => t.status.launched).map(t => t.id));
      if (next.teams.some(t => t.status.launched && !before.has(t.id))) out.push('launch');
    }
    if (newResult) out.push(...landingCues(newResult.outcomes.map(o => o.status)), 'results');
  } else if (next.kind === 'player' && prev.kind === 'player') {
    const was = prev.team,
      now = next.team;
    if (was && now && was.id === now.id && prev.round === next.round) {
      const c = next.console,
        p = prev.console;
      const bought = (c?.vet?.bought && c.vet.bought !== p?.vet?.bought) || (c?.pilot?.bought && c.pilot.bought !== p?.pilot?.bought);
      const fuel = (c?.engineer?.stock ?? 0) > (p?.engineer?.stock ?? 0);
      if (bought || fuel) out.push('won');
      if (now.status.launched && !was.status.launched) out.push('launch');
    }
    if (newResult && now) {
      const mine = newResult.outcomes.find(o => o.team === now.id);
      if (mine) out.push(...landingCues([mine.status]));
      out.push('results');
    }
  }
  return out;
}

/** The mission clock: one tick per second for the last five seconds, once each. */
export function tickFor(secsLeft: number, lastTicked: number): Cue | null {
  return secsLeft >= 1 && secsLeft <= 5 && secsLeft !== lastTicked ? 'tick' : null;
}

/** The server refused a purchase because someone else got there first. */
export function cueForError(message: string): Cue | null {
  return /^price jumped|^another engineer just took/i.test(message) ? 'outbid' : null;
}

/** Drops a cue played again within DEDUPE_MS of the same cue. */
export function createDeduper(windowMs = DEDUPE_MS) {
  const last = new Map<Cue, number>();
  return (cue: Cue, nowMs: number): boolean => {
    const t = last.get(cue);
    if (t !== undefined && nowMs - t < windowMs) return false;
    last.set(cue, nowMs);
    return true;
  };
}

/* ---------- mute preference (per device, per audience) ---------- */
const KEY: Record<Audience, string> = { room: 'eom-sound-room', personal: 'eom-sound-personal' };
/** Host/projector start on; phones start muted until someone turns sound on. */
export function loadEnabled(a: Audience, storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  let v: string | null = null;
  try {
    v = storage?.getItem(KEY[a]) ?? null;
  } catch {
    /* private mode */
  }
  return v === 'on' ? true : v === 'off' ? false : a === 'room';
}
export function saveEnabled(a: Audience, on: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(KEY[a], on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/* ---------- Web Audio (browser only) ---------- */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
const allow = createDeduper();

/** Browsers refuse to make sound before a tap or key press; call from a gesture handler. */
export function unlock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no Web Audio: stay silent
  }
}

/** Plays cues in order, each after the previous one finishes. Does nothing in a hidden tab or before unlock. */
export function play(cues: Cue[], audience: Audience, enabled: boolean) {
  if (!enabled || typeof document === 'undefined' || document.hidden || !ctx || ctx.state !== 'running') return;
  let offset = 0;
  for (const cue of cues) {
    if (!AUDIENCE_CUES[audience].includes(cue) || !allow(cue, Date.now())) continue;
    voice(cue, audience, ctx.currentTime + offset);
    offset += cueLength(cue) + 0.1;
  }
}

function voice(cue: Cue, audience: Audience, start: number) {
  const c = ctx!;
  const master = c.createGain();
  master.gain.value = 0.3 * AUDIENCE_GAIN[audience];
  master.connect(c.destination);
  for (const v of CUES[cue]) {
    const t0 = start + v.at,
      t1 = t0 + v.dur;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(v.gain, t0 + Math.min(0.02, v.dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    env.connect(master);
    if (v.wave === 'noise') {
      noise ??= makeNoise(c);
      const src = c.createBufferSource(),
        lp = c.createBiquadFilter();
      src.buffer = noise;
      src.loop = true;
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(v.from, t0);
      if (v.to) lp.frequency.exponentialRampToValueAtTime(v.to, t1);
      src.connect(lp).connect(env);
      src.start(t0);
      src.stop(t1 + 0.02);
    } else {
      const o = c.createOscillator();
      o.type = v.wave;
      o.frequency.setValueAtTime(v.from, t0);
      if (v.to) o.frequency.exponentialRampToValueAtTime(v.to, t1);
      o.connect(env);
      o.start(t0);
      o.stop(t1 + 0.02);
    }
  }
}
function makeNoise(c: AudioContext) {
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate),
    d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
