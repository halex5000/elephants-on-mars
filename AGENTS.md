# Working on Elephants on Mars

For any coding agent (Claude Code, Codex) or human. Read this first, then:

- `docs/HANDOFF.md`: current status, open bugs, context that isn't in the code.
- `docs/PRODUCT.md`: how the game works, what's shipped, what's planned.
- `docs/ARCHITECTURE.md`: modules, data flow, conventions, limits.
- `DECISIONS.md`: why things are the way they are. Read it before undoing a choice.

## Who's who

- **Alex** owns priorities and product calls (economy, rules, visual direction) and runs deploys.
- **Claude Code ("C Note")** and **Codex ("Dex")** share engineering. Either can pick up any item.

## Workflow (GitHub-centered)

- **`main` on github.com/halex5000/elephants-on-mars is the source of truth.** Start every task from the latest `main`.
- **Work items are GitHub Issues** on the Elephants on Mars Development Project. Before starting, comment on the issue as C Note or Dex with the branch/worktree, then move it to **In Progress**. Post meaningful progress, blockers, and handoffs in the issue.
- **One branch/worktree per issue,** small commits, and one PR that uses `Closes #<issue>`. If work overlaps another issue or PR (especially `src/client/main.ts`), coordinate first and call out the overlap in the issue and PR.
- **Routine PRs:** use GitHub auto-merge with squash. The merge waits for every required check and for the branch to be current with `main`; routine PRs do not require human approval. Do not merge directly or push to `main`.
- **Required checks:** CI App (lint, format, secret scan, typecheck, build, unit, integration, load, browser/axe), Infra (typecheck, tests, CDK synth), Container image, and the high-risk approval gate must all pass. A missing, skipped, cancelled, or failing required check is not a pass.
- **High-risk changes require Alex's explicit approval** through the `high-risk-approval` environment before merge. This includes `.github/workflows/`, `infra/`, deployment configuration, `AGENTS.md`, package/check configuration, secret-handling files, state snapshots, and schema/migration/storage changes. Do not bypass this gate.
- **Never bypass a failed check or weaken a test to get green.** Do not skip required jobs, use `continue-on-error` to hide failures, remove or relax assertions, or force-merge. Fix the cause and rerun the appropriate checks; if a check is flaky or broken, report it and repair the check.
- Linked issues close on successful merge; the Project's close/merge workflows move them to **Done**.
- **Never deploy.** Deploys are manual (Actions → Deploy to Fly) and end every live game. Alex decides when.

## Agent autonomy

- Implement each claimed issue in its own branch and Git worktree. The shared `main` checkout is for fetching and worktree administration only; never edit or install dependencies there.
- Follow `docs/agent-worktrees.md` for issue startup, CLI initialization, local runtime isolation, and safe cleanup.
- Routine implementation, dependency installation from the lockfile, tests, commits, branch pushes, and PR updates are pre-authorized. Do not ask about routine technical choices; record meaningful ones in the PR.
- Never copy `.env`, CDK context, tokens, credentials, or `node_modules` between worktrees. Keep dev servers on `127.0.0.1` with an issue-specific port; do not share snapshot files or runtime state.
- Stop and document a blocker before changing production secrets, billing, infrastructure, branch protection or required checks, doing destructive data work, force-pushing, merging outside the CI/auto-merge policy, deploying, or making a substantial gameplay decision. Continue unrelated safe work where practical.
- Create a follow-up issue for unrelated discoveries instead of expanding scope. Never use a CLI permission-bypass mode or work around a denied action.

## Commands

```bash
npm install                     # also installs the git hooks
npm run build && npm start      # http://localhost:3000   (GAME_SPEED=5 fast-forwards the clock)
npm run typecheck
npm run check                   # Biome lint + format check + secret scan (what CI runs)
npm test                        # unit + integration
npm run test:load               # 200 bots
npm run test:e2e                # Playwright (npx playwright install chromium first)
npm run infra:test              # CDK guardrails
```

The hooks: pre-commit runs secretlint and Biome on staged files; pre-push runs typecheck and unit tests. Don't bypass them with `--no-verify`. If a hook is wrong, fix the hook.

## Rules

1. **Hidden information stays on the server.** Each viewer gets only its own slice (`src/server/views.ts`). Client code never imports `src/server/catalog.ts`. Never weaken `tests/unit/views.test.ts`.
2. **One process, in-memory state.** Never run more than one instance. Any restart ends live games unless `STATE_FILE` is set.
3. **Nothing loads from third parties.** No CDNs, remote fonts or analytics. The CSP in `server.ts` enforces it.
4. **Faithful to the original.** Rules not shown in the original game's footage are marked _(guess)_ in the README. Don't present a guess as fact. Art is our own.
5. **TypeScript only. AWS CDK for infrastructure. Biome for lint and format.**
6. **Tests prove the change.** Fix bugs test-first, with a test that fails without the fix. Keep all suites green, including the axe accessibility gate.
7. **Public repo:** never commit secrets, employer names, account or VPC IDs, or internal hostnames. Secrets live in the host (`fly secrets`).
8. **Don't change game balance or rules on your own.** Numbers live in `catalog.ts` and `market.ts`; changing them is Alex's call.

## Before you hand off

1. Run the suites you touched and say which ones you didn't run.
2. Update the issue (or `BACKLOG.md`): status, what's half-done, what's next.
3. Add to `DECISIONS.md` if you made a choice someone might otherwise undo.
4. Update `docs/HANDOFF.md` only for cross-cutting context that doesn't belong in a single issue.
