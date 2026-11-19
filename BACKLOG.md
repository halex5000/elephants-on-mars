# Backlog

The common thread between workers. Keep it short and current. Owner is whoever is actively working an item; blank means up for grabs.

## Handoff note

*Last updated 2026-11-19 by Claude. Replace this block when you hand off; don't prepend to it.*

- **Merged today:** #4 N10 state snapshots (Dex), #3 N12 QR join (Claude), #5 N9 Copy results (Claude), #2 N11 50-team proposal (Dex), #1 Playwright bump (Dependabot).
- **State:** `main` green in CI (types, unit, integration, load, e2e, CDK, container image).
- **In flight:** Dex → N13 realistic load test. Claude → Playwright 1.65 bump (replaces Dependabot #1).
- **Next for Alex:** D1 deploy to Fly, then N1 playtest.
- **Snapshots are opt-in:** `STATE_FILE` unset = memory only. To use on Fly, add a volume at `/data`, set `STATE_FILE=/data/rooms.json`, and check `ls -ld /data` once (should be owned by `node`).

## Now

| # | Item | Owner | Status |
|---|---|---|---|
| D1 | First Fly.io deploy (steps in README) and a smoke test from a phone on cell data | Alex | Ready |
| N1 | Playtest with real people (4–8 players, 2+ missions); write down what felt slow, confusing or unfair | Alex | Ready |

## Next

| # | Item | Notes |
|---|---|---|
| N2 | Tune the economy from the playtest | All numbers live in `src/server/catalog.ts` and `src/shared/market.ts`. Economy guardrail tests in `tests/unit/engine.test.ts`. |
| N3 | Big-game fuel contention | In the 200-player load test, 50 engineers sharing one pool stretched the first mission past 4 minutes (later missions fine thanks to carried-over stock). Options: raise `FUEL.ratePerTeam`, raise the cap, or start each team with a little stock. |
| N5 | Captain's "Restart" button | The original has one; what it does isn't shown. Ask someone who's played (Alex has played the original). |
| N6 | Build and run the Docker image locally | `docker compose up --build` with OrbStack. Never built by a worker yet; Fly's remote builder or CI will be first. |
| N8 | Launch moment | One orchestrated animation when a team launches (rocket lift-off on the big screen). Respect reduced motion. |
| N13 | Realistic load test (Dex) | Next step from `docs/scale-50-teams.md`: a bot that plays default rules ($10/mission across three buyers, 4-minute clock) and per-team metrics in `tests/load/` (time to first fuel buy, rocket retries, % landed at 4:00, action→view latency). Run at 2/25/50 teams and add the numbers to the doc. Decides whether N11 sectors are needed. |
| N11 | 50-team play: market sectors + big screen | Proposal merged (`docs/scale-50-teams.md`). Waiting on N13's numbers before building. Pairs with N3. |

## Later

| # | Item | Notes |
|---|---|---|
| L1 | Deploy internally at work with CDK (optional now; primary host is Fly) | Needs: VPC ID, allowed CIDRs, ACM cert, required tags, permissions boundary, ECR/Logs reachability (NAT or VPC endpoints), and the company's process for bringing in a public repo. See README "Deploy to AWS". |
| L2 | Accessibility pass | Screen-reader labels for medals and status dots, contrast check per role color, keyboard-only play-through. |
| L3 | Rocket auction contention in huge games | With 50 teams, popular rockets stay near full price. Watch after the playtest. |
| L4 | Keep past game results | Optional storage layer (file locally, DynamoDB at work). Only if someone actually wants history. |
| L5 | Sound | Off by default; launch and timer cues. |
| L6 | Mobile app | Parked 2026-11-19. If revived: installable web app (PWA) first, Capacitor maybe, native no. |

## Done

- Big screen (N7): `/screen/CODE`, read-only projector view opened from the host page; screen sockets can't act (tested)
- State snapshots (N10, Dex): opt-in `STATE_FILE`, restores rooms, seats and timers after a crash or restart
- 50-team proposal (N11, Dex): `docs/scale-50-teams.md`
- QR code to join (N12): big in the lobby, small tap-to-enlarge during play; e2e test decodes it and joins from a phone
- Export results (N9): Copy results on the final report, with a select-and-copy fallback; fixed panels snapping shut on screen updates
- Git + public GitHub repo (MIT); employer names scrubbed from docs before going public
- Host passcode for public deploys; Fly.io and Render configs

- Server-authoritative engine with per-role hidden information, WebSocket hub, join codes, reconnects, rate limits
- Live shared markets: countdown auctions (animals, rockets), shared fuel pool
- Roles reshuffle every mission; wallets stay with roles
- Rules aligned with the original's footage: $10/mission + Give $1, letter sizes, fuel stock + Send 10, mission status strip, $ distributed/spent on the shared screen
- Visual overhaul: role-colored glass consoles, big screen over a terraforming Mars, final mission report
- Self-hosted fonts; strict CSP, no third-party requests
- AWS CDK stack: one Fargate task behind an internal ALB, with guardrail tests
- GitHub Actions CI: types, unit, integration, load, e2e, CDK synth, Docker build
- Bugs caught by tests and fixed: oversized-message crash, render recursion freezing screens, transfers lost during re-render, amount box not clearing, big-game update lag, dead play/host links hanging
