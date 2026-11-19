// Browser client. Holds no game data of its own: everything on screen comes from
// the server's per-viewer view, so devtools only ever show what you're allowed to know.
import morphdom from 'morphdom';
import {
  ROLES, type Role, type ClientMsg, type ServerMsg, type HostView, type PlayerView, type Common, type Outcome, type Settings, type FeedItem, type FuelMarket,
} from '../shared/protocol.js';
import { auctionPrice, fuelInPool } from '../shared/market.js';
import { planet, rocket, paw, rocketGlyph, drop, qr } from './art.js';
import { resultsText } from './export.js';

const RI: Record<Role, { t: string; i: string; d: string }> = {
  captain: { t: 'Captain', i: '🧑‍✈️', d: 'You hold the money and the launch button. Send your crew what they need, and launch once the animal, rocket and fuel are all in.' },
  vet: { t: 'Vet', i: '🩺', d: 'You buy the animal. Only you can see sizes and points. Tell your Pilot how big it is.' },
  pilot: { t: 'Pilot', i: '🚀', d: 'You buy a rocket big enough for the animal. Only you can see how much each rocket carries and how much fuel it needs. Tell your Engineer.' },
  engineer: { t: 'Engineer', i: '🔧', d: 'You gather fuel from a pool shared by every engineer in the game. Wait and it fills up; buy and it empties for everyone. Get as much as your Pilot says the rocket needs.' },
};

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (n: number) => '$' + Math.round(n).toLocaleString();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ---------- local identity (per tab for players, so one person can test 4 roles in 4 tabs) ---------- */
const store = {
  get(k: string, session = false) { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(k) ?? 'null'); } catch { return null; } },
  set(k: string, v: unknown, session = false) { try { (session ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k: string, session = false) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch { /* ignore */ } },
};

/* ---------- state ---------- */
type Route = { kind: 'home'; code?: string } | { kind: 'host'; code: string } | { kind: 'screen'; code: string } | { kind: 'play'; code: string };
let route: Route = parseRoute();
let view: HostView | PlayerView | null = null;
let clockSkew = 0, speed = 1, viewAt = 0, viewServerNow = 0;
let fatal = '';
const ui = {
  name: '', code: route.kind === 'home' ? route.code ?? '' : '', tab: '' as Role | '',
  amt: {} as Record<string, string>, to: {} as Record<string, string>,
  set: { minutes: '4', income: '10', teamSize: '4', rounds: '6' } as Record<keyof Settings, string>,
  confirm: 0, busy: false, help: false,
  pass: '', needPass: false, qrBig: false, showResults: false,
};
const PASS_KEY = 'eom-host-pass';

function parseRoute(): Route {
  const [, a, b] = location.pathname.split('/');
  if (a === 'host' && b) return { kind: 'host', code: b.toUpperCase() };
  if (a === 'play' && b) return { kind: 'play', code: b.toUpperCase() };
  if (a === 'screen' && b) return { kind: 'screen', code: b.toUpperCase() };
  if (a === 'join' && b) return { kind: 'home', code: b.toUpperCase() };
  return { kind: 'home', code: new URLSearchParams(location.search).get('code')?.toUpperCase() ?? undefined };
}
function go(r: Route) {
  route = r;
  const path = r.kind === 'home' ? '/' : `/${r.kind}/${r.code}`;
  history.replaceState(null, '', path);
}

/* ---------- socket ---------- */
let ws: WebSocket | null = null, retry = 0, pending: ClientMsg | null = null;
function hello(): ClientMsg | null {
  if (route.kind === 'host') { const tok = store.get(`eom-host-${route.code}`); return tok ? { t: 'host', code: route.code, hostToken: tok } : null; }
  if (route.kind === 'screen') { const tok = store.get(`eom-host-${route.code}`); return tok ? { t: 'screen', code: route.code, hostToken: tok } : null; }
  if (route.kind === 'play') { const p = store.get(`eom-player-${route.code}`, true); return p ? { t: 'resume', code: route.code, playerId: p.playerId, token: p.token } : null; }
  return null;
}
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => {
    retry = 0; $('#net')!.hidden = true;
    const h = hello(); if (h) ws!.send(JSON.stringify(h));
    if (pending) { ws!.send(JSON.stringify(pending)); pending = null; }
  };
  ws.onmessage = e => onMsg(JSON.parse(e.data as string) as ServerMsg);
  ws.onclose = () => {
    ws = null;
    if (route.kind !== 'home') $('#net')!.hidden = false;
    setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
  };
}
function send(m: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else { pending = m; toast('Connecting… your move will go through in a moment.'); }
}
const act = (action: Extract<ClientMsg, { t: 'act' }>['action']) => send({ t: 'act', action });
setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' })); }, 25_000);

