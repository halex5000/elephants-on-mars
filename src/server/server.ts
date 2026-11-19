// HTTP (static files + /healthz) and a WebSocket hub at /ws.
// State lives in memory in this one process, which is why the AWS service runs exactly one task.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { access, constants, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { loadGames, saveGames } from './snapshots.js';
import * as E from './engine.js';
import { hostView, playerView, shared } from './views.js';
import type { Action, ClientMsg, ServerMsg } from '../shared/protocol.js';

export interface ServerOptions {
  port?: number; host?: string; publicDir: string;
  now?: () => number; rng?: E.Rng;
  /** How fast the game clock runs vs real time. Must match `now`. Only >1 for demos/tests. */
  speed?: number;
  maxGames?: number; idleGameMs?: number; log?: (event: string, data?: Record<string, unknown>) => void;
  /** If set, creating a game requires this passcode. Players never need it. Use it on public hosts. */
  hostPasscode?: string;
  stateFile?: string; snapshotIntervalMs?: number;
}

interface Conn { ws: WebSocket; code?: string; role?: 'host' | 'player'; playerId?: string; hits: number[]; alive: boolean; last?: string }

const MIME: Record<string, string> = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I, L, O
const RATE = { windowMs: 1000, max: 20 };
const MAX_MSG_BYTES = 4096;
/** Wrong host passcodes allowed per minute across the whole server, so guessing it is impractical. */
const PASSCODE_FAILS = { windowMs: 60_000, max: 20 };

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const token = () => randomBytes(18).toString('base64url');

