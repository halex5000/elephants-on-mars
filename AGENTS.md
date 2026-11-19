# Working on Elephants on Mars

Read this first, whoever you are (Claude, ChatGPT, Codex, or a human). Then read `BACKLOG.md` (what's next, and the latest handoff note) and `DECISIONS.md` (why things are the way they are).

## What this is

A playable, faithful homage to MeetMax Games' *Elephants on Mars*, for Alex to run with friends and coworkers. Developed and tested locally on Alex's Mac, published on GitHub, hosted publicly on Fly.io for friends (`HOST_PASSCODE` set), with an optional internal AWS deploy at work where nothing may leave the corporate network. Details: `README.md`.

## The workers

- **Alex** owns priorities and makes the calls in `BACKLOG.md` marked *Decision needed*.
- **Claude**, **ChatGPT ("Chattie G")** and **Dex** are interchangeable workers. Either can pick up any item. When one runs out of capacity, the other continues from the handoff note.

## Source of truth

- **`main` on GitHub (github.com/halex5000/elephants-on-mars) is the source of truth.** Always start from the latest `main` (`git pull`), never from a copy you made earlier.
- **One branch per backlog item** (`n10-state-snapshots`), small commits, then a pull request. CI must be green before merge. Never push to `main` directly or rewrite shared history.
- Two workers can run at once as long as they're on different branches. If two items touch the same file, say so in the PR so whoever merges second rebases.
- **This repo is public.** Never commit secrets, real account or VPC IDs, internal hostnames, or employer names. Deploy secrets live in the host (`fly secrets`, Render env vars), not in files.

## Commands

```bash
npm install
npm run build && npm start      # http://localhost:3000 (GAME_SPEED=5 to fast-forward the clock)
npm run typecheck
npm test                        # unit + integration
npm run test:load               # 200 bots
npm run test:e2e                # Playwright (npx playwright install chromium first)
npm run infra:test              # CDK guardrails
```

## Rules that keep the game honest

1. **Hidden information lives on the server.** Each role may only receive its own slice (`src/server/views.ts`). Game data (`src/server/catalog.ts`) must never be imported by client code. `tests/unit/views.test.ts` enforces this; never weaken those tests to make something pass.
2. **Nothing leaves the network.** The page loads nothing from outside the server: no CDNs, Google Fonts, analytics or remote images. The content security policy in `src/server/server.ts` enforces it.
3. **One server process, in-memory state.** Never run more than one task (the CDK stack refuses).
4. **Faithful to the original.** Rules come from the original game's video and footage where known. Anything guessed is marked *(guess)* in `README.md`. Don't present a guess as fact.
5. **TypeScript only. AWS CDK for infrastructure.**
6. **Tests prove the change.** Fix a bug by first writing a test that fails without the fix. All suites must be green before a handoff.

## Handoff checklist

Before you stop (or when you're about to run out of capacity):

1. Run the suites you touched; note anything not run.
2. Update `BACKLOG.md`: move items, set owner/status, and rewrite the **Handoff note** at the top (what you did, what's half-done, what to do next, anything surprising).
3. Add to `DECISIONS.md` if you made a choice someone might otherwise undo.
4. Commit with a message naming the backlog item, push your branch, and open a PR (or say in the handoff note why you didn't).
