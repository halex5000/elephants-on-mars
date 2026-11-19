# Elephants on Mars

A multiplayer team-building game for a video call, built as a playable homage to [MeetMax Games' *Elephants on Mars*](https://meetmaxgames.com/elephants-on-mars) so you can run it with your own friends and coworkers. Players split into teams of four, each person gets a random role, and every role sees a different piece of the puzzle. The only way to get an animal to Mars is to talk to each other.

*Fan-made and not affiliated with or endorsed by MeetMax Games. All code and art here are original.*

- **Captain** holds the money and the launch button.
- **Vet** buys the animal and is the only one who sees animal sizes and points.
- **Pilot** buys a rocket big enough to carry it, and is the only one who sees what each rocket carries and how much fuel it needs.
- **Engineer** gathers fuel from a pool shared by every engineer in the game.

A rocket that's too small or short on fuel doesn't make it. All the markets are live and shared by every team. Roles reshuffle every mission. The host runs the clock and shares results for a debrief between missions.

## Run it locally

Needs Node 22+.

```bash
npm install
npm run build
npm start                 # http://localhost:3000
```

Or `npm run dev` to rebuild the client and restart the server on changes, or `docker compose up --build` to run the same container that runs in AWS.

**Play it solo:** open one tab as the host (**Create a game**), then open four more tabs at the join link. Each tab is its own player (identity is per tab), so you can drive all four roles yourself. A single player who joins alone gets all four roles with tabs. `GAME_SPEED=5 npm start` makes the fuel pool fill faster while you poke around.

## How it works

```
 browser (host)  ─┐
 browser (vet)   ─┤   WebSocket /ws    ┌──────────────────────────────┐
 browser (pilot) ─┼──────────────────▶ │ Node server (one process)    │
 browser (...)   ─┘                    │  engine.ts  rules, pure      │
                                       │  views.ts   what each role   │
                                       │             is allowed to see│
                                       └──────────────────────────────┘
```

- **Server-authoritative.** The browser holds no game data. After every change the server sends each connection a view built for that viewer (`src/server/views.ts`), so hidden information isn't just hidden in the UI, it never reaches the wrong browser.
- **In-memory state, one process.** A game is an hour long and nobody needs it afterwards, so there's no database. That's also why the AWS service runs exactly one task.
- **No accounts.** The host gets a four-letter code and a host link; players join with a name. Reconnect tokens live in the browser (host: `localStorage`, players: `sessionStorage`), so a refresh keeps your seat.
- **Batched updates.** Changes within 30 ms go out as one update, shared parts are computed once, and nobody is sent a view identical to their last one.

Layout:

```
src/server/catalog.ts   animals, rockets, balance numbers (server-only)
src/shared/market.ts    live-market math (auctions, fuel pool), shared with the client
src/server/engine.ts    every rule, pure functions, unit-tested
src/server/views.ts     per-viewer projection (the hidden-info boundary)
src/server/server.ts    HTTP + WebSocket hub, timers, limits
src/shared/protocol.ts  message types (types only, safe for the client)
src/client/main.ts      browser UI (bundled with esbuild)
src/client/art.ts       hand-drawn SVG: the terraforming planet, rockets, icons
infra/                  AWS CDK app (internal-only deploy)
tests/                  unit, integration, load, e2e
```

## Tests

| Command | What it covers |
|---|---|
| `npm run typecheck` | strict TypeScript, server + client |
| `npm run test:unit` | rules, money, scoring, marketplace, fuel math for every combination, and the hidden-info contract per role |
| `npm run test:integration` | real server + bot players over WebSockets (20× game clock): full games through the live markets, a wrong-rocket sabotage game, role reshuffles, doubled-up roles, auth, rate limits, oversized frames, reconnects, timer auto-end, host passcode and its guess throttle |
| `npm run test:load` | one 200-player game (50 teams) plus 5 side games at once; fails if anything doesn't land or a round is slow. Market collisions (two teams going for the same thing) are reported, not failed. `PLAYERS=300 GAMES=10` or `LOAD_URL=http://host:3000` to hit a running server |
| `npm run test:e2e` | Playwright with a 10× game clock: host + 4 players in separate browsers play a mission through the live markets (Give $1, Take, Buy, Buy $1 → Send 10, Launch), plus the first-time host passcode flow, a QR test that decodes the on-screen code and joins with it, role reshuffle, live ticking, reload, timer, solo, phone width, dead links, and a regression test for Give $1 during heavy updates. Any uncaught browser error fails the test |
| `npm run infra:test` | CDK guardrails: internal-only ALB, no public IPs, never more than one task, CIDR-restricted, tags and permissions boundary applied |
| `npm run test:all` | everything above except infra |

If Playwright can't download its browser (locked-down networks), point it at an installed Chrome: `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e`.

CI (`.github/workflows/ci.yml`) runs all of it, synthesizes the CDK app, and builds and boots the container read-only.

## Deploy outside work (Fly.io or Render)

For playing with friends: a public HTTPS URL, phones on cell data just work. Both configs run the same Dockerfile as one instance. **Game state lives in memory, so never run more than one instance, and don't deploy during an event** (the default configuration loses rooms on restart).

Set `HOST_PASSCODE` on any public deploy. Only people with it can create games. Players never need it, and the browser remembers it after the first game.

### Fly.io (recommended, ~$3.69/mo always on)

`fly.toml` runs one shared-cpu-1x / 512 MB machine in `ewr` (Secaucus) that never auto-stops.

```bash
brew install flyctl
fly auth login
fly launch --no-deploy --copy-config   # keep our fly.toml; pick a unique app name
fly secrets set HOST_PASSCODE='something-long-and-silly'
fly deploy --ha=false                  # --ha=false: exactly ONE machine
fly scale show                         # confirm count = 1
fly ips list                           # shared IPv4 is free; you don't need a dedicated one ($2/mo)
```

Then open `https://<app>.fly.dev`. Logs: `fly logs`.

### Render (free tier to try, $7/mo Starter to keep)

`render.yaml` is a Blueprint. Push the repo to GitHub, then in Render choose **New → Blueprint**, pick the repo, and enter `HOST_PASSCODE` when asked. The free plan sleeps after 15 minutes without traffic and takes about a minute to wake, so open the site a few minutes before you play. Switch `plan` to `starter` to keep it awake.

## Deploy at work (AWS, internal only)

One Fargate task (0.25 vCPU / 0.5 GB, ARM) in private subnets behind an **internal** Application Load Balancer. Nothing is internet-facing and the app makes no outbound calls. (API Gateway WebSocket APIs can't be private and App Runner doesn't support WebSockets, which is why it's an ALB.)

Nothing environment-specific is in this repo. Pass it as context:

```bash
cd infra
npm install
npx cdk bootstrap            # once per account/region, if your org hasn't already
npx cdk deploy \
  -c vpcId=vpc-xxxxxxxx \
  -c allowedCidrs=10.0.0.0/8 \
  -c certificateArn=arn:aws:acm:...:certificate/... \
  -c tags=cost-center=1234,owner=you \
  -c permissionsBoundaryArn=arn:aws:iam::...:policy/YourBoundary
```

| Context key | Default | Notes |
|---|---|---|
| `vpcId` | create a new isolated VPC | Use your existing internal VPC. Its private subnets need a route to ECR and CloudWatch Logs (NAT or VPC endpoints). |
| `subnetIds` | VPC's private subnets | Comma-separated. |
| `allowedCidrs` | the VPC's CIDR | Who can reach the ALB, e.g. corporate/VPN ranges. |
| `certificateArn` | none (HTTP on 80) | With it: HTTPS on 443, 80 redirects. |
| `imageUri` | build from the Dockerfile | Use an image from your internal registry instead. |
| `desiredCount` | `1` | `0` parks it between game nights. Anything above 1 is refused. |
| `permissionsBoundaryArn` | none | Applied to every role the stack creates. |
| `tags` | `app=elephants-on-mars` | `key=value,key=value`. |
| `logRetentionDays` | `14` | |
| `stackName` | `ElephantsOnMars` | |

`cdk.context.json` is git-ignored on purpose: CDK writes looked-up VPC and account details there.

**Park it between games:** `npx cdk deploy -c desiredCount=0 ...` (or `aws ecs update-service --desired-count 0`). The ALB still costs a little while it exists; `npx cdk destroy` removes everything.

**Things to know:**
- The default task has ephemeral storage. Deploy between game nights or configure durable storage for checkpoints.
- The deployment stops the old task before starting the new one, so there's a minute or two of downtime. That's deliberate: two tasks would split players into separate games.
- Logs are JSON lines in CloudWatch: `game_created`, `player_joined`, `round_auto_ended`, `socket_error`.

## Recovering active rooms

Set `STATE_FILE` to a private path such as `/data/rooms.json` to enable checkpoints. Create the parent directory first and grant the container's `node` user write access. Keep it outside the public web directory. The file contains all room data, including host and player reconnect credentials. Store it on the server only and restrict access.

One process writes all rooms every three seconds using an atomic file replacement and saves once more on graceful shutdown. On boot it restores unexpired rooms with the same join codes, seats and privileges. The original mission deadline still applies during downtime. Overdue missions open on their results screen. A hard crash can lose moves since the last completed write. A failed periodic write logs `snapshot_error` and is retried on the next interval. A malformed or unsupported snapshot stops startup so the file can be recovered.

For Fly redeploys, attach a persistent Fly Volume in the machine's region, mount it at `/data`, ensure it is writable by the app, and set `STATE_FILE=/data/rooms.json`. A volume costs extra. A file in the machine's root filesystem can disappear on replacement. Keep exactly one machine attached. Leaving the variable unset preserves the default memory-only behavior.

## Server settings

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `HOST` | `0.0.0.0` | |
| `MAX_GAMES` | `200` | concurrent games per process |
| `PUBLIC_DIR` | `dist/public` | |
| `HOST_PASSCODE` | *(none)* | If set, creating a game needs this passcode (players never do). Set it on any public deploy. Wrong guesses are throttled to 20 a minute server-wide. |
| `GAME_SPEED` | `1` | Fast-forwards the game clock (timers, fuel pool, auctions). For demos and tests only. |

Built-in limits: 300 players per game, 4 KB per message, 20 messages per second per connection, idle games removed after 12 hours.

The page loads nothing from outside the server: no CDNs, fonts or analytics.

## Game rules reference

Sourced from the original's "How it works" video and its gameplay footage where possible; marked *guess* where it doesn't show.

- **Missions:** 6 by default, 4 minutes each (host can change both in the lobby).
- **Roles** are random and reshuffle within each team every mission (mission 1 keeps the briefing roles). Wallets belong to roles, so a reshuffle hands the wallet over.
- **Money:** the Captain gets $10 every mission and hands it out with **Give $1** buttons, like the original. Unspent money carries over *(guess)*.
- **Animals** have a size (S, M, L, XL) and points. Only the Vet sees them.
- **Rockets** have a size and the fuel they need. A rocket carries any animal its size or smaller. Each size comes in a pricier frugal model and a cheap thirsty one *(numbers are ours)*. Only the Pilot sees them.
- **Animal and rocket markets: countdown auctions** *(guess at the video's "similar mechanics")*. Each listing's price drifts from 1.5× its base down to 0.5× over 90 seconds, never below $1. When any team buys it, it snaps back to full price for everyone. Buying again replaces your item; no refunds.
- **Fuel** *(from the video)*: one global pool shared by every engineer, filling at 0.6 units/second per team (minimum 1/s, capped at 400). **Buy $1** takes the whole pool into your team's stock and empties it for everyone. **Send 10** loads fuel from stock onto this mission's rocket. Stock carries over between missions.
- **Fairness:** a purchase is refused if the price jumped or the pool was emptied since the player looked, so nobody pays a surprise price.
- **Launch:** succeeds if the animal fits the rocket and the rocket has at least the fuel it needs. Anything bought but not launched by the end of a mission is lost.
- **Scoring:** a landed animal scores its points. Every team's points together terraform Mars (shown after each mission, and on the shared screen's planet).
- **Shared screen:** the host view shows the timer, a live feed of every purchase and launch, the fuel pool, % launched, $ distributed and $ spent, and each team's status.
- *Not implemented:* the original Captain screen has a "Restart" button; what it does isn't shown.

All balance numbers live in `src/server/catalog.ts` and `src/shared/market.ts`; `tests/unit/engine.test.ts` has economy guardrails that keep tuning sane.

## Look and feel

Phone-first glass consoles with one accent per role (Captain brass, Vet green, Pilot blue, Engineer red), a shared screen over a Mars that turns green and blue as the group terraforms it, and a final "Mission report" leaderboard. All art is hand-drawn SVG in `src/client/art.ts`. Fonts (Saira Condensed and Nunito Sans, both SIL Open Font License) are bundled and served by the app itself, so no player's browser calls out to Google or any other third party; the server's content security policy enforces that.

## License

MIT. See `LICENSE`.