function onMsg(m: ServerMsg) {
  switch (m.t) {
    case 'created': store.set(`eom-host-${m.code}`, m.hostToken); if (ui.pass.trim()) store.set(PASS_KEY, ui.pass.trim()); ui.needPass = false; go({ kind: 'host', code: m.code }); break;
    case 'joined': store.set(`eom-player-${m.code}`, { playerId: m.playerId, token: m.token }, true); go({ kind: 'play', code: m.code }); break;
    case 'view': view = m.view; clockSkew = m.view.serverNow - Date.now(); speed = m.view.speed || 1; viewAt = Date.now(); viewServerNow = m.view.serverNow; fatal = ''; ui.busy = false; render(); break;
    case 'error':
      ui.busy = false;
      if (m.needPasscode) { store.del(PASS_KEY); ui.needPass = true; render(); setTimeout(() => $<HTMLInputElement>('#hpass')?.focus(), 0); }
      if (m.fatal) { if (route.kind === 'play') store.del(`eom-player-${route.code}`, true); fatal = m.message; view = null; const c = route.kind === 'home' ? undefined : route.code; go({ kind: 'home', code: c }); ui.code = c ?? ''; render(); }
      toast(m.message); break;
  }
}

/* ---------- toast + timer ---------- */
let toastTimer = 0;
function toast(msg: string) { const t = $('#toast')!; t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), 3800); }
const secsLeft = () => (view?.phase === 'play' && view.endsAt ? Math.max(0, Math.ceil((view.endsAt - serverNow()) / 1000 / speed)) : 0);
let wasOpen = false;
/** Best estimate of the server's game clock right now. */
const serverNow = () => (speed === 1 ? Date.now() + clockSkew : viewServerNow + (Date.now() - viewAt) * speed);
/** Live market numbers tick in the browser from server-sent parameters; the server re-checks every purchase. */
function tickMarkets() {
  const now = serverNow();
  document.querySelectorAll<HTMLElement>('[data-auction]').forEach(el => {
    const price = auctionPrice(Number(el.dataset.base), Number(el.dataset.reset), now);
    if (el.tagName === 'BUTTON') {
      const b = el as HTMLButtonElement;
      b.dataset.price = String(price);
      b.disabled = b.dataset.locked === '1' || price > Number(b.dataset.wallet);
    } else el.textContent = '$' + price;
  });
  document.querySelectorAll<HTMLElement>('[data-pool]').forEach(el => {
    const units = fuelInPool(Number(el.dataset.reset), Number(el.dataset.rate), now);
    if (el.dataset.fill) { el.style.height = Math.min(100, (units / 120) * 100) + '%'; return; }
    if (el.tagName === 'BUTTON') {
      const b = el as HTMLButtonElement;
      b.dataset.units = String(units);
      b.disabled = b.dataset.locked === '1' || units < 1 || Number(b.dataset.cost) > Number(b.dataset.wallet);
    } else el.textContent = String(units);
  });
}
setInterval(tickMarkets, 250);
function tick() {
  tickMarkets();
  const s = secsLeft();
  document.querySelectorAll('.tmr').forEach(el => { el.textContent = s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : "Time's up"; el.classList.toggle('hot', s > 0 && s <= 30); });
  // update the flag BEFORE re-rendering: render() calls tick(), and checking the stale flag recursed forever
  const open = s > 0, closedNow = wasOpen && !open; wasOpen = open;
  if (closedNow) render();
}
setInterval(tick, 1000);

/* ---------- render ---------- */
// Patch the DOM in place instead of replacing it. Rebuilding with innerHTML on every
// server update threw away whatever control a player was using at that instant
// (e.g. a recipient dropdown), so money could go to the wrong teammate.
function render() {
  const next = document.createElement('main');
  next.id = 'app';
  next.innerHTML = page();
  document.body.classList.toggle('projector', route.kind === 'screen');
  morphdom($('#app')!, next, {
    onBeforeElUpdated(from, to) {
      // a <details> someone opened or closed stays that way across server updates
      if (from instanceof HTMLDetailsElement) (to as HTMLDetailsElement).open = from.open || (to as HTMLDetailsElement).open;
      if (from instanceof HTMLInputElement || from instanceof HTMLSelectElement || from instanceof HTMLTextAreaElement) {
        // never fight a control the player is actively using: keep its live value
        if (from === document.activeElement) {
          for (const a of Array.from(to.attributes)) if (a.name !== 'value') from.setAttribute(a.name, a.value);
          return false;
        }
        // isEqualNode only compares attributes, but what a person typed lives in the
        // .value property. Sync it explicitly, or a cleared field keeps its old text.
        const want = (to as HTMLInputElement).value;
        if (from.value !== want) from.value = want;
      }
      return !from.isEqualNode(to);
    },
  });
  tick();
}
const band = (inner: string, cls = '') => `<section class="band ${cls}"><div class="wrap">${inner}</div></section>`;

function page(): string {
  if (route.kind === 'home') return home();
  if (!view) return band(`<p class="mut">Connecting to mission control…</p>`);
  if (view.kind === 'host') return route.kind === 'screen' ? screenPage(view) : hostPage(view);
  return playerPage(view);
}

const poolAttrs = (m: FuelMarket) => `data-pool data-reset="${m.resetAt}" data-rate="${m.ratePerSec}"`;

