# Agent worktrees

Each GitHub issue gets one branch and one Git worktree. Start from the latest `origin/main`, and run both CLIs from the issue worktree root. Never implement in the shared `main` checkout.

## Create and initialize an issue worktree

Use the shared checkout only to fetch and administer worktrees; it may contain local changes. Keep worktrees beside it, not inside it, so their contents cannot appear as untracked files in the shared checkout.

```bash
REPO_ROOT="$HOME/Projects/elephants-on-mars"
ISSUE=46
SLUG=cli-autonomy
BRANCH="issue-${ISSUE}-${SLUG}"
WORKTREE="${REPO_ROOT}/../eom-issue-${ISSUE}"

git -C "$REPO_ROOT" fetch origin main
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE" origin/main
cd "$WORKTREE"
git status --short --branch
npm ci
git status --short
```

Replace the example issue number and slug. If the branch already exists, inspect `git worktree list` and resume its existing worktree; do not create a second worktree for that issue or reuse another issue's branch. If a local issue branch exists but has no worktree, use `git worktree add "$WORKTREE" "$BRANCH"` instead of `-b`. Claim the issue and set its Project status to **In Progress** before coding.

`npm ci` uses the committed lockfile and creates an independent, ignored `node_modules` in this worktree. Never copy `.env`, `infra/cdk.context.json`, credentials, tokens, or `node_modules` from another checkout. Do not create a `.worktreeinclude` file to copy ignored files into new worktrees. Stop if initialization unexpectedly changes tracked files.

## Start Claude Code

From the worktree root:

```bash
claude
```

Accept the project trust prompt so `.claude/settings.json` applies. `CLAUDE.md` imports `AGENTS.md`; run `/context all` to confirm it appears in the loaded memory files and `/sandbox` to confirm sandbox status. On macOS, Claude Code uses the built-in Seatbelt sandbox. On Linux/WSL2, install `bubblewrap` and `socat` first; this project's configuration fails closed if sandboxing is unavailable. Do not use `claude --worktree`: it creates a CLI-managed branch rather than the issue branch.

## Start Codex

From the issue worktree:

```bash
codex --cd "$WORKTREE"
```

Trust the project when prompted; Codex loads `.codex/config.toml` and `.codex/rules/` only for a trusted project. Its project instructions come from `AGENTS.md`. The optional `--approve-for-me` flag routes eligible approval requests to Codex Auto-review instead of a person. It is not enabled by this repository, does not remove the sandbox, and must not be used for work requiring a human decision about secrets, infrastructure, destructive data, or other protected actions. Do not use `--dangerously-bypass-approvals-and-sandbox` or `--yolo`.

## Keep local runtimes isolated

Use the issue number to choose ports; do not reuse ports, snapshots, or a server process across worktrees. For issue 46:

```bash
ISSUE=46
HOST=127.0.0.1 PORT=$((3200 + ISSUE)) npm run dev
```

For browser tests, use a second terminal in the same worktree:

```bash
ISSUE=46
E2E_PORT=$((4200 + ISSUE)) npm run test:e2e
```

Run these in the issue worktree. Playwright starts its own server on `E2E_PORT`. Bind dev servers to loopback, not `0.0.0.0`; do not set production credentials or share `STATE_FILE` between worktrees. Avoid Docker Compose's default published port when another server is running. Stop servers with Ctrl-C before cleanup.

## Commit, hand off, and clean up

Commit and push only the issue branch. Open one PR using `Closes #<issue>`, queue routine merges with GitHub auto-merge (`--auto --squash`), and leave CI/high-risk approval enforcement intact. Put progress, blockers, and file overlap in the issue and PR. If an action needs human approval, record the blocker and continue safe, unrelated work.

Remove a worktree only after its PR is merged, all processes are stopped, and `git status --short` is empty:

```bash
git -C "$REPO_ROOT" worktree remove "$WORKTREE"
git -C "$REPO_ROOT" branch -d "$BRANCH"
git -C "$REPO_ROOT" worktree prune
```

Do not use `--force` to remove a worktree or delete a branch. If work is uncommitted, a PR is open, or cleanup would lose changes, keep the worktree and hand it off.

## Configuration reviewed

The shared configuration was checked against Claude Code **2.1.329** and Codex CLI **0.170.0** on macOS on 2026-11-19. Claude's project settings use `acceptEdits` and its shell sandbox with no unsandboxed retry; file and command rules keep protected paths gated. Codex uses an `on-request` permission profile extending `:workspace`; its permission profiles are beta, and network proxy and command rules are experimental in this CLI. The profile denies environment files and credentials, allows loopback plus only the GitHub, npm, and Playwright hosts needed for routine work, and keeps Auto-review off by default. Neither CLI is configured with a separate model API.

Project settings apply only after the project is trusted and remain defaults, not organization-managed enforcement. Claude's sandbox strips cloud, deploy, passcode, package-registry, and model API credentials from shell subprocesses and blocks local AWS/SSH/npm credential files. Codex filters standard secret-named environment variables and `HOST_PASSCODE`. GitHub's main protection and required checks remain the enforcement boundary for merges. Do not change those rules without Alex's explicit approval.

References: [Claude Code permissions](https://code.claude.com/docs/en/permissions), [Claude Code sandbox](https://code.claude.com/docs/en/sandboxing), [Claude Code project memory](https://code.claude.com/docs/en/memory), [Codex project configuration](https://developers.openai.com/codex/config-basic), [Codex command rules](https://developers.openai.com/codex/agent-configuration/rules), [Codex Auto-review](https://developers.openai.com/codex/sandboxing/auto-review).
