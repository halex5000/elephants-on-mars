# Decisions

Why things are the way they are. Add an entry when you make a choice someone might otherwise undo. Newest first.

### Visual direction: A · Mission Control (2026-11-19)

Alex picked direction A from the N20 style frames (#35, `docs/visual-directions/`). The game is mostly **screen-shared on a video call**, not projected in a lit room, so a dark theme loses nothing and the light theme (B) isn't worth tokenising every colour for. A keeps the night sky, role colours and bundled fonts, but goes flat and opaque: no `backdrop-filter`, no glows, planet stepped back so the data leads, amber for "live". The projector also gets room-scale sizing (full-width board, 22px+ player-facing text at 1080p), because the shared screen ends up as a small tile on every laptop. Must keep: compact mode above 10 teams, `prefers-reduced-motion`, the axe gate, and phones fast on cell data (no new fonts, images or dependencies). Not decided: whether to borrow C's role-coloured phone header.

### The Captain can take unspent money back (2026-11-19)

A wrong Give $1 was permanent, which made one misclick costly (found by Alex while testing). The Captain now has −$1 next to each crew member: it moves unspent money back, checked on the server, and can't touch money already spent. It's our addition (the original's footage doesn't show one), so it's marked in the README. Crew members can also give a dollar back to their Captain (#25).

### Seat recovery uses the returning tab's login (2026-11-19)

The host matches a connected waiting player to an offline seat using the join ID shown on the player's screen. The server rechecks presence when the host clicks Restore seat. The team keeps its roles, balances and purchases. The returning tab keeps its new credentials for future refreshes, and removing the old registration invalidates the original login. Display names play no part in authorization.

### Extra auction copies are an opt-in playtest (2026-11-19)

The server can assign a second independent price clock to every animal and rocket at mission start, based on the number of teams. The experiment uses a threshold of 26 teams. An unset threshold keeps the original rules. The existing role console always advertises the oldest clock, which gives the lowest price. A purchase advances only the sold copy, and the next buyer sees the other offer. The same maximum-price check protects concurrent buyers. Snapshot recovery keeps both clocks for the rest of the active mission. The next mission uses the current server setting.

### Sound: synthesized, two audiences, mapped onto a game with no bidding (2026-11-19)
Cues are made with Web Audio at play time (no files, no requests; CSP unchanged). The host and projector (`room`) hear what the whole room should: mission clock ticks for the last five seconds, purchases by any team, launches, landings, results. Phones (`personal`) hear only their own team, quieter (0.35×), so a room of phones never echoes the projector. The original spec mentioned bids, but purchases here are instant, so: *bid* = this player pressed a buy button, *outbid* = the server refused it because another team got there first, *won* = their team's purchase landed. Final-five-second ticks are for the mission clock only: auctions have no end time (they drift to a floor and wait). Mute is stored per device and per audience (`eom-sound-room`, `eom-sound-personal`): the host starts on, phones start off and opt in. Known limit: host page and projector tab open on one computer both play room cues; mute one.

### Primary host is outside work (Fly.io); AWS internal deploy is optional (2026-11-19)

At work, the internal ALB means personal phones can't reach the game without VPN, which kills "scan and play". So the main deploy is a public host for friends (Fly.io, one always-on machine, about $3.69/mo; `render.yaml` kept as a free/cheap alternative). The CDK stack stays for a deploy inside the corporate network. Netlify and Vercel don't fit: they're serverless, with no long-lived WebSockets or in-memory state.

### Public deploys use a host passcode (2026-11-19)

On the open internet anyone could create games. `HOST_PASSCODE` gates game creation only. Players still join with just a code and a name. Wrong guesses are throttled server-wide (20 a minute). No accounts: overkill for a party game.

### Scale target: ~200 players / 50 teams on one process (2026-11-19)

Alex's program is about 100 people, so plan for 100–200 at once. One Node process handles that easily: the 200-bot load test ran at ~320 MB including the bots, and updates are batched. Don't add horizontal scaling. If it's ever needed, shard by game code. The real limits at 50 teams are game design (one fuel pool and 8 rocket listings shared by 50 teams) and a crash or deploy wiping in-memory games. See backlog N3, N10, N11.

### Mobile app parked; phones play in the browser (2026-11-19)

App stores are friction for a one-hour event, and corporate phones may block unapproved apps. The responsive web client already works on phones. If we ever go further: installable web app (PWA) first, Capacitor wrapper maybe, native no.

### Fonts are bundled, not loaded from Google (2026-11-18)

Loading Google Fonts makes every player's browser call Google during a game, which breaks the "nothing leaves the network" requirement at work. Saira Condensed and Nunito Sans (SIL OFL) are copied from `@fontsource` at build time and served by the app. The CSP allows `font-src 'self'` only.

### Rules follow the original's footage; guesses are labelled (2026-11-18)

Alex wants a faithful clone. Rules come from MeetMax's "How it works" video and its gameplay frames: $10 per mission handed out with Give $1, letter sizes, two rockets per size, fuel bought from one global pool into stock and sent to the mission 10 at a time, roles reshuffled every round, a shared screen with live activity. Anything not shown (exact prices and points, the countdown-auction shape for animals and rockets, what the Captain's Restart does) is a guess and marked _(guess)_ in the README. Art is our own, inspired by the original, never copied.

