---
"@objectstack/core": minor
"@objectstack/runtime": minor
"@objectstack/cli": minor
---

feat(runtime,cli,core): boot reconciliation and `os migrate resume` for the migration journal — an interrupted run can no longer go unnoticed (ADR-0119 D2, #4617)

Completes ADR-0119 D2. The runner and `sys_migration_journal` landed in #4668; this is the discovery channel that makes an interrupted run findable by someone who does not already know it happened.

**`MigrationRecoveryPlugin` (`@objectstack/runtime`)** — at `kernel:ready`, scans the journal for runs that started and never concluded, and warns per run: how many chunks committed, which have an **unknown** outcome (`chunk_started` with no `chunk_done`), whether a compensation was left half-finished, and the exact command that will act. It also owns the `migration-plans` registry service.

**`os migrate resume` (`@objectstack/cli`)** — lists interrupted runs (read-only, the default), or acts on one with `--run <id>`, under confirmation. Exits non-zero when a run ends `failed`, so a scripted recovery cannot move on from a migration that needs a human.

**`MigrationPlanRegistry` (`@objectstack/core`)** — where a resume finds the plan it has to re-run.

## Boot discovers, the CLI acts

This is the design decision, and it is deliberate rather than incidental.

Resuming is a large, irreversible, potentially hour-long write against production data. Doing that as an unrequested side effect of a process starting is the kind of behaviour an operator finds out about from a graph. It is also not always possible at boot: a resume needs the plan's live callbacks, and the package that owns them may not be loaded in whichever process happened to restart first.

So boot surfaces the run and names the command; the command acts, under explicit operator intent. ADR-0119 D2's per-plan `onCrash` policy still decides **what** acting means — resume forward from the first chunk lacking `chunk_done`, or unwind what committed — it just does not decide **when**, and "when" is the part a human should own.

Deferring is safe precisely because of the runner's re-entrancy: `started ∧ ¬done` is durable, so an interrupted run stays exactly as recoverable an hour later as it was at boot. Nothing decays while the operator decides.

## Why a plan registry exists at all

A journal cannot hold a plan. `forward` and `compensate` are functions and `load()` reads the live database, so none of it crosses a process boundary — which is why the journal records the plan **hash**, not the plan. Recovery therefore needs the plan handed back by the code that owns it, and `migration-plans` is that seam: between "the journal knows a run stopped at chunk 7" and "something in this process knows what chunk 7 was supposed to do".

A run whose plan no loaded package registers is **reported**, never silently skipped — the operator is told which plan id is missing. "Nothing to resume" and "the code that owns this run is not here" are different facts, and only one of them is safe to ignore.

## Degradation

No engine, or no `sys_migration_journal` registered (a lean kernel that never composed platform-objects) → the scan is skipped in **silence**: such a kernel has no interrupted runs to find, and a warning there would train operators to ignore this plugin's output, which is the one thing it cannot afford. A scan that **fails**, by contrast, is reported — "I could not check" and "there is nothing to find" are different answers.

11 new tests pin the split (boot writes nothing to the journal), the three states an operator must tell apart (clean / interrupted / half-unwound), and both degradation paths.
