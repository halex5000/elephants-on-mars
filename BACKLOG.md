# Backlog

The common thread between workers. Keep it short and current. Owner is whoever is actively working an item; blank means up for grabs.

## Handoff note

_2026-11-19, Dex — N6 / [#34](https://github.com/halex5000/elephants-on-mars/issues/34): local OrbStack build, HTTP/browser smoke and clean shutdown validated. README now records commands and results; Dockerfile and Compose needed no changes. Local checks, types, build, 96 unit, 29 integration, load, 33 browser/axe and 11 infra tests plus CDK synth passed. Branch `n6-docker-validation`; review and CI are next. GitHub issue #34 carries the full validation and PR handoff._

_Moved to `docs/HANDOFF.md` (2026-11-19). This file is kept as is for migration to GitHub Issues; `docs/HANDOFF.md` lists the statuses here that are out of date._

## Now

| #   | Item                                                                                                                                                              | Owner | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------ |
| N6 | Build and run the Docker image locally ([#34](https://github.com/halex5000/elephants-on-mars/issues/34)) | Dex | Review/QA |
| N15 | Practice bots in the host lobby, team radio and human seat takeover | Dex | In review |
| N19 | Sound effects (see below) | Dex | Ready |
| N20 | Visual glow-up: style frames first, Alex picks a direction | Claude | Ready |
| N1  | Playtest with real people (4–8 players, 2+ missions); write down what felt slow, confusing or unfair                                                              | Alex  | Ready  |


### N19 · Sound effects (Dex)

- **Synthesize with Web Audio**, no audio files. Nothing to license, nothing to download, tiny bundle. One `src/client/sound.ts` with a function per cue.
- **Cues:** the last 5 seconds of an auction or mission (ticks), bid placed, outbid, won, purchase, launch (whoosh as the rocket rises), landing success, landing failure, mission results (short fanfare). Keep each under a second except launch and fanfare.
- **Who hears what:** the projector (`/screen` and the host view) plays the room-wide cues, because the host shares that tab's audio on the call. Phones play only personal cues (your bid, outbid, your purchase) and quieter, so 8 phones in one room don't make a racket.
- **Controls:** a mute button on every screen, remembered per device. Phones start muted until the first tap (browsers block audio before a gesture anyway). Host view is on by default.
- **Don't** play sounds from hidden tabs, and don't stack the same cue more than once per 100 ms (a burst of bids shouldn't machine-gun).
- **Tests:** unit-test which events map to which cue and who hears it. One e2e check that the mute toggle persists. The axe gate must stay green (the mute button needs a label).
- **Effort:** Medium. Use High only for the "who hears what" event mapping if it gets tangled.

### N20 · Visual glow-up (Claude, then split)

1. Claude makes 2–3 style frames of the projector during play and the phone console. Same layout, different looks. Alex picks one.
2. That direction turns into design tokens (color, type, motion) in the CSS, so most of it lands everywhere at once.
3. Then split by screen: Claude takes the projector and market, Dex takes the phone consoles. Each in its own PR.
4. **Must hold:** projector readable from the back of the room, compact mode (>10 teams), `prefers-reduced-motion`, axe gate green, phones fast on cell data.

## Next

- **N17 · Mission Control receipts (Dex, in review).** Give the host one factual launch story at mission results, including last-second launches and the final purchase.
- **N16 · Mars landing map (Dex, separate branch).** Build a shared animal map and downloadable host postcard.

| #   | Item                                      | Notes                                                                                                                                                                                                                                               |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N2  | Tune the economy (dominant XL strategy) | QA pass found money never binds: Orca + Mammoth = $7 for 55 pts/mission, $10 income + carryover. Options and suggestion in `docs/qa-2026-11-19.md`. **Alex decides** after a human playtest; quickest test is Money per mission = 7 in the lobby. |
| N3  | Big-game fuel contention                  | In the 200-player load test, 50 engineers sharing one pool stretched the first mission past 4 minutes (later missions fine thanks to carried-over stock). Options: raise `FUEL.ratePerTeam`, raise the cap, or start each team with a little stock. |
| N5  | Captain's "Restart" button                | The original has one; what it does isn't shown. Ask someone who's played (Alex has played the original).                                                                                                                                            |
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