export async function startServer(opts: ServerOptions): Promise<{ server: Server; url: string; port: number; close: () => Promise<void>; games: Map<string, E.Game> }> {
  const speed = opts.speed ?? 1;
  const now = opts.now ?? Date.now;
  const rng = opts.rng ?? Math.random;
  const log = opts.log ?? ((event, data) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data })));
  const maxGames = opts.maxGames ?? 200;
  const idleMs = opts.idleGameMs ?? 12 * 3600_000;
  const passcode = opts.hostPasscode?.trim() || undefined;
  let passFails: number[] = [];
  const games = new Map<string, E.Game>();
  const publicRoot = resolve(opts.publicDir);
  const stateFile = opts.stateFile ? resolve(opts.stateFile) : undefined;
  if (stateFile) {
    const parent = await realpath(dirname(stateFile));
    const target = join(parent, basename(stateFile));
    const webRoot = await realpath(publicRoot).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
      return publicRoot;
    });
    if (target === webRoot || target.startsWith(webRoot + sep)) throw new Error('STATE_FILE must be outside the public directory');
    await access(parent, constants.W_OK);
    for (const game of await loadGames(stateFile)) {
      if (now() - game.touchedAt > idleMs) continue;
      if (game.phase === 'play' && game.endsAt !== null && game.endsAt <= now()) E.endRound(game);
      games.set(game.code, game);
    }
  }
  const conns = new Set<Conn>();
  const timers = new Map<string, NodeJS.Timeout>();

  /* ---------- static files ---------- */
  async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, games: games.size, connections: conns.size })); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || !extname(path)) path = '/index.html'; // client-side routes (/host, /join) all serve the app
    const file = resolve(join(publicRoot, path));
    if (!file.startsWith(publicRoot + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': path === '/index.html' ? 'no-cache' : 'public, max-age=300',
        'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        // Everything is served from this origin: no third-party fonts, scripts or images.
        'content-security-policy': "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:",
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); }
  }

  const server = createServer((req, res) => { serveStatic(req, res).catch(() => { res.writeHead(500); res.end(); }); });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG_BYTES });
  wss.on('error', err => log('wss_error', { err: err.message }));

  /* ---------- helpers ---------- */
  const send = (c: Conn, m: ServerMsg) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };

  // Changes that land within BATCH_MS of each other go out as one update per viewer.
  const BATCH_MS = 30;
  const dirty = new Map<string, NodeJS.Timeout>();
  function broadcast(g: E.Game) {
    if (dirty.has(g.code)) return;
    dirty.set(g.code, setTimeout(() => { dirty.delete(g.code); flush(g); }, BATCH_MS));
  }
  function flush(g: E.Game) {
    if (games.get(g.code) !== g) return;
    const t = now();
    const online = new Set<string>();
    for (const c of conns) if (c.code === g.code && c.playerId) online.add(c.playerId);
    const sh = shared(g, t, speed);
    let hostJson: string | undefined;
    for (const c of conns) {
      if (c.code !== g.code || c.ws.readyState !== WebSocket.OPEN) continue;
      // serverNow is the only field that changes every time; compare without it so
      // nobody is sent a view identical to the last one they got.
      let json: string;
      if (c.role === 'host') json = hostJson ??= JSON.stringify({ t: 'view', view: { ...hostView(g, t, { isConnected: id => online.has(id) }, sh), serverNow: -1 } });
      else if (c.playerId) json = JSON.stringify({ t: 'view', view: { ...playerView(g, c.playerId, t, sh), serverNow: -1 } });
      else continue;
      if (json === c.last) continue;
      c.last = json;
      c.ws.send(json.replace('"serverNow":-1', `"serverNow":${t}`));
    }
  }

  function schedule(g: E.Game) {
    clearTimeout(timers.get(g.code));
    timers.delete(g.code);
    if (g.phase !== 'play' || g.endsAt == null) return;
    const ms = Math.max(0, g.endsAt - now()) / speed + 250;
    timers.set(g.code, setTimeout(() => {
      timers.delete(g.code);
      if (g.phase === 'play' && g.endsAt != null && now() >= g.endsAt) { E.endRound(g); log('round_auto_ended', { code: g.code, round: g.round }); broadcast(g); }
      else schedule(g);
    }, ms));
  }

  function newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const c = Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!games.has(c)) return c;
    }
    throw new E.GameError('Could not make a game code. Try again.');
  }

  function act(c: Conn, g: E.Game, action: Action) {
    const t = now();
    const host = c.role === 'host';
    const needHost = () => { if (!host) throw new E.GameError('Only the host can do that.'); };
    const needPlayer = () => { if (!c.playerId) throw new E.GameError('Join the game first.'); return c.playerId; };
    switch (action?.a) {
      case 'makeTeams': needHost(); E.makeTeams(g, rng, action.settings); break;
      case 'startRound': needHost(); E.startRound(g, t, rng); break;
      case 'endRound': needHost(); E.endRound(g); break;
      case 'finish': needHost(); E.finish(g); break;
      case 'newGame': needHost(); E.newGame(g, t); break;
      case 'addTime': needHost(); E.addTime(g, action.seconds, t); break;
      case 'seatLatecomers': needHost(); E.seatLatecomers(g); break;
      case 'removePlayer': needHost(); E.removePlayer(g, String(action.playerId)); break;
      case 'transfer': E.transfer(g, needPlayer(), action.from, action.to, action.amount, t); break;
      case 'buyAnimal': E.buyAnimal(g, needPlayer(), String(action.animal), action.maxPrice, t); break;
      case 'buyRocket': E.buyRocket(g, needPlayer(), String(action.rocket), action.maxPrice, t); break;
      case 'buyFuel': E.buyFuel(g, needPlayer(), action.minUnits, t); break;
      case 'sendFuel': E.sendFuel(g, needPlayer(), t); break;
      case 'launch': E.launch(g, needPlayer(), t); break;
      default: throw new E.GameError('Unknown action.');
    }
    g.touchedAt = t;
    schedule(g);
    broadcast(g);
  }

  function handle(c: Conn, msg: ClientMsg) {
    switch (msg?.t) {
      case 'ping': send(c, { t: 'pong' }); return;
      case 'create': {
        if (passcode) {
          const t = Date.now();
          passFails = passFails.filter(f => t - f < PASSCODE_FAILS.windowMs);
          if (passFails.length >= PASSCODE_FAILS.max) { send(c, { t: 'error', message: 'Too many wrong passcodes. Wait a minute and try again.', needPasscode: true }); return; }
          const given = typeof msg.passcode === 'string' ? msg.passcode.trim() : '';
          if (!safeEq(given, passcode)) {
            if (given) { passFails.push(t); log('passcode_rejected'); }
            send(c, { t: 'error', message: given ? "That passcode isn't right." : 'Enter the host passcode to create a game.', needPasscode: true });
            return;
          }
        }
        if (games.size >= maxGames) throw new E.GameError('The server is at its game limit. Try again later.');
        const g = E.createGame(newCode(), token(), now(), msg.settings);
        games.set(g.code, g);
        Object.assign(c, { code: g.code, role: 'host', playerId: undefined });
        log('game_created', { code: g.code });
        send(c, { t: 'created', code: g.code, hostToken: g.hostToken });
        broadcast(g);
        return;
      }
      case 'host': {
        const g = games.get(String(msg.code).toUpperCase());
        if (!g || !safeEq(String(msg.hostToken), g.hostToken)) { send(c, { t: 'error', message: "That host link isn't valid any more.", fatal: true }); return; }
        Object.assign(c, { code: g.code, role: 'host', playerId: undefined, last: undefined });
        broadcast(g);
        return;
      }
      case 'join': {
        const g = games.get(String(msg.code ?? '').trim().toUpperCase());
        if (!g) { send(c, { t: 'error', message: 'No game with that code. Check it with your host.' }); return; }
        const p = E.addPlayer(g, 'p_' + randomBytes(6).toString('hex'), token(), msg.name, now());
        Object.assign(c, { code: g.code, role: 'player', playerId: p.id });
        g.touchedAt = now();
        log('player_joined', { code: g.code, players: g.players.length });
        send(c, { t: 'joined', code: g.code, playerId: p.id, token: p.token });
        broadcast(g);
        return;
      }
      case 'resume': {
        const g = games.get(String(msg.code).toUpperCase());
        const p = g?.players.find(x => x.id === msg.playerId);
        if (!g || !p || !safeEq(String(msg.token), p.token)) { send(c, { t: 'error', message: 'That game has ended or you were removed. Join again with the code.', fatal: true }); return; }
        Object.assign(c, { code: g.code, role: 'player', playerId: p.id, last: undefined });
        broadcast(g);
        return;
      }
      case 'act': {
        const g = c.code ? games.get(c.code) : undefined;
        if (!g) throw new E.GameError('Join a game first.');
        act(c, g, msg.action);
        return;
      }
      default: throw new E.GameError('Unknown message.');
    }
  }

  wss.on('connection', ws => {
    const c: Conn = { ws, hits: [], alive: true };
    conns.add(c);
    ws.on('pong', () => { c.alive = true; });
    // Without this, a protocol error on one socket (e.g. an oversized frame) is an
    // unhandled 'error' event and takes the whole process down.
    ws.on('error', err => { log('socket_error', { err: err.message }); ws.terminate(); });
    ws.on('message', (raw, isBinary) => {
      const t = now();
      c.hits = c.hits.filter(h => t - h < RATE.windowMs); c.hits.push(t);
      if (c.hits.length > RATE.max) { send(c, { t: 'error', message: 'Slow down a little.' }); return; }
      if (isBinary) return;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { send(c, { t: 'error', message: 'Bad message.' }); return; }
      try { handle(c, msg); }
      catch (e) {
        if (e instanceof E.GameError) send(c, { t: 'error', message: e.message });
        else { log('handler_error', { err: String(e) }); send(c, { t: 'error', message: 'Something went wrong on the server.' }); }
      }
    });
    ws.on('close', () => {
      conns.delete(c);
      const g = c.code ? games.get(c.code) : undefined;
      if (g) broadcast(g); // presence changed
    });
  });

  // keepalive (ALB idle timeout) + idle game cleanup
  const sweep = setInterval(() => {
    for (const c of conns) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; c.ws.ping(); }
    const t = now();
    for (const [code, g] of games) {
      const active = [...conns].some(c => c.code === code);
      if (!active && t - g.touchedAt > idleMs) { games.delete(code); clearTimeout(timers.get(code)); timers.delete(code); log('game_expired', { code }); }
    }
  }, 30_000);
  sweep.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 3000, opts.host ?? '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 3000);
      for (const game of games.values()) schedule(game);
      let writing: Promise<void> | undefined;
      const checkpoint = stateFile ? setInterval(() => {
        if (writing) return;
        writing = saveGames(stateFile, games.values())
          .catch(err => log('snapshot_error', { err: String(err) }))
          .finally(() => { writing = undefined; });
      }, opts.snapshotIntervalMs ?? 3000).unref() : undefined;
      log('listening', { port });
      resolve({
        server, port, url: `http://127.0.0.1:${port}`, games,
        close: async () => {
          clearInterval(checkpoint);
          clearInterval(sweep); timers.forEach(t => clearTimeout(t)); dirty.forEach(t => clearTimeout(t));
          for (const c of conns) c.ws.terminate();
          wss.close();
          await new Promise<void>(done => server.close(() => done()));
          await writing;
          if (stateFile) await saveGames(stateFile, games.values());
        },
      });
    });
  });
}
