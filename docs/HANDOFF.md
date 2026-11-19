# Handoff (2026-11-19)

Written at the end of the long chat session where most of this repo was built. The workflow now centers on GitHub: **Claude Code ("C Note")** and **Codex ("Dex")** share engineering, and **Alex** sets priorities and makes product calls. Start with `AGENTS.md`, then `docs/PRODUCT.md` and `docs/ARCHITECTURE.md`.

## Status

- **Live:** https://elephants-on-mars.fly.dev, deployed from `e471eca` (#29) on 2026-11-19, which includes the new explainer video (#28). PRs #1–#30 are merged. `main` is green and there are no open PRs or issues.
- **Shipped:**
  - The full game loop.
  - Projector view, QR join, practice Scouts, seat restore.
  - Captain reclaim (−$1) and crew give-back.
  - Receipts, landing map and postcard, Copy results, compact projector.
  - Opt-in snapshots and the opt-in second auction copy.
  - Explainer video.
  - Accessibility pass with an axe gate in CI.
  - Quality gates and the manual Fly deploy workflow.

## Open bug: games vanish after a few minutes (top priority)

**Report (Alex, 2026-11-19, on Fly):** the connection drops after a few minutes, then the game is gone.

**Analysis so far:**
- A dropped socket alone should reconnect and resume, so a lost game means **the process restarted**.
- Both `fly.toml` files set `auto_stop_machines = "off"`, so Fly isn't stopping it for idleness.
- WebSocket error listeners and keepalives exist on both sides.
- Leading theory: an exception thrown in a timer callback (round end, broadcast `flush`, a practice bot's `step`) crashed the process, because nothing caught it.
- Other candidate: running out of memory (512 MB).

**Done:** #29 logs `uncaught_exception` / `unhandled_rejection` with a stack and keeps serving, with an integration test. Deployed. It's a safety net, not a root-cause fix.

**Next:**
1. Read Fly's logs:
   ```
   fly logs --no-tail | grep -iE "listening|shutdown|exit|oom|error|uncaught"
   fly machine status <id>
   ```
   Look for `uncaught_exception` stacks or `oom_killed`.
2. Fix the root cause test-first.
3. Then consider enabling snapshots on Fly: a volume mounted at `/data` and `STATE_FILE=/data/rooms.json`. That way deploys and crashes don't end games either. It needs Alex to run `fly volumes create` and accept a small extra cost.

## Unfinished and pending

| Item | State |
| --- | --- |
| N19 sound effects | Spec in `BACKLOG.md`. Assigned to Dex, not started. |
| N20 visual glow-up | Assigned to Claude, not started. Step 1 is style frames for Alex to choose from. |
| N2 economy (dominant XL strategy) | **Alex decides** after a human playtest. Findings in `docs/qa-2026-11-19.md`. |
| N1 human playtest | Alex, using `docs/playtest.md`. Not done yet. |
| N3, N5, N6, N11, N18, L1, L3, L4, L6 | See `BACKLOG.md`. |

**Small known issues:**
- Practice bots show as "offline" on the Teams screen, because they only connect during play.
- A Dependabot alert exists (alert #1 on GitHub). Its details weren't visible to the agent; probably the `minimatch` advisory in `infra/`.

## Backlog migration to GitHub Issues

`BACKLOG.md` is kept as is for migration. Item IDs (N1…, L1…) should become issue titles or labels.

**Corrections to apply while migrating** (the file is out of date in places):
- **Done; close them or skip them:** N15 practice bots (#21), N16 landing map (#20), N17 receipts (#19), L2 accessibility (#18).
- **Duplicates:** L5 "Sound" is replaced by N19.
- **Add as new issues:**
  - The vanishing-games bug above.
  - Bots shown "offline" on the Teams screen.
  - Enabling snapshots on Fly.
- Once Issues are live, retire `BACKLOG.md`, or reduce it to a pointer.

## Context that isn't in the repo

- **Alex's Mac copy is stale.** `~/Projects/elephants-on-mars` is still at the initial commit (`79788bf`), with a local, uncommitted change to `fly.toml`. Run `git pull` before working there, and don't overwrite his `fly.toml` without asking. The repo's own `fly.toml` is the one CI deploys.
- **Media tooling lives outside the repo** in `~/Projects/eom-media` on Alex's Mac:
  - ElevenLabs scripts: `voiceover.mjs`, `voices.mjs`, `npm run voiceover`.
  - Line scripts: `calm.txt`, `dramatic.txt`, `dramatic-tags.txt`.
  - Takes under `takes/`. The shipped cut is `takes/adam-tags`, Adam voice `pNInz6obpgDQGcFmaJgB`, model `eleven_v4` with audio tags.
  - The API key is in `.env.local` there. **Never read, print or commit it, and never ask for a key in chat.** ElevenLabs is only reachable from Alex's own terminal.
- **Replacing the explainer:** follow the README's "Explainer video" section: faststart `mp4`, captions `.vtt` with the `[tags]` stripped, poster at 4.2 s.
  - The storyboard renderer used to build it isn't in the repo. It drew its frames with `src/client/art.ts`.
  - The background music is Alex's licensed `Space_Music_Background.mp3`.
- **Merging:** Alex lets agents merge their own PRs once CI is green. **Deploying** is Alex's call: it's manual, and it ends any live game.
- **Model use for Dex:** Medium reasoning effort by default, High for tangled logic. Tight specs save more tokens than raising the effort level.
- **Public repo hygiene:** no employer names, account or VPC IDs, internal hostnames or secrets. Alex works at a large company; the AWS/CDK deploy exists for running the game inside its network.
