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
- **Work items are GitHub Issues** once the backlog is migrated. Until then, `BACKLOG.md`, with the corrections listed in `docs/HANDOFF.md`. Assign yourself before you start.
- **One branch per issue,** small commits, then a PR that links the issue. If two PRs touch the same file (especially `src/client/main.ts`), say so in the PR.
- **Merge** your own PR once CI is green (Alex allows it), as a squash. Never push to `main` directly or rewrite shared history.
- **Never deploy.** Deploys are manual (Actions → Deploy to Fly) and end every live game. Alex decides when.

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
