# Product: Elephants on Mars

How the game is meant to work and why. `README.md` has the player-facing rules reference and setup. `DECISIONS.md` has the reasoning behind individual choices. Status labels below are **Shipped** (on `main` and live), **Planned** (in the backlog with a spec or owner) and **Speculative** (an idea with no commitment).

## Vision

A faithful, fan-made homage to MeetMax Games' _Elephants on Mars_ that Alex can run himself over a video call for friends and coworkers. No accounts, nothing to install: players scan a QR code or open a link on their phone and play in the browser. The game exists to make people talk. Each role sees a different slice of the information, so a team only succeeds by communicating.

- **Faithful first.** Rules come from the original's "How it works" video and gameplay footage. Anything not shown there is our guess and is labelled _(guess)_ in the README. Don't present a guess as fact.
- **Our own art and code.** Inspired by the original, never copied. The repo is public under MIT and says it isn't affiliated with MeetMax.
- **One deliberate departure:** the shared screen shows Mars being terraformed as the group scores, instead of the original's Earth.

## Session shape

- 1 host and teams of 4 (team size is a lobby setting). Target scale: about 200 players in 50 teams on one server.
- Defaults: 6 missions of 4 minutes, $10 per mission. The host can change all of these in the lobby.
- Phases: `lobby` → `teams` (the briefing, where people meet their roles) → `play` → `results` (debrief) → back to `play` for the next mission → `final` (mission report).
- Typical playtest: about 25 minutes, 4–8 players, 2 missions (`docs/playtest.md`).

## Roles and hidden information (Shipped)

| Role | Sees | Does |
| --- | --- | --- |
| Captain | Team money | Hands out money with **Give $1**, launches the rocket |
| Vet | Animal sizes and points | Buys the animal |
| Pilot | Rocket sizes and fuel needs | Buys a rocket big enough for the animal |
| Engineer | The shared fuel pool and team stock | Buys fuel into stock, sends it to the rocket 10 units at a time |

- Roles reshuffle within each team every mission (mission 1 keeps the briefing roles). Wallets belong to roles, so a reshuffle hands the wallet over.
- A player who's alone on a team holds all four roles, with tabs.
- Hidden information is enforced by the server, not just the UI: a browser never receives data its role shouldn't see.

## Mechanics (Shipped)

- **Catalog** (`src/server/catalog.ts`; numbers are ours): 11 animals in sizes S/M/L/XL worth 10–60 points, and 8 rockets, two per size: one frugal but pricier, one cheap but thirsty (fuel needs of 20–110).
- **Money:** $10 per mission to the Captain. Unspent money carries over _(guess)_.
  - Our additions: the Captain's **−$1** takes unspent money back from a crew member, and each crew member can **give $1 back** to the Captain. Both exist to undo misclicks. Spent money stays spent.
- **Animal and rocket markets** are live and shared by every team. They're countdown auctions _(guess at the video's "similar mechanics")_: a listing's price drifts from 1.5× its base down to 0.5× over 90 s, never below $1. When any team buys it, the price snaps back to full for everyone. Buying again replaces your item, with no refund.
- **Fuel** _(from the video)_: one global pool fills over time at 0.6 units/s per team (at least 1/s, capped at 400).
  - **Buy $1** takes the whole pool into your team's stock and empties it for everyone.
  - **Send 10** moves stock onto this mission's rocket. Stock carries over between missions.
- **Fairness:** a purchase is refused if the price rose or the pool was emptied since the player looked (`maxPrice` / `minUnits`), so nobody pays a surprise price.
- **Launch and scoring:** a launch succeeds if the rocket is at least the animal's size and has the fuel it needs on board. Then the animal's points count. Anything bought but not launched by the end of a mission is lost.
- **Terraforming:** everyone's points together turn Mars green and blue. The goal is 35 points per team per mission.

## Surfaces (Shipped)

- **Home:** create or join a game, plus the explainer video (63 s; dramatic ElevenLabs "Adam" voiceover with captions).
- **Host page:**
  - Lobby settings and a QR code to join.
  - Practice bots ("Scouts", up to 40 per room, marked 🤖).
  - Make teams, start and end missions, add time.
  - **Restore seat:** gives a returning player an offline seat, by matching the join ID shown on their screen.
  - **Open big screen.**
- **Big screen** (`/screen/CODE`): a read-only projector view to screen-share.
  - Timer, live purchase and launch feed, fuel pool, % launched, $ handed out and spent, team status, terraforming Mars.
  - A rocket lifts off for each launch.
  - Over 10 teams, a compact scoreboard.
  - A small "Late? Join" QR during play.
- **Phones:** one console per role, in that role's color (Captain brass, Vet green, Pilot blue, Engineer red).
  - The team's status strip.
  - Hints like "Fuel light is off. Launch anyway?" and "ask the Captain" when broke.
  - In practice crews, a team radio that shares the animal's size and the fuel needed.
- **Debrief and end:**
  - Mission Control receipts: a short factual story of each mission.
  - A Mars landing map, and a postcard the host can download.
  - A final mission report with a leaderboard and **Copy results**.
- **Access:** creating a game needs `HOST_PASSCODE` on public deploys. Players only need the code and a name. A refresh keeps your seat.

## Known design problems

- **The XL strategy dominates (decision pending: Alex).** Money never runs short: Orca + Mammoth costs about $7 for 55 points every mission, against $10 of income plus carryover. Details and options are in `docs/qa-2026-11-19.md`. The quickest test is a human playtest with Money per mission = 7.
- **Fuel contention at 50 teams:** one pool shared by 50 engineers stretched the first mission past 4 minutes in load tests.
- **Rocket contention at 50 teams:** 8 rocket listings shared by 50 teams stay near full price. An opt-in second auction copy (`EXTRA_LISTING_MIN_TEAMS`) is shipped but off until people have tried it.

## Planned

- **Sound effects (N19, Dex):** synthesized with Web Audio, no files. The projector plays room-wide cues and phones play personal ones quietly. Mute on every screen. Spec in `BACKLOG.md`.
- **Visual glow-up (N20, Claude):** first 2–3 style frames of the projector and a phone console; Alex picks one; then design tokens; then split the work by screen. Must keep projector readability, compact mode, reduced motion and the accessibility gate.
- **Final report polish (N18):** list the humans on a team, not just its bots, and fill the empty space beside a one-team leaderboard.
- **Economy tuning (N2)** and **big-game fuel (N3)**, after a human playtest.
- **Captain "Restart" button (N5):** the original has one, but what it does is unknown. Needs someone who has played the original.

## Speculative

- Saving past game results (file or database). Only if someone wants a history.
- An installable web app (PWA). The mobile app is parked: app stores add friction for a one-hour event.
- Running more than one server process. Not needed at the target scale. If it ever is, split games across servers by game code.
