# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**
Its Prime Directives are binding. Do not rely on this file alone; the two rules that must
never be missed are inlined here because missing either one wastes or corrupts other
agents' work.

## ⛔ Claim the issue before you write any code

Assign the issue to yourself (`gh issue edit <n> --add-assignee @me`, or `issue_write`
with `assignees`) as the **first action of the task** — before the worktree, before the
first read. Several agents work this repo at once and an unassigned issue reads as an
open invitation: two that both start on it burn the same hours twice, then race to land
conflicting shapes for one problem. Already assigned to someone else? It is taken — pick
another or ask; never reassign it to yourself. File findings unassigned when you are only
recording them; assign at the moment you start.

## ⛔ Worktree-first — before your FIRST file edit (AGENTS.md Prime Directive #11)

This repo — **and every sibling repo you touch (`objectui`, `cloud`)** — is edited by
**multiple agents at once**. The shared primary checkout has its HEAD switched and its
tree reset *under you*, silently clobbering uncommitted work. **A feature branch on the
shared checkout is NOT enough** — it still gets switched under you. You MUST be in a
**dedicated per-task worktree**:

```
git worktree add ../<repo>-<task> -b <branch> main && cd ../<repo>-<task> && pnpm install
```

Then make all edits there. This applies **per repo**: if a task spans `framework` and
`objectui`, create a worktree in *each*. A PreToolUse hook
(`.claude/hooks/guard-main-checkout.sh`) enforces this — it blocks `Edit`/`Write`/
`NotebookEdit` unless the edited file is in a linked worktree, and it checks the edited
file's own repo (so sibling repos are covered). Deliberate non-task exception:
`OS_ALLOW_MAIN_EDITS=1`. Follow the rule because it's correct, not because the hook fires.

See **AGENTS.md** for the full playbook: branch hygiene, the dev stack, PR flow, and the
rest of the Prime Directives.