/* ---------- copy ---------- */
const TASK: Record<Role, string> = { captain: 'Distribute funds', vet: 'Take animal', pilot: 'Buy rocket', engineer: 'Manage fuel' };
const TEAM_COLORS = ['#f5b83d', '#43a6ff', '#39d98a', '#ff5b4d', '#c58cff', '#ff8ad8', '#5ee6e6', '#ffd86b', '#9fd36b', '#ff9a5c', '#8fa8ff', '#e6e6e6'];
const teamColor = (name: string, all: string[]) => TEAM_COLORS[Math.max(0, all.indexOf(name)) % TEAM_COLORS.length];
const FEED_ICON: Record<FeedItem['kind'], string> = { animal: '🐾', rocket: '🚀', fuel: '💧', launch: '🔥' };

function rolesExplainer() {
  return `<div class="roles4">${ROLES.map(r => `<div class="panel" style="--c:var(--${r})"><h3>${RI[r].t}</h3><p class="m0 sm" style="margin-top:6px">${RI[r].d}</p></div>`).join('')}</div>`;
}
function howTo() {
  return `<div class="panel" style="margin-top:16px"><h3>How a mission works</h3><p class="m0" style="margin-top:6px">The Captain hands out money. The Vet takes an animal and tells the Pilot its size. The Pilot buys a rocket at least that big and tells the Engineer how much fuel it needs. The Engineer buys fuel and sends it to the mission. Then the Captain launches, before time runs out.</p>
<p class="sm mut m0" style="margin-top:8px">Markets are live and shared with every team: prices drop while nobody buys, and the fuel pool fills up over time, until someone buys. Roles change every mission. Every team's points together terraform Mars.</p></div>`;
}

