# Multi-agent working discipline — the explanations behind the rules

Companion to [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline). Every paragraph below moved here
verbatim out of that section (ruling record 6417533492, letter A: the mechanism prose moves, each rule stays in
`AGENTS.md` as one executable sentence plus a pointer here). `AGENTS.md` is the authority: it carries every rule,
and where a paragraph below reads as a rule, the sentence in `AGENTS.md` is the binding spelling. To pull a
paragraph back, edit `AGENTS.md` (a governed surface, Tier H) and delete it here in the same PR, so the text
exists in exactly one place.

## The shared stash

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

`refs/stash` lives in the **common** `.git` directory, so every
linked worktree pushes onto and pops off **one shared LIFO stack**: your `pop` restores
another agent's changes, your own work stays on the stack for them to take, and `pop`
reports success — the only symptom is another agent's files in your `git status`, and a
following `git add -A` commits their work into your PR.

## Shared refs and `FETCH_HEAD`

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

**`refs/remotes/*` is shared**
— a sibling's fetch advances **your** `origin/main`, so `git checkout origin/main -- <paths>`
restores wherever that ref points **now**, possibly newer than your base: another agent's
merged work entering your tree under the name of a "revert", and **staged** on arrival by
the rule below. **`FETCH_HEAD` is per CHECKOUT — the last fetch in this checkout wins**
(a linked worktree has its own; the hazard is the shared primary checkout). It fails by
**absence**, not wrong content: split from its `git fetch` by any intervening fetch,
`git diff …FETCH_HEAD` **exits 0 printing nothing** — a confidently wrong "the change isn't
there", worst for **reviewing** seats.

## A reading names its tree

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

"Measured over the corpus" names `examples/app-crm` at
its sha, never an application it is not; a moving ref is not an anchor, for a corpus
exactly as for a `git diff`.

## Reverse verification against an uncommitted edit

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

Against an **uncommitted** edit there is no restore point at all: the
working tree is the only copy, the stash is banned above, and discarding local
modifications is a normal, silent, exit-0 operation.

## What a checkout from a ref does to the index

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

It writes the **index** as well as the working tree,
so the index holds the ref's content while the tree holds yours: `git status --porcelain`
shows `MM` and `git show :<path>` reads back the ref's copy, but `git diff HEAD` is
**clean** (it compares tree with HEAD and never consults the index), the tests pass
because they read the tree, and a bare `git commit` builds from the **index** — a commit
that deletes your own fix, in a PR whose body accurately describes a change it does not
contain.

## Windowed history on a shallow clone

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

A shallow clone answers windowed
`git log`/`rev-list` questions from truncated history at exit 0 with no warning; the tool
proves the window is covered first.

## The shared identity’s accepted blind spot

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

The
maintainer's own work under the shared account carries no claim comment and is indistinguishable
from a dispatch — an accepted blind spot; per-seat identities are not introduced.

## Unsigned writes under one identity

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

Under one shared identity every other participant's write arrives unsigned: the PM
flipping your draft to ready and arming auto-merge, a bot re-labelling, the platform
rewriting your body.

## How the platform stores a comment footer

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

**Issue comment:** the platform APPENDS that
block — blank line, `---`, bare footer — and recognises only that shape (MCP
`add_issue_comment` and direct REST agree: per-surface, not per-tool): a bare footer UNDER the
rule line is stored byte-identical, one footer; a bare footer with NO rule line above it is not
recognised and the whole block lands under it, leaving two; the session-URL form survives
verbatim and a bare one lands under it, leaving two.

## Why a stacked series is not a supported form

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

No
   tooling represents it: squash landing destroys the ancestry link, so every descendant rewinds behind what landed and
   pays a rebuild lap per landing; and a breaking changeset's ADR-0087 disposition is base-relative, so a stacked card's
   two bases demand contradictory markers.

## What the merge queue does with your PR

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

The queue rebuilds your PR
   *as merged onto the current `main`*, re-runs the subscribing workflows on that
   rebuilt generation, and lands it only if the required ones pass — the §10
   re-verification, done by the platform, race-free.

## Arming a red PR hides it

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

Arming a red PR does not queue it, it hides it:
   every poll then misreads "not on `main` yet" as "queued".

## Advisory checks ride through

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

A check outside those nine is advisory and rides through, and an advisory red
   that lands rides `main`'s merge ref into every later PR until stanched.

## Two speeds: which runs carry which battery

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

**Two speeds** (ruling record 6120820653): PR and queue runs carry the fast set, 10 minutes of
   wall per queue entry; `main`'s scheduled (4-hourly) and push runs carry the full battery — dogfood, e2e,
   `Temporal Conformance (live PG + MySQL)` — read by the publish lane before
   any approval.

## Re-arm awareness

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

