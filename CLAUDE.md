# CLAUDE.md

**[AGENTS.md](./AGENTS.md) is the source of truth for working in this repo — read it.**
Its Prime Directives are binding: each of the four rules that must never be missed is
inlined below as one sentence, its enforcing hook, and a pointer to the AGENTS.md heading.

## ⛔ Claim the issue before you write any code

Claim it **before any other action**: assign yourself *and* comment your session ID and
branch — the shared identity makes the assignee field no proof, so re-read the comments.
A card a PM dispatch order sent you to arrives **already assigned** (that is the PM's half
of the claim, made for you): leave the field alone, still post the comment, and ⛔ never
yield the card back on the strength of that assignee. No hook enforces this one. Full
rule: AGENTS.md → **Multi-agent working discipline**, its paragraph **Claim the issue
BEFORE you write any code.**

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