/* ---------- landing ---------- */
function home() {
  return band(`${fatal ? `<p class="pill bad">${esc(fatal)}</p>` : ''}
<div class="hero"><div><h1>Elephants on Mars</h1><p>Four roles, one rocket, and everyone sees a different piece of the plan. Talk fast, land animals, terraform a planet together.</p></div>${planet(35)}</div>
<div class="doors">
<form class="panel stack" data-form="join" novalidate><h2>Join a game</h2><p class="mut m0">Your host has a four-letter code.</p>
<div class="row"><label class="f">Game code<input id="jcode" class="code" data-k="code" maxlength="4" autocomplete="off" value="${esc(ui.code)}"></label>
<label class="f" style="flex:1">Your name<input id="jname" data-k="name" maxlength="24" autocomplete="off" value="${esc(ui.name)}"></label></div>
<button ${ui.busy ? 'disabled' : ''}>Join</button></form>
<form class="panel stack" data-form="create" novalidate><h2>Host a game</h2><p class="mut m0">Get a code to share on your video call. You run the clock, the big screen and the debrief. Hosts don't play.</p>
${ui.needPass ? `<label class="f">Host passcode<input id="hpass" type="password" data-k="pass" autocomplete="current-password" value="${esc(ui.pass)}"></label><p class="mut m0 sm">This server only lets people with the passcode host games. Players don't need it.</p>` : ''}
<button class="ghost" ${ui.busy ? 'disabled' : ''}>Create a game</button></form>
</div>${rolesExplainer()}${howTo()}`);
}

/* ---------- host ---------- */
function hostPage(v: HostView): string {
  const joinUrl = `${location.origin}/join/${v.code}`;
  const un = v.players.filter(p => !p.seated);
  let ctl = '';
  if (v.phase === 'lobby') {
    const s = ui.set;
    ctl = `<div class="row"><label class="f">Minutes per mission<input id="s-min" type="number" min="0.5" step="0.5" data-k="set.minutes" value="${esc(s.minutes)}"></label><label class="f">Money per mission<input id="s-inc" type="number" min="1" step="1" data-k="set.income" value="${esc(s.income)}"></label><label class="f">Players per team<input id="s-size" type="number" min="1" max="8" data-k="set.teamSize" value="${esc(s.teamSize)}"></label><label class="f">Missions<input id="s-rnd" type="number" min="1" max="12" data-k="set.rounds" value="${esc(s.rounds)}"></label>
<button data-act="makeTeams" style="align-self:flex-end" ${v.players.length ? '' : 'disabled'}>Make teams (${plural(v.players.length, 'player', 'players')})</button></div>`;
  } else if (v.phase === 'teams') ctl = `<div class="row"><button class="ghost" data-act="makeTeams">Reshuffle teams</button><button data-act="startRound">Start mission 1</button></div>`;
  else if (v.phase === 'play') {
    const all = v.stats.launched === v.stats.teams;
    ctl = `<div class="row"><span class="pill">${v.stats.launched} of ${v.stats.teams} teams launched</span><button class="ghost" data-act="addTime">+1 minute</button><button data-act="endRound">${all ? 'Everyone launched. Show results' : 'End mission now'}</button></div>`;
  } else if (v.phase === 'results') {
    const more = v.round < v.totalRounds;
    ctl = `<div class="row">${more ? `<button data-act="startRound">Start mission ${v.round + 1}</button>` : ''}<button class="${more ? 'ghost' : ''}" data-act="finish">${more ? 'End game early' : 'Show the final report'}</button>${more ? '<span class="sm mut">Roles reshuffle when the next mission starts.</span>' : ''}</div>`;
  } else ctl = `<div class="row"><button data-act="newGame">New game with the same players</button><a class="pill" href="/">Back to start</a></div>`;

  const chips = `<div class="chips">${v.players.map(p => `<span class="${p.connected ? '' : 'off'}">${esc(p.name)}${v.phase === 'lobby' || v.phase === 'teams' ? ` <button class="ghost sm" data-act="removePlayer" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</span>`).join('') || '<span class="mut">Nobody yet</span>'}</div>`;
  const bar = `<section class="band hostbar ${v.phase === 'lobby' ? '' : 'compact'}"><div class="wrap stack"><div class="top"><div class="joinwho">${joinQr(v, joinUrl)}<div><span class="sm mut">Scan, or join at ${esc(location.host)} with code</span><div class="joincode">${esc(v.code)}</div></div></div><div class="stack" style="text-align:right"><div class="row" style="justify-content:flex-end"><a class="btnlink ghost sm" href="/screen/${esc(v.code)}" target="_blank" rel="noopener">Open big screen</a><button class="ghost sm" data-act="copy" data-v="${esc(joinUrl)}">Copy join link</button></div><span class="sm mut">Host controls, only you see these</span></div></div>
${ctl}${un.length && v.phase !== 'lobby' && v.phase !== 'final' ? `<div class="row"><span>${plural(un.length, 'player is', 'players are')} waiting without a team.</span><button class="ghost" data-act="seatLatecomers">Add them to teams</button></div>` : ''}${v.phase === 'lobby' ? chips : ''}</div></section>`;

  let body = '';
  if (v.phase === 'lobby') body = `<h2>Lobby</h2><p class="mut">Share the code. When everyone's in, make teams.</p>${rolesExplainer()}${howTo()}`;
  else if (v.phase === 'teams') body = `<h2>Teams</h2><p class="mut">Send each team to its breakout room, then start mission 1.</p>${teamCards(v)}<details class="panel" style="margin-top:16px"><summary>Players (${v.players.length})</summary>${chips}</details>`;
  else if (v.phase === 'play') body = bigScreen(v);
  else if (v.phase === 'results') body = missionReport(v);
  else body = finalReport(v);
  return bar + band(body);
}
/** Big in the lobby; during play a small tap-to-enlarge code for latecomers. */
function joinQr(v: HostView, joinUrl: string) {
  const code = qr(joinUrl, `QR code to join game ${v.code}`);
  if (v.phase === 'lobby') return `<div class="qrbox big">${code}</div>`;
  return `<button class="qrbox ${ui.qrBig ? 'big' : 'small'}" data-act="qr" aria-expanded="${ui.qrBig}" aria-label="${ui.qrBig ? 'Shrink' : 'Enlarge'} the join QR code">${code}</button>`;
}
/** The projector: what the host screen-shares. Same live data as the host, no controls. */
function screenPage(v: HostView): string {
  const joinUrl = `${location.origin}/join/${v.code}`;
  if (v.phase === 'lobby') {
    return band(`<div class="screen-lobby"><div class="qrbox screen-qr">${qr(joinUrl, `QR code to join game ${v.code}`)}</div>
<div class="stack"><h1>Elephants on Mars</h1><p class="mut m0">Scan the code, or go to <b>${esc(location.host)}</b> and enter</p><div class="joincode">${esc(v.code)}</div>
<p class="m0"><b class="num">${v.players.length}</b> <span class="mut">${v.players.length === 1 ? 'player' : 'players'} in</span></p>
<div class="chips">${v.players.map(p => `<span>${esc(p.name)}</span>`).join('')}</div></div></div>`, 'projector');
  }
  const corner = v.phase === 'final' ? '' : `<div class="screen-join"><span class="sm mut">Late? Join with</span><b class="code">${esc(v.code)}</b><div class="qrbox mini">${qr(joinUrl, `QR code to join game ${v.code}`)}</div></div>`;
  let body = '';
  if (v.phase === 'teams') body = `<h2>Teams</h2><p class="mut">Find your team, then head to your breakout room.</p>${teamCards(v)}`;
  else if (v.phase === 'play') body = bigScreen(v);
  else if (v.phase === 'results') body = missionReport(v);
  else body = finalReport(v, true);
  return band(`${corner}${body}`, 'projector');
}
function teamCards(v: HostView) {
  const names = v.teams.map(t => t.name);
  return `<div class="roles4">${v.teams.map(t => `<div class="panel" style="--c:${teamColor(t.name, names)}"><h3>${esc(t.name)}</h3>${t.members.map(m => `<div class="sm ${m.connected ? '' : 'mut'}" style="margin-top:6px"><b>${esc(m.name)}</b> <span class="mut">${m.roles.map(r => RI[r].t).join(' + ')}${m.connected ? '' : ', offline'}</span></div>`).join('')}</div>`).join('')}</div>`;
}
/** The shared screen: every team's progress and every move, over a planet that greens as the group scores. */
function bigScreen(v: HostView) {
  const names = v.teams.map(t => t.name);
  const progress = v.stats.teams ? Math.round((v.stats.launched / v.stats.teams) * 100) : 0;
  const mini = (ok: boolean, icon: string, label: string) => `<span class="${ok ? 'ok' : ''}" title="${label}">${icon}</span>`;
  return `<div class="bigscreen">${planet(v.terraform.pct)}
<div class="bs-grid"><div><div class="bs-clock"><span class="num tmr"></span><small class="mut"> until close</small></div>
${v.fuel ? `<div class="bs-pool"><span class="num" ${poolAttrs(v.fuel)}>0</span><span class="sm">fuel in the shared pool</span></div>` : ''}
<div class="bs-feed" id="feed">${v.feed.slice(0, 9).map(f => `<div><span class="sw" style="background:${teamColor(f.teamName, names)}"></span><span><b>${esc(f.teamName)}</b> ${esc(f.text)}</span></div>`).join('') || '<div>Waiting for the first move…</div>'}</div></div>
<div class="bs-stats"><h3>Mission ${v.round} of ${v.totalRounds}</h3><div class="bs-stat"><span class="num">${progress}%</span><small>launched</small></div><div class="bs-stat"><span class="num">$${v.stats.distributed}</span><small>distributed</small></div><div class="bs-stat"><span class="num">$${v.stats.spent}</span><small>spent</small></div></div></div>
<div class="bs-teams">${v.teams.map(t => `<div class="bs-team ${t.status.launched ? 'done' : ''}"><span class="sw" style="width:10px;height:10px;border-radius:3px;background:${teamColor(t.name, names)}"></span><b>${esc(t.name)}</b><span class="mini">${mini(t.status.animal, '🐾', 'animal')}${mini(t.status.rocket, '🚀', 'rocket')}${mini(t.status.fuel, '💧', 'fuel')}${mini(t.status.launched, '🔥', 'launched')}</span></div>`).join('')}</div></div>`;
}

/* ---------- player ---------- */
function playerPage(v: PlayerView): string {
  if (v.phase === 'lobby') return band(`<div class="stack"><h2>You're in, ${esc(v.me.name)}</h2><p class="mut">Waiting for the host to make teams. Game code <b>${esc(v.code)}</b>.</p>${rolesExplainer()}${howTo()}</div>`);
  if (!v.team) {
    if (v.phase === 'results') return band(`<p class="pill">You're watching. The host can add you to a team.</p>${missionReport(v)}`);
    if (v.phase === 'final') return band(finalReport(v));
    return band(`<div class="stack"><h2>Hang tight, ${esc(v.me.name)}</h2><p class="mut">Teams are already set. Ask the host to add you to one.</p></div>`);
  }
  if (v.phase === 'teams') return band(briefing(v));
  if (v.phase === 'play') return band(deck(v));
  if (v.phase === 'results') return band(missionReport(v));
  return band(finalReport(v));
}
function briefing(v: PlayerView) {
  const t = v.team!;
  return `<div class="deck">${t.roles.map(r => `<div class="console r-${r}" data-role="${r}"><div class="c-head"><span class="c-team">${esc(t.name)}</span><h1 class="c-title">${RI[r].t.toUpperCase()}</h1><span></span></div><p style="margin:14px 4px 0">${RI[r].d}</p><p class="sm mut" style="margin:10px 4px 0">This is your first role. Roles reshuffle every mission. Join your team's breakout room.</p></div>`).join('')}
<div class="side">${crewPanel(v)}${howTo()}</div></div>`;
}
function deck(v: PlayerView) {
  const t = v.team!, tab: Role = t.roles.includes(ui.tab as Role) ? (ui.tab as Role) : t.roles[0]!;
  const lock = t.status.launched || secsLeft() <= 0;
  const wallet = t.roster.find(r => r.role === tab)!.balance;
  const body = tab === 'captain' ? capBody(v, lock) : tab === 'vet' ? vetBody(v, lock, wallet) : tab === 'pilot' ? pilotBody(v, lock, wallet) : engBody(v, lock, wallet);
  const vet = v.console?.vet, animalIcon = vet?.bought ? vet.animals.find(a => a.id === vet.bought)!.emoji : paw();
  return `<h2 style="margin-bottom:14px">Mission ${v.round} of ${v.totalRounds}</h2><div class="deck">
<div class="console r-${tab}" data-role="${tab}">
<div class="c-head"><span class="c-team">${esc(t.name)}</span><h1 class="c-title">${RI[tab].t.toUpperCase()}</h1><button class="c-help ghost sm" data-act="help" aria-label="What does the ${RI[tab].t} do?">?</button></div>
${ui.help ? `<p class="sm" style="margin:10px 4px 0">${RI[tab].d}</p>` : ''}
<div class="c-stats"><div><span class="num tmr"></span><small>until close</small></div><i></i><div class="task">${TASK[tab]}</div><i></i><div><span class="num cash">$${wallet}</span><small>you have</small></div></div>
${t.roles.length > 1 ? `<div class="tabs">${t.roles.map(r => `<button data-act="tab" data-r="${r}" class="${r === tab ? 'on' : ''}">${RI[r].t}</button>`).join('')}</div>` : ''}
${body}
${t.status.launched ? '<p class="locked pill">Launched. Results come when the mission closes.</p>' : secsLeft() <= 0 ? `<p class="locked pill bad">Time's up</p>` : ''}
<div class="status"><small>Mission status</small><div class="dots"><span class="dot ${t.status.animal ? 'ok' : ''}" title="Animal">${t.status.animal ? animalIcon : paw()}</span><span class="dot ${t.status.rocket ? 'ok' : ''}" title="Rocket">${rocketGlyph()}</span><span class="dot ${t.status.fuel ? 'ok' : ''}" title="Fuel">${drop()}</span></div></div>
</div>
<div class="side">${crewPanel(v)}<div class="panel"><h3>Live feed</h3><div class="feed" style="margin-top:8px">${v.feed.length ? v.feed.slice(0, 12).map(f => `<div><span class="k">${FEED_ICON[f.kind]}</span><span><b>${esc(f.teamName)}</b> ${esc(f.text)}</span></div>`).join('') : '<p class="mut sm m0">Nothing yet. Somebody make a move.</p>'}</div></div></div>
</div>`;
}
function crewPanel(v: PlayerView) {
  const t = v.team!;
  return `<div class="panel"><h3>Your crew</h3><div class="crew" style="margin-top:6px">${t.roster.map(r => `<div style="--c:var(--${r.role})"><span class="who"><span class="sw"></span><span><b>${RI[r.role].t}</b><br><span class="sm mut">${esc(r.names.join(', ') || '—')}${t.roles.includes(r.role) ? ' (you)' : ''}</span></span></span><b class="num" style="font-size:22px">$${r.balance}</b></div>`).join('')}</div></div>`;
}
function capBody(v: PlayerView, lock: boolean) {
  const c = v.console!.captain!, t = v.team!, ready = c.picks.animal && c.picks.rocket && c.picks.fuel, conf = Date.now() - ui.confirm < 4000;
  const capWallet = t.roster.find(r => r.role === 'captain')!.balance;
  return `<div class="stack">${(['vet', 'engineer', 'pilot'] as Role[]).map(r => `<div class="give" style="--c:var(--${r})"><b>${RI[r].t}</b><span class="wallet" data-wallet-of="${r}">$${t.roster.find(x => x.role === r)!.balance}</span><button data-act="give" data-to="${r}" ${capWallet < 1 || v.phase !== 'play' ? 'disabled' : ''}>Give $1</button></div>`).join('')}</div>
<p class="sm mut" style="margin:12px 4px 0">You can't see sizes or fuel needs. On board so far: ${c.picks.animal ? esc(c.picks.animal) : 'no animal'}, ${c.picks.rocket ? `the ${esc(c.picks.rocket)}` : 'no rocket'}, ${c.picks.fuel ? `${c.picks.fuel} fuel` : 'no fuel'}. Ask your crew if it's enough.</p>
<div class="launchbar"><button class="launch ${conf ? 'confirm' : ''}" data-act="launch" ${!ready || lock ? 'disabled' : ''}>${t.status.launched ? 'Launched' : conf ? 'Tap again to launch' : 'Launch'}</button></div>
<p class="sm mut m0" style="margin-top:8px;text-align:center">Unspent money carries over. You get $${v.settings.income} more each mission.</p>`;
}
const auctionAttrs = (base: number, reset: number) => `data-auction data-base="${base}" data-reset="${reset}"`;
const liveNow = (base: number, reset: number) => auctionPrice(base, reset, serverNow());
function vetBody(v: PlayerView, lock: boolean, wallet: number) {
  const c = v.console!.vet!;
  return `<div class="items">${c.animals.map(a => { const on = c.bought === a.id; return `<div class="item ${on ? 'on' : ''}" data-animal="${a.id}"><div><b>${esc(a.name)}</b><div class="buy"><span class="price" ${auctionAttrs(a.base, a.resetAt)}>$${liveNow(a.base, a.resetAt)}</span><button data-act="buyAnimal" data-id="${a.id}" ${auctionAttrs(a.base, a.resetAt)} data-wallet="${wallet}" data-locked="${lock ? 1 : 0}">${on ? 'Taken' : 'Take'}</button></div></div>
<div class="medal" aria-hidden="true">${a.emoji}<span class="badge size tl" title="Size">${a.size}</span><span class="badge br" title="Points">★${a.points}</span></div></div>`; }).join('')}</div>
<p class="sm mut" style="margin:10px 4px 0">${c.bought ? 'Tell your Pilot the size. Taking a different animal replaces this one, with no refund.' : 'Prices drop while nobody buys and jump back up when any team takes one.'}</p>`;
}
function pilotBody(v: PlayerView, lock: boolean, wallet: number) {
  const c = v.console!.pilot!;
  return `<div class="items">${c.rockets.map(k => { const on = c.bought === k.id; return `<div class="item ${on ? 'on' : ''}" data-rocket="${k.id}"><div><b>${esc(k.name)}</b><div class="buy"><span class="price" ${auctionAttrs(k.base, k.resetAt)}>$${liveNow(k.base, k.resetAt)}</span><button data-act="buyRocket" data-id="${k.id}" ${auctionAttrs(k.base, k.resetAt)} data-wallet="${wallet}" data-locked="${lock ? 1 : 0}">${on ? 'Bought' : 'Buy'}</button></div></div>
<div class="medal" aria-hidden="true">${rocket(k.size)}<span class="badge size tl" title="Size">${k.size}</span><span class="badge br" title="Fuel needed">${k.fuel}</span></div></div>`; }).join('')}</div>
<p class="sm mut" style="margin:10px 4px 0">Ask your Vet the animal's size; your rocket must be at least that big. The number on each rocket is the fuel it needs. ${c.bought ? 'Tell your Engineer.' : ''}</p>`;
}
function engBody(v: PlayerView, lock: boolean, wallet: number) {
  const c = v.console!.engineer!, m = c.market, poolNow = fuelInPool(m.resetAt, m.ratePerSec, serverNow());
  return `<div class="tanks"><div class="tank"><h3>Global market</h3><div class="drum"><i ${poolAttrs(m)} data-fill="pool"></i></div><span class="num" ${poolAttrs(m)}>${poolNow}</span>
<button data-act="buyFuel" ${poolAttrs(m)} data-cost="${m.grabCost}" data-wallet="${wallet}" data-locked="${lock ? 1 : 0}">Buy $${m.grabCost}</button><small>Takes the whole pool into your stock</small></div>
<div class="tank"><h3>Your fuel</h3><div class="drum"><i style="height:${Math.min(100, c.stock)}%"></i></div><span class="num">${c.stock}</span>
<button data-act="sendFuel" ${c.stock < 1 || lock ? 'disabled' : ''}>Send ${Math.min(c.sendStep, c.stock) || c.sendStep}</button><small>Loads the rocket for this mission</small></div></div>
<p class="onrocket">On the rocket: <span class="num" style="font-size:24px">${c.sent}</span> fuel</p>
<p class="sm mut m0" style="text-align:center">Ask your Pilot how much fuel the rocket needs. The pool is shared with every engineer in the game.</p>`;
}

/* ---------- reports (results + final) ---------- */
function missionReport(v: HostView | PlayerView) {
  const r = v.results[v.results.length - 1];
  if (!r) return '';
  const mine = v.kind === 'player' ? v.team?.id : undefined;
  const rows = [...r.outcomes].sort((a, b) => b.points - a.points);
  return `<div class="report"><div class="report-in"><div class="title"><small>Mission ${r.round}</small><h2>Mission report</h2><p>Who made it to Mars</p>${terraBar(v)}</div>
<div class="lb" id="results">${rows.map((o, i) => `<div class="r ${o.team === mine ? 'me' : ''}" data-team="${esc(o.team)}"><span class="rank">${i + 1}</span><span class="name">${esc(o.teamName)}</span><span class="zoo">${o.animal ? o.animal.emoji : ''}</span><span class="num pts">${o.points}</span>
<span class="why ${o.status === 'landed' ? 'ok' : o.status === 'failed' ? 'bad' : ''}">${esc(o.message)}${o.rocket ? `. ${o.animal ? `${esc(o.animal.name)} (${o.animal.size}) in the ` : ''}${esc(o.rocket.name)} (${o.rocket.size}), fuel ${o.fuel} of ${o.rocket.fuel}` : ''}</span></div>`).join('')}</div></div></div>
<div class="panel" style="margin-top:16px"><h3>Standings after ${plural(r.round, 'mission', 'missions')}</h3><div class="lb" style="margin-top:10px">${v.standings.map((s, i) => `<div class="r ${s.team === mine ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="name">${esc(s.name)}</span><span></span><span class="num pts">${s.points}</span></div>`).join('')}</div><p class="sm mut">Talk it over: what did the winning team do differently this mission?</p></div>`;
}
function terraBar(v: Common) {
  const t = v.terraform;
  return `<div class="terra"><b>Mars is ${t.pct}% terraformed</b><div class="bar"><i style="width:${t.pct}%"></i></div><p class="sm m0" style="margin-top:6px;color:#ffd9c7">${t.species.length} of ${t.speciesTotal} species living there ${t.species.map(s => s.emoji).join(' ')}</p></div>`;
}
function finalReport(v: HostView | PlayerView, projector = false) {
  const f = v.final; if (!f) return '';
  const mine = v.kind === 'player' ? v.team?.id : undefined;
  return `<div class="report"><div class="report-in"><div class="title"><small>Final</small><h2>Mission report</h2><p>Notable contributions to biodiversity on Mars</p>
<p class="m0" style="margin-top:14px;font-size:20px"><b id="winner">${f.winner ? `${esc(f.winner)} wins with ${f.topPoints} points` : 'Mars is still waiting'}</b></p>${terraBar(v)}
${f.failed || f.scrubbed ? `<p class="sm m0" style="margin-top:8px;color:#ffd9c7">${[f.failed ? `${plural(f.failed, "rocket didn't", "rockets didn't")} make it` : '', f.scrubbed ? `${plural(f.scrubbed, 'mission', 'missions')} never launched` : ''].filter(Boolean).join(', and ')}.</p>` : ''}</div>
<div class="lb">${f.byRound.map((t, i) => `<div class="r ${t.team === mine ? 'me' : ''}"><span class="rank">${i + 1}</span><span class="name">${esc(t.name)}</span><span class="zoo">${t.landed.map(a => a.emoji).join('')}</span><span class="num pts">${t.total}</span></div>`).join('')}</div></div></div>
${projector ? '' : `<div class="share row"><button data-act="copyResults">Copy results</button><span class="sm mut">Paste them in the meeting chat for the debrief.</span></div>
<details class="panel share-text" ${ui.showResults ? 'open' : ''}><summary>Show results as text</summary><textarea id="results-text" readonly rows="12" aria-label="Results as text">${esc(resultsText(v))}</textarea></details>`}
<div class="final-grid"><div class="panel debrief"><h3>Debrief questions</h3><ol><li>Which role felt the most in the dark? What did you wish someone had told you sooner?</li><li>When did your team's communication start to click, and what changed?</li><li>How did the shared markets change your plans? Did you wait for a better deal or buy fast?</li><li>Did anyone sit on money or information? Why?</li><li>What's one habit from this game you'd bring to a real project?</li></ol></div><div>${planet(v.terraform.pct)}</div></div>`;
}

/* ---------- events ---------- */
function setK(k: string, val: string) {
  const [a, b] = k.split('.') as [string, string | undefined];
  if (b === undefined) (ui as unknown as Record<string, unknown>)[a] = val;
  else (ui as unknown as Record<string, Record<string, string>>)[a]![b] = val;
}
document.addEventListener('input', e => {
  const el = e.target as HTMLInputElement, k = el.dataset?.k; if (!k) return;
  setK(k, k === 'code' ? el.value.toUpperCase() : el.value);
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  if (f.dataset.form === 'join') {
    const code = ui.code.trim().toUpperCase(), name = ui.name.trim();
    if (code.length !== 4) return toast('Enter the four-letter game code.');
    if (!name) return toast('Enter your name.');
    ui.busy = true; render(); send({ t: 'join', code, name });
  }
  if (f.dataset.form === 'create') {
    const passcode = ui.pass.trim() || store.get(PASS_KEY) || undefined;
    if (ui.needPass && !passcode) return toast('Enter the host passcode.');
    ui.busy = true; render(); send({ t: 'create', passcode });
  }
});
// a little slack so clock drift between browser and server never blocks a fair purchase
const withSlack = (price: number) => Math.ceil(price * 1.03) + 1;
document.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b || (b as HTMLButtonElement).disabled) return;
  e.preventDefault();
  const d = b.dataset;
  switch (d.act) {
    case 'tab': ui.tab = d.r as Role; render(); break;
    case 'copy': navigator.clipboard?.writeText(d.v ?? '').then(() => toast('Join link copied.'), () => toast(d.v ?? '')); break;
    case 'buyAnimal': act({ a: 'buyAnimal', animal: d.id!, maxPrice: withSlack(auctionPrice(Number(d.base), Number(d.reset), serverNow())) }); break;
    case 'buyRocket': act({ a: 'buyRocket', rocket: d.id!, maxPrice: withSlack(auctionPrice(Number(d.base), Number(d.reset), serverNow())) }); break;
    case 'buyFuel': act({ a: 'buyFuel', minUnits: fuelInPool(Number(d.reset), Number(d.rate), serverNow()) }); break;
    case 'sendFuel': act({ a: 'sendFuel' }); break;
    case 'give': act({ a: 'transfer', from: 'captain', to: d.to as Role, amount: 1 }); break;
    case 'help': ui.help = !ui.help; render(); break;
    case 'qr': ui.qrBig = !ui.qrBig; render(); break;
    case 'copyResults': {
      const text = view ? resultsText(view) : '';
      const fallback = () => { ui.showResults = true; render(); ui.showResults = false; const t = $<HTMLTextAreaElement>('#results-text'); t?.focus(); t?.select(); toast("Couldn't reach the clipboard. The results are selected below; copy them from there."); };
      if (!navigator.clipboard?.writeText) { fallback(); break; }
      navigator.clipboard.writeText(text).then(() => toast('Results copied. Paste them anywhere.'), fallback);
      break;
    }
    case 'launch':
      if (Date.now() - ui.confirm > 4000) { ui.confirm = Date.now(); render(); setTimeout(render, 4100); return; }
      ui.confirm = 0; act({ a: 'launch' }); toast('🚀 Launched! Results at the end of the mission.'); break;
    case 'makeTeams': act({ a: 'makeTeams', settings: { minutes: Number(ui.set.minutes), income: Number(ui.set.income), teamSize: Number(ui.set.teamSize), rounds: Number(ui.set.rounds) } }); break;
    case 'startRound': act({ a: 'startRound' }); break;
    case 'endRound': act({ a: 'endRound' }); break;
    case 'finish': act({ a: 'finish' }); break;
    case 'newGame': act({ a: 'newGame' }); break;
    case 'addTime': act({ a: 'addTime', seconds: 60 }); break;
    case 'seatLatecomers': act({ a: 'seatLatecomers' }); break;
    case 'removePlayer': act({ a: 'removePlayer', playerId: d.id! }); break;
  }
});
window.addEventListener('popstate', () => { route = parseRoute(); render(); });

// A /play or /host link with nothing saved in this browser (shared link, restored tab,
// private window) used to hang on "Connecting…" forever. Send people to the join form instead.
if (route.kind !== 'home' && !hello()) {
  const code = route.code;
  fatal = route.kind === 'screen' ? "The big screen opens from the host's browser. Use the Open big screen button on the host page." : route.kind === 'host' ? 'That host link only works in the browser that created the game. You can join as a player here.' : "This browser isn't in that game yet. Enter your name to join.";
  go({ kind: 'home', code }); ui.code = code;
}
render();
connect();