### The shared screen shows Mars being terraformed (2026-11-18)

The original shows Earth from space. We show Mars gaining land, seas and an ice cap as the group's points grow. Our one deliberate departure, because it makes the shared goal visible.

### Countdown auctions for animals and rockets (2026-11-18, guess)

The video says all roles have "similar mechanics" to the fuel pool (wait for a better deal; any purchase resets it). For single items that became: price drifts from 1.5× to 0.5× of base over 90 s and snaps back to full when any team buys. Purchases carry the price the player saw (`maxPrice`) so nobody pays a surprise price.

### DOM is patched with morphdom, not replaced (2026-11-17)

Rebuilding the page with `innerHTML` on every server update threw away whatever control a player was using, which sent money to the wrong teammate. morphdom patches in place, and the render code syncs typed values explicitly. Regression tests cover both bugs.

### `GAME_SPEED` fast-forwards the game clock (2026-11-18)

The fuel pool takes minutes to fill in real games, which made browser tests slow. `GAME_SPEED` runs timers, auctions and the pool faster. The server tells browsers the speed so countdowns stay correct. Only for demos and tests.

### Internal ALB + one Fargate task (2026-11-17)

API Gateway WebSocket APIs can only be public (Regional endpoint) and App Runner doesn't support WebSockets, so neither works for an internal-only game. An internal ALB supports WebSockets natively. State is in memory (a game lasts an hour, nobody needs it afterwards), so the service runs exactly one task, and deploys stop the old task before starting the new one so two copies never split players.

### Server-authoritative, no accounts (2026-11-17)

An earlier prototype was a Claude artifact with a shared database: every player needed a Claude account, and every browser received the whole game state, so hidden info could be read in devtools. Now one Node server holds the state and sends each viewer only their slice. Players join with a four-letter code and a name; reconnect tokens live in the browser.

### TypeScript and AWS CDK (2026-11-17)

Alex's standing preference for all projects.

## Transition events are one pure mapper (#61)

`src/client/transitions.ts` turns (previous view, next view) into plain `GameEvent`s: room events for the host/projector view, team events for a phone. Sound cues (`cuesForEvents` in `sound.ts`) and the host lift-off in `main.ts` both read those events, so they can't disagree. First view, other game, other viewer kind: no events, so reloads and late joins replay nothing. Deliberately not a plugin/event bus. Future cinematic work should consume `eventsBetween`, not re-diff views. Local-action cues (bid/outbid), clock ticks, mute and hidden-tab handling stay in `sound.ts`/`main.ts` as before.
