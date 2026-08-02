# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**
Its Prime Directives are binding. Do not rely on this file alone; the three rules that
must never be missed are inlined here because missing any one of them wastes or corrupts
other agents' work.

## ⛔ Claim the issue before you write any code

Assign the issue to yourself (`gh issue edit <n> --add-assignee @me`, or `issue_write`
with `assignees`) as the **first action of the task** — before the worktree, before the
first read. Several agents work this repo at once and an unassigned issue reads as an
open invitation: two that both start on it burn the same hours twice, then race to land
conflicting shapes for one problem. Already assigned to someone else? It is taken — pick
another or ask; never reassign it to yourself. File findings unassigned when you are only
recording them; assign at the moment you start.

All agents share one GitHub identity, so the assignee field can't tell you whether a claim
is **yours** — a claim is assign **plus a claim comment with your session ID and branch**
(`claude/issue-<n>-<slug>`), and before writing code you must re-read the comments: an
earlier claim with a different session ID means it's taken, whatever the assignee says.
(#4551 was implemented twice in one morning because this read was skipped — see #4588.)

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

## ⛔ Never edit `content/docs/releases/` in a code PR

Release notes are written **centrally, at release time** — not accreted one PR at a
time. Every code/feature/retirement PR appending its own row to the current
`releases/v<major>.mdx` turns that file into the single hottest merge-conflict magnet in
the repo (with ~18 merges to `main` in a working day, the same table conflicts over and
over, and each resolution risks dropping someone else's row). Your PR's inputs to the
release notes are the **changeset** (`.changeset/*.md` — one file per change, never
conflicts) and, for spec removals, the ADR-0087 registries; the release process compiles
them. If you believe a releases page has a factual error, file an issue or make it a
dedicated docs-only PR — never a rider on code changes.

See **AGENTS.md** for the full playbook: branch hygiene, the dev stack, PR flow, and the
rest of the Prime Directives.
