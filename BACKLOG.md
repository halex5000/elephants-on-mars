# Backlog

The common thread between workers. Keep it short and current. Owner is whoever is actively working an item; blank means up for grabs.

## Handoff note

**N10 · Dex · 2026-11-19.** Optional periodic JSON checkpoints and timer restoration are ready for review. Recovery tests cover reconnects and deadlines. To enable on Fly, mount writable persistent storage and set `STATE_FILE`. The production configuration is unchanged.

*Last updated 2026-11-19 by Claude.*

- **Done this session:** architecture and scale review (see DECISIONS, 2026-11-19 entries). Added `HOST_PASSCODE` (server + client + tests), `fly.toml` (primary host) and `render.yaml`, and README deploy steps. Clean-folder build of the Docker steps passes. A real `docker build` still hasn't run (no daemon here); Fly's remote builder will be the first.
- **Files changed:** `src/shared/protocol.ts`, `src/server/server.ts`, `src/server/index.ts`, `src/client/main.ts`, `tests/integration/game.test.ts`, `tests/e2e/game.spec.ts`, `tests/e2e/env.ts` (new), `playwright.config.ts`, `fly.toml` (new), `render.yaml` (new), `README.md`, `DECISIONS.md`, `BACKLOG.md`.
- **State:** all suites green (79 unit, 19 integration, load, 12 e2e, 11 infra).
- **Next up:** Alex deploys to Fly (D1), then the playtest (N1). Workers: N10 and N11 are ready to pick up.
- **Now on git:** github.com/halex5000/elephants-on-mars (public, MIT). Work on a branch, open a PR, let CI go green. Don't commit to `main` directly. See AGENTS.md.

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
| N7 | Separate big-screen URL for the projector | e.g. `/screen/CODE`: read-only shared screen without host controls, so the host can screen-share it cleanly. |
| N8 | Launch moment | One orchestrated animation when a team launches (rocket lift-off on the big screen). Respect reduced motion. |
| N10 | State snapshots (Dex, in review) | Save game state every few seconds (file on Fly, or skip) and reload on boot, so a crash or redeploy doesn't end a live game. Clients already reconnect and resume. Touches `server.ts`. |
| N11 | 50-team play: market sectors + big screen | Group teams into sectors of ~6–8 that share a market, or scale listings with team count. Big screen needs sector summaries / top 10 instead of 50 rows. Design doc first: `docs/scale-50-teams.md`. Pairs with N3. |
| N9 | Export results | The original sends leaderboards and screenshots after the event. A "Copy results" / download of the final report. |

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

- QR code to join (N12): big in the lobby, small tap-to-enlarge during play; e2e test decodes it and joins from a phone
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
