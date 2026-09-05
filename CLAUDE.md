# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**
Its Prime Directives are binding: each of the four rules that must never be missed is
inlined below as one sentence, its enforcing hook, and a pointer to the AGENTS.md heading.

## ⛔ Claim the issue before you write any code

Every agent shares one GitHub identity: the assignee field is a presence bit, the `Claim:`
comment (session ID + branch) is the identity. The session that owns a card writes both — a
seat picking for itself takes only an unassigned card, assigns itself and posts the claim
before any other action; a PM dispatch sets the assignee (step 1, done) and claims for its dev,
who still posts its own `Claim:` after checking the newest one names its branch, and ⛔ never
writes the assignee or yields the card. The comments decide, not the field: a `Claim:` from
another session or branch means taken — ⛔ never reassign; a bare assignee with no `Claim:` is
a dispatch's first step, not a foreign claim. No hook enforces this one. Full rule: AGENTS.md →
**Multi-agent working discipline**, its paragraph **Claim the issue BEFORE you write any code.**

## ⛔ Worktree-first — before your FIRST file edit (AGENTS.md Prime Directive #11)

Never edit a shared primary checkout — this repo's or any sibling repo's (`objectui`,
`cloud`); its HEAD and tree move under you. One dedicated worktree per task, per repo.
Hooks in `.claude/hooks/`: `guard-main-checkout.sh` (Edit/Write/NotebookEdit) and
`guard-main-checkout-bash.sh` (the same writes as Bash); override `OS_ALLOW_MAIN_EDITS=1`.
Full rule: AGENTS.md → **Prime Directives**, directive 11.

## ⛔ Never `git stash` — the stash stack is NOT covered by worktree isolation

`refs/stash` lives in the common `.git` dir, so all worktrees share one LIFO stack: your
`pop` takes another agent's entry and reports **success** — use a patch or a wip commit.
Hook `guard-shared-stash.sh` enforces it (override `OS_ALLOW_STASH=1`; re-run its
`.selftest.sh` if you change it). Full rule: AGENTS.md → **Multi-agent working discipline**.

## ⛔ Never edit `content/docs/releases/` in a code PR

Release notes are written **centrally, at release time**, never accreted a row per PR; a
factual error there is a dedicated docs-only PR or an issue, never a rider on code changes.
No hook: your PR's input to them is its **changeset** (`.changeset/*.md`). Full rule:
AGENTS.md → **Documentation Guardrails**, its `content/docs/releases/` row.

See **AGENTS.md** for the rest: branch hygiene, the dev stack, PR flow, the Prime Directives.
