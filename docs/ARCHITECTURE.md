# Architecture

The current state of `main`. For run, test and deploy commands, see `README.md`. For the reasons behind choices, see `DECISIONS.md`.

## Shape

```
phones / host / projector ──WebSocket /ws──▶ one Node 22 process
                          ◀──per-viewer views──  engine (pure rules) + views (hidden-info boundary)
                          ──HTTP──▶ static client, /healthz, /media (byte ranges)
```

- **Server-authoritative, in memory, one process.** There's no database. Games live in a `Map` in `server.ts`, so running two processes would split players into separate copies of each game. Every deploy target enforces exactly one instance.
- **No accounts.**
  - The host gets a host token, kept in `localStorage`.
  - Players get a player ID and token per tab, kept in `sessionStorage`.
  - The projector (`/screen/CODE`) reuses the host token with role `screen` and can't act.
- **Stack:**
  - Server: TypeScript 7 (`tsc`) and `ws`, its only runtime dependency.
  - Client: bundled with esbuild, patched with `morphdom`, QR codes from `uqr`.
  - No UI framework, no CDN, no third-party requests: the CSP allows `'self'` only, and fonts are bundled from `@fontsource` at build time.

## Modules

| File | Role |
| --- | --- |
| `src/server/catalog.ts` | Animals, rockets, sizes, team names, terraform goal. **Server-only**: client code must never import it. |
| `src/shared/market.ts` | Auction and fuel-pool math, plain arithmetic with no game data. Shared so the client can tick prices smoothly. |
| `src/shared/protocol.ts` | Message and view types only (`ClientMsg`, `Action`, `ServerMsg`, `HostView`, `PlayerView`, …). |
| `src/server/engine.ts` | Every rule, as pure functions on a `Game`. Rule violations throw `GameError`, whose message is shown to the player as is. |
| `src/server/views.ts` | Builds each viewer's view. `shared()` is computed once per update, then `hostView` / `playerView` add each role's slice. **This is the hidden-info boundary.** |
| `src/server/server.ts` | HTTP (static files, CSP, hashed assets, `/healthz`, byte ranges for video), the WebSocket hub, auth, rate limits, the passcode throttle, round timers, the keepalive and idle sweep, practice-bot orchestration and snapshots. |
| `src/server/index.ts` | Reads env vars and starts the server. SIGTERM/SIGINT shut it down gracefully. `uncaughtException` and `unhandledRejection` are logged and the server **keeps running** (#29). |
| `src/server/practice-player.ts`, `market-bot.ts` | Practice "Scouts": in-process bots that connect over a loopback WebSocket as ordinary players and play their role's market. `market-bot` is also used by the load tests. |
| `src/server/receipt.ts` | Mission Control receipt text. |
| `src/server/snapshots.ts` | Optional `STATE_FILE` save and restore. |
| `src/client/main.ts` | The whole UI (~900 lines): routing, the socket with reconnect and backoff, templates built as strings, the morphdom render, ticking prices and clock, launch animations. |
| `src/client/art.ts`, `landing-map.ts`, `export.ts`, `escape.ts` | SVG art (planet, rockets, icons), the landing map and postcard, Copy results, and HTML escaping. |
| `src/public/` | `index.html`, `styles.css`, and `media/` (the explainer `.mp4`, `.vtt` captions and poster). |
| `infra/` | AWS CDK app: one Fargate task behind an **internal** ALB, with guardrail tests. Optional, for a deploy at work. |

## Request flow

1. The client sends `{t:'act', action}`. The other messages are `create`, `host`, `screen`, `join`, `resume` and `ping`.
2. The server checks who's asking (host or player, and which role), then calls an engine function. A `GameError` goes back to the sender as `{t:'error'}`.
3. `broadcast(game)` batches changes for 30 ms. Then `flush` builds `shared()` once and a view per connection, and skips any viewer whose view hasn't changed.
4. The client renders a full HTML string and morphdom patches the page. Typed values, open `<details>` and playing `<video>` elements survive updates.
5. Between updates, the client ticks auction prices, the fuel pool and the clock itself, using `market.ts` and the server's clock offset (scaled by `GAME_SPEED`).

## Timers, limits, lifecycle

- **Round end:** one `setTimeout` per game (`schedule`) ends the mission at `endsAt`.
- **Every 30 s:** WebSocket ping, terminating sockets that miss a pong; games idle for 12 hours with no connections are removed. Clients also send `ping` every 25 s and reconnect with backoff (0.5–8 s), then `resume` their seat.
- **Limits:** 4 KB per message, 20 messages/s per connection, 300 players per game, `MAX_GAMES` (200 by default; Fly sets 50), 40 bots per room. Wrong host passcodes are throttled to 20 a minute across the whole server.
- **Snapshots (opt-in):** with `STATE_FILE` set, all games are written every 3 s and on shutdown, then restored on boot. **Not enabled on Fly**, because it needs a volume. So today any restart or deploy ends every live game.

## Conventions

- **Hidden info lives on the server.** `tests/unit/views.test.ts` enforces it. Never weaken those tests.
- **Balance numbers live only in `catalog.ts` and `market.ts`.** The economy guardrails in `tests/unit/engine.test.ts` keep tuning sane.
- **Fix bugs test-first:** write a test that fails without the fix.
- **Logs are JSON lines** (`{t, event, ...}`). Events include `game_created`, `round_auto_ended`, `handler_error`, `uncaught_exception` and `snapshot_error`.
- **Lint and format with Biome.** `typescript-eslint` doesn't support TS 7. Markdown isn't auto-formatted.
- **Infrastructure is AWS CDK, code is TypeScript only.**

## Tests and CI

- **Unit** (`tests/unit`): engine, views, receipts, export, landing map, practice bots, `parseRange`.
- **Integration** (`tests/integration`): a real server with bots over WebSockets at 20× clock speed, snapshots, practice bots, and the crash safety net.
- **Load** (`tests/load`): 200 players plus 5 side games.
- **E2E:** Playwright at 10× clock speed, including an axe accessibility gate (`tests/e2e/a11y.spec.ts`).
- **CI** (`.github/workflows/ci.yml`):
  - **App:** `npm run check`, typecheck, unit, integration, load, e2e.
  - **Infra:** CDK tests and synth.
  - **Container image:** builds it, runs it read-only as non-root, and hits `/healthz`.
- **Git hooks** (installed by `npm install`): pre-commit runs secretlint and Biome on staged files; pre-push runs typecheck and unit tests.

## Deploy

- **Fly.io (primary, public):** https://elephants-on-mars.fly.dev. One shared-cpu-1x machine, 512 MB, region `ewr`, never auto-stopped, `HOST_PASSCODE` set as a Fly secret.
  - Deploys are **manual**: Actions → **Deploy to Fly** → type `deploy`. The workflow requires green CI on that commit, deploys with `--ha=false`, then checks there's exactly one machine. Merging to `main` never deploys.
- **Render:** `render.yaml`, an alternative that isn't in use.
- **AWS (optional, internal only):** see `infra/` and the README. Nothing environment-specific is in the repo; it's all passed as CDK context.

## Known limitations

- **Every restart loses all games.** Live games have been reported vanishing after a few minutes. The root cause is unconfirmed: see `docs/HANDOFF.md`.
- **`main.ts` is one large file of string templates** with little unit coverage; it's mostly tested through e2e. Expect merge conflicts if two agents edit it at once.
- **After a server restart, reconnecting doesn't help:** the game is gone, so `resume` fails and the player sees "That game has ended or you were removed."
- **`minimatch` advisory in `infra/`** comes bundled inside `aws-cdk-lib`. It's deploy-time tooling only, waiting on a CDK release.
- **`DECISIONS.md` is out of date in one place:** it says crew members' give-back has "no button yet", but #25 added it.
