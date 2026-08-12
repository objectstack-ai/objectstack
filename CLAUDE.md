# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**
Its Prime Directives are binding. Do not rely on this file alone; the four rules that
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
`objectui`, create a worktree in *each*. Two PreToolUse hooks enforce this, and both check
the target file's **own** repo (so sibling repos are covered): `guard-main-checkout.sh`
blocks `Edit`/`Write`/`NotebookEdit`, and `guard-main-checkout-bash.sh` blocks the same
write expressed as a **Bash** command (`>`/`>>`, `sed -i`, `perl -i`, `tee`, `cp`, `mv`,
`rm`, `touch`) — reads are never blocked, and anything it cannot parse with confidence is
allowed through, so the rule still outranks the hook. Deliberate non-task exception (both
hooks, one switch): `OS_ALLOW_MAIN_EDITS=1`. Follow the rule because it's correct, not
because the hook fires.

## ⛔ Never `git stash` — the stash stack is NOT covered by worktree isolation

`git stash` keeps its stack in `refs/stash` inside the **common `.git` directory**, so
**every worktree of the repo shares one LIFO stack**. The per-task isolation above does
not extend to it: two agents stashing in their own worktrees push and pop the *same*
stack — your `pop` restores whatever the other agent pushed a moment earlier, and your
own changes stay on the stack for them to take. `pop` reports **success**; the only
symptom is someone else's files appearing in your `git status`, and a following
`git add -A` merges their work into your PR. Not hypothetical: it happened between two
parallel agents mid reverse-verification (objectui#3430) and cost both of them their
in-flight changes, recoverable only as unreachable commits.

Use one of these instead — no shared state, all inside your own worktree:

```
git diff > /tmp/wip.patch && git checkout -- <paths>   # then: git apply /tmp/wip.patch
git commit -am wip                                     # then: git reset --soft HEAD~1
git worktree add ../objectstack-<task>-cmp <ref>       # a second tree to compare against
```

A PreToolUse hook (`.claude/hooks/guard-shared-stash.sh`) enforces this — it blocks the
`Bash` commands that push/pop/drop/clear the stack, and allows the forms that cannot take
another agent's entry: `git stash list`/`show`/`create`, and `git stash apply <sha>` /
`store <sha>` pinned to a **literal hex object id** (never `stash@{N}` — that is a
*position* in a stack you don't own). Deliberate exception: `OS_ALLOW_STASH=1`. Changing
the hook? Re-run `.claude/hooks/guard-shared-stash.selftest.sh`.

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