**Re-arm awareness** — none of these is a reason to avoid the queue; all are reasons to
   confirm a PR is still *in* it: a red queue build **ejects** your entry and drops
   auto-merge, often on a package your PR never touched (it runs the merge group's affected
   set, not just yours) — diagnose against `merge-queue-triage.yml`'s comment, recognise a
   known-flaky signature, then re-arm once, never reflexively; **collateral eviction is
   silent** (triage comments only on `failure`, so an entry cancelled because something
   *ahead* failed gets nothing) — neither on `main` nor in the queue means dropped, re-arm;
   **flipping back to draft drops an unqueued PR's auto-merge at once**, and it does not
   return by itself — ready *first*, arm *second*. One non-fix: **a stale red does not
   clear by re-running** — `rerun_failed_jobs` reuses the original run's commit and merge
   ref, so a fix that landed on `main` since is invisible to it; only a new commit
   (`git merge origin/main`) helps. Whether a direct `gh pr merge` is refused here is
   deliberately unmeasured — do not establish it by attempting one.

## The serial-merge fallback

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

It loses badly
   under load, which is why the queue is the default path, not an optimisation.

## Why you never stop someone else’s server

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

A running dev server you didn't start probably belongs to another agent or the user;
   killing it (or its port) breaks their in-flight work.

## Stale build state after a merge: the artefacts that lie

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

A worktree open across several merges accumulates
   artefacts stale relative to the source, and every one of them fails **as if your change
   broke something** — naming other people's exports, other packages' files, or config you
   never touched:

   | stale artefact | how it presents | why it lies |
   |---|---|---|
   | `packages/spec/dist` | `check:api-surface` reports *other people's* exports as "N breaking (removed/narrowed)"; `check:i18n-coverage` rejects an example config for a value the spec allows | both read the built `.d.ts`, not `src/` |
   | `node_modules` | a package fails to resolve a dependency it plainly declares (`Cannot find package 'hono'`) | the merge moved `pnpm-lock.yaml` |
   | `packages/runtime/.objectstack/` | `datasource-autoconnect` sees each row 6× | gitignored fixture state accumulating across runs |


> ⋯ the rule sentences between these two fragments stay in `AGENTS.md`.

None of this is CI-visible (CI checks out fresh). Only
   the first row has a gate: `check:dev-prereqs` refuses `pnpm dev` on a stale
   `packages/spec/dist` (content-hash, never mtime); for every other row the prescription
   above is the whole remedy — the gate's own pass line says "existence, not freshness"
   so its green cannot be read as vouching for them.

## Why a clean merge is not a working merge

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

Git conflicts on overlapping lines; nothing warns you when two changes are
   individually fine and jointly wrong.

## Where joint breakage surfaces

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

- CI on the PR, and then the merge queue on its rebuilt generation (§7), validates the
     merge commit itself — that second CI round is where joint breakage surfaces.

## Generated artifacts and the merge driver

← [`AGENTS.md` › Multi-agent working discipline](../../AGENTS.md#multi-agent-working-discipline)

§10's "never trust git's textual merge of a generated file" is
   mechanical: `.gitattributes` routes the generator-owned artifacts to `merge=os-regen`
   (the list is the `.gitattributes` entries themselves; `pnpm check:merge-driver`
   reconciles both directions), so a merge stops only on the hand-written files that
   actually need you. The driver does **not** regenerate — git runs merge drivers while
   the worktree still holds pre-merge sources, so a generator run there would describe a
   half-merged tree; instead it records each path in `$GIT_DIR/os-regen-pending` and
   `pre-commit` refuses the commit until those artifacts check clean.


> ⋯ the rule sentences between these two fragments stay in `AGENTS.md`.

the driver exits
     0 while silently dropping one side, and no diffstat or `git diff` shows the drop, so
     only a separate regeneration commit on a known-good base lets a reviewer read "what
     main brought" apart from "what the change produces". `pre-commit` records it as a
     deferral and holds you to it — the next commit must discharge it (every commit until
     then is refused, and a second merge cannot defer onto an outstanding one), and
     `.githooks/pre-push` refuses a push that still owes one.


> ⋯ the rule sentences between these two fragments stay in `AGENTS.md`.

- **The driver is a LOCAL facility** — the merge queue rebuilds server-side where no
     custom driver runs, so the three hottest artifacts are **sharded** per category/entry
     (`authorable-surface/`, `json-schema.manifest/`, `api-surface/`) to keep parallel
     spec PRs textually disjoint; every gate reads the whole directory as one set, so
     ratchet semantics are unchanged (`packages/spec/scripts/lib/sharded-artifacts.ts`).


> ⋯ the rule sentences between these two fragments stay in `AGENTS.md`.

a local
     `git merge-tree` of any `merge=os-regen` path runs the same merge-ort machinery as
     `git merge` and therefore honours the custom driver, while GitHub runs none, so the
     two answer different questions about the same snapshot. Probe from a throwaway bare
     clone with no driver registered that FETCHES both commits (`--shared` may copy only
     what `refs/heads/**` reach; recipe: `os-regen-merge.sh`'s header): exit 1 with no
     tree id, `not something we can merge`, is a missing object, never a conflict.


> ⋯ the rule sentences between these two fragments stay in `AGENTS.md`.

- **Registration is per clone** (`pnpm install` → `prepare` →
     `scripts/setup-git-hooks.mjs`); an unregistered clone falls back to git's default
     text merge — older behaviour, not breakage.
