---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/core": minor
"@objectstack/metadata-protocol": patch
---

feat(core,platform-objects,spec): the ADR-0119 D2 migration-journal runner — a migration killed mid-run is resumable to completion or compensable to clean, with journal rows proving which (#4617)

**The gap D1 left open.** ADR-0119 D1 made `engine.transaction()` reachable
through the contract, which is the right answer for multi-write atomicity that
fits in one transaction. Migration-class work does not fit: a million-row
backfill cannot hold one write-lock for its duration, `driver-memory`'s
`beginTransaction` deep-clones the entire database (O(db) per begin),
`ObjectQL.transaction()` binds the **default driver only** so a multi-datasource
migration silently commits part of its work outside it, and a process **killed**
— as distinct from a thrown error — defeats in-process rollback entirely. So the
unit of atomicity is the *chunk*, and durability across chunks is a journal.

Four consumers had each converged on the same four moves — dry-run preflight,
undo journal, LIFO compensation, re-entrant forward recovery (ADR-0105 D13
promotion, ADR-0117 D8's ownership backfill, the org lifecycle transitions, and
D10 master-data distribution #4585). One copy is engineering; four is platform
debt, and the fourth author would have had to rediscover the invariant below
from scratch.

**New: `runMigrationJournal` (`@objectstack/core`).** Preflight runs every
step's read-only validator before any step writes, so a plan that would fail at
step 3 has not written step 1. Rows are chunked per the `bulk-write.ts`
discipline; each chunk's writes run inside `engine.transaction()`. On failure,
committed chunks are compensated newest-first, each in its own transaction. On
restart, a rediscovered run resumes forward from the first chunk lacking
`chunk_done`, or unwinds, per the plan's `onCrash` policy. Forward and
compensate callbacks receive an `attempt` counter; `attempt > 1` means the prior
outcome is UNKNOWN and the callback must recheck by natural key before
re-writing — the same at-least-once contract `bulk-write.ts` already documents,
reused rather than re-derived.

**The invariant that carries the design:** `chunk_done(i)` is written **inside**
the chunk's own transaction, so `done ⇔ committed` holds by construction;
`chunk_started(i)` is written autonomously **before** it. That asymmetry is what
gives `started ∧ ¬done` exactly one meaning — *the outcome is unknown* — which
is the only state a crash can leave and the only state recovery reasons about.
Making both writes symmetric would look tidier and would destroy recovery.

**New: `sys_migration_journal` (`@objectstack/platform-objects`).** Rows keyed
`(run_id, seq)` under a unique index, so a resumed run that miscomputes its next
sequence fails loudly rather than double-recording an event. Registered
unconditionally alongside `sys_migration` because recovery must be discoverable
with **zero host wiring** — a journal some kernels compose and others do not is
a journal a boot scanner cannot rely on (ADR-0078). Distinct in grain from
`sys_migration`, which holds one durable verdict per named migration; this holds
many rows per *run*. Read-only over the API; writes go through the runner in
system context.

**The runner refuses rather than degrades**, in four places: the runtime cannot
roll back; any preflight fails; the plan declares `onCrash: 'compensate'` but a
step cannot compensate; or a resume's plan hash disagrees with the journal
(resuming a changed plan would apply chunk boundaries the journal never
described). A compensation failure halts and is journalled — never swallowed —
and the run ends `failed`, not `compensated`, because a database in a state no
clean story covers must not be reported as a tidy rollback.

**`engineCanRollBack` is now shared.** The two-level probe (engine method AND
default-driver `beginTransaction`) was the same condition written twice — here
and in `batchData`'s atomic gate. It now lives in `@objectstack/core` and
`@objectstack/metadata-protocol` imports it, as a type predicate so callers do
not each re-narrow the optional member by hand. Two copies of "can this runtime
actually roll back?" drift by one clause and leave one caller believing it has
atomicity it does not have.

Boot reconciliation and `os migrate resume` land separately; `findInterruptedRuns`
is the discovery primitive they will consume, and is exported here.

**Docs:** ADR-0118 (plugin-reachable transactions) is renumbered **ADR-0119**.
It merged one day after an unrelated ADR-0118 (非用户 actor 的平台契约) and the
earlier merge holds the number; citations of "ADR-0118 D1/D2/D3/D4" written
before 2026-08-03 mean the renumbered record.
