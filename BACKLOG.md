# Backlog

The common thread between workers. Keep it short and current. Owner is whoever is actively working an item; blank means up for grabs.

## Handoff note

_Last updated 2026-11-19 by Dex. Replace this block when you hand off; don't prepend to it._

- **Live:** https://elephants-on-mars.fly.dev (deployed from Actions → Deploy to Fly; 1 machine; host passcode enforced). Main is green.
- **Quality gates are on (#14):** run `npm install` once to get the git hooks. Pre-commit = secret scan + Biome format/lint on staged files; pre-push = typecheck + unit. CI runs `npm run check`. Markdown isn't auto-formatted.
- **N14 merged (#16):** A host can restore an offline seat to a connected, unseated newcomer during briefing, play or results. Match the join ID on the call. The returning tab keeps its login and the previous login expires. Covered by engine, WebSocket and phone-sized browser tests. Rehearse this once during N1.
- **In flight:** Dex → **N15 practice bots** ready for review alongside N16 (Mars postcard, #20) and N17 (Mission Control receipts, #19). Rehearse one human and three Scouts during N1. Claude → L2 accessibility (#18), then **Captain "Take back $1"** (engine + Captain console).
- **Crew wallets (Dex, in review):** Vet, Pilot and Engineer can return one unspent dollar to their Captain during a mission. Try a return from a phone during N1.
- **Infra audit:** `minimatch` advisory in `/infra` is bundled inside `aws-cdk-lib` (npm overrides can't reach it), deploy-time tooling only. Upgrade CDK once a release includes the upstream fix, then rerun both audits.
- **Next for Alex:** phone-on-cell-data smoke test on the live URL, then the playtest with `docs/playtest.md`.

## Now

| #   | Item                                                                                                                                                              | Owner | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| N15 | Practice bots in the host lobby, team radio and human seat takeover | Dex | In review |
| N1  | Playtest with real people (4–8 players, 2+ missions); write down what felt slow, confusing or unfair                                                              | Alex  | Ready  |

## Next

- **N17 · Mission Control receipts (Dex, in review).** Give the host one factual launch story at mission results, including last-second launches and the final purchase.
- **N16 · Mars landing map (Dex, separate branch).** Build a shared animal map and downloadable host postcard.

| #   | Item                                      | Notes                                                                                                                                                                                                                                               |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N2  | Tune the economy (dominant XL strategy) | QA pass found money never binds: Orca + Mammoth = $7 for 55 pts/mission, $10 income + carryover. Options and suggestion in `docs/qa-2026-11-19.md`. **Alex decides** after a human playtest; quickest test is Money per mission = 7 in the lobby. |
| N3  | Big-game fuel contention                  | In the 200-player load test, 50 engineers sharing one pool stretched the first mission past 4 minutes (later missions fine thanks to carried-over stock). Options: raise `FUEL.ratePerTeam`, raise the cap, or start each team with a little stock. |
| N5  | Captain's "Restart" button                | The original has one; what it does isn't shown. Ask someone who's played (Alex has played the original).                                                                                                                                            |
| N6  | Build and run the Docker image locally    | `docker compose up --build` with OrbStack. Never built by a worker yet; Fly's remote builder or CI will be first.                                                                                                                                   |
| N18 | Final report polish | Leaderboard lists a team's bots but not its humans; big empty area beside a one-team leaderboard. From the QA pass. |
| N11 | 50-team play: market sectors + big screen | Proposal merged (`docs/scale-50-teams.md`). Default-budget results favor keeping the shared fuel pool. Trial the optional auction treatment (`EXTRA_LISTING_MIN_TEAMS`) with people before enabling it.                                             |

## Later

| #   | Item                                                                   | Notes                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Deploy internally at work with CDK (optional now; primary host is Fly) | Needs: VPC ID, allowed CIDRs, ACM cert, required tags, permissions boundary, ECR/Logs reachability (NAT or VPC endpoints), and the company's process for bringing in a public repo. See README "Deploy to AWS". |
| L2  | Accessibility pass (Claude, in progress)                               | Screen-reader labels for medals and status dots, contrast check per role color, keyboard-only play-through.                                                                                                     |
| L3  | Rocket auction contention in huge games                                | With 50 teams, popular rockets stay near full price. Watch after the playtest.                                                                                                                                  |
| L4  | Keep past game results                                                 | Optional storage layer (file locally, DynamoDB at work). Only if someone actually wants history.                                                                                                                |
| L5  | Sound                                                                  | Off by default; launch and timer cues.                                                                                                                                                                          |
| L6  | Mobile app                                                             | Parked 2026-11-19. If revived: installable web app (PWA) first, Capacitor maybe, native no.                                                                                                                     |

## Done

- QA pass (Claude): Launch no longer looks ready on short fuel, phones show every animal/rocket, bought items show the price paid, broke players are told to ask the Captain. Findings: `docs/qa-2026-11-19.md`
- Seat swap (N14, Dex, #16): host restores an offline seat to a returning player by join ID; old login retired
- First deploy to Fly (D1) via the one-click workflow; live smoke check passed
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
