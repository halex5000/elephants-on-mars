# Backlog

The common thread between workers. Keep it short and current. Owner is whoever is actively working an item; blank means up for grabs.

## Handoff note

*Last updated 2026-11-19 by Dex.*

- **N13** is on main (#6). The realistic default-budget runs found no one-minute wait from first fuel attempt in the three 50-team rooms.
- **Auction follow-up** compares adaptive crews and extra listings in four matched conditions. Across 300 team-missions per condition: baseline 260 landed, adaptive crews 300, extra copies 300, both 300. Extra copies with fixed targets scored highest. The optional server setting is off by default. Results and reproduction steps live in [the market rehearsal](tests/load/README.md).
- **Infrastructure audit** is waiting on an AWS CDK release containing [the upstream minimatch fix](https://github.com/aws/aws-cdk/pull/39595). CDK 2.277.0 bundles minimatch 10.2.6, including after an npm override. The suggested downgrade to CDK 2.239.0 introduced four high findings. Root audit is clean and all 11 infrastructure tests passed on the original dependency. Recheck both audits after upgrading.
- **Also on main (Claude):** N7 big screen `/screen/CODE`, N8 launch moment, N9 Copy results, N12 QR join, one-click manual Fly deploy (Actions → Deploy to Fly), and a fix for roles sometimes not reshuffling (#11).
- **Next for Alex** is deploying (Actions → Deploy to Fly) and a human playtest before enabling any market rule change.

## Now

| # | Item | Owner | Status |
|---|---|---|---|
| D1 | First Fly.io deploy (steps in README) and a smoke test from a phone on cell data. Then add the `FLY_API_TOKEN` secret so later deploys are one click from Actions | Alex | Ready |
| N1 | Playtest with real people (4–8 players, 2+ missions); write down what felt slow, confusing or unfair | Alex | Ready |

## Next

| # | Item | Notes |
|---|---|---|
| N2 | Tune the economy from the playtest | All numbers live in `src/server/catalog.ts` and `src/shared/market.ts`. Economy guardrail tests in `tests/unit/engine.test.ts`. |
| N3 | Big-game fuel contention | In the 200-player load test, 50 engineers sharing one pool stretched the first mission past 4 minutes (later missions fine thanks to carried-over stock). Options: raise `FUEL.ratePerTeam`, raise the cap, or start each team with a little stock. |
| N5 | Captain's "Restart" button | The original has one; what it does isn't shown. Ask someone who's played (Alex has played the original). |
| N6 | Build and run the Docker image locally | `docker compose up --build` with OrbStack. Never built by a worker yet; Fly's remote builder or CI will be first. |
| N11 | 50-team play: market sectors + big screen | Proposal merged (`docs/scale-50-teams.md`). Default-budget results favor keeping the shared fuel pool. Trial the optional auction treatment (`EXTRA_LISTING_MIN_TEAMS`) with people before enabling it. |

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

- Launch moment (N8): a rocket lifts off over the shared screen per launch (max 3 at once, "+N more"), fades in place with reduced motion, never replayed on reload
- N13: default-budget market rehearsals at 2, 25, and 50 teams (#6).
- Opt-in second auction copy (`EXTRA_LISTING_MIN_TEAMS`, off by default) + adaptive-crew trials (#12, Dex)
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
