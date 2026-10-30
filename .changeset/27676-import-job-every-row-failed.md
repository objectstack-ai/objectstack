---
'@objectstack/rest': patch
---

fix(rest)!: an async import job whose every row failed ends `failed`, not `succeeded` (#27676)

Clause-②: no (narrowing) — the async import job's `succeeded` status is no longer emitted for a job that imported nothing; it now reads `failed`. No value, key or shape is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: one already-declared status value (`failed`) is now emitted for a job that created, updated and skipped no row. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** a published status value changes meaning at one REST door (`@objectstack/rest`), per maintainer ruling B (record 6509036166).

- **Before.** A job of `POST /data/:object/import/jobs` that was not cancelled and did not throw ended `succeeded`, even when every row failed and nothing was written. The only sign was `errors` equal to `total`.
- **Now.** A job that was not cancelled, had at least one row, and created, updated or skipped none of them ends `failed`. Its `error` says every row failed and points at the job's `results`, which still carry each row's reason. A dry run follows the same rule: a dry run whose every row is invalid ends `failed`.
- **Unchanged, on purpose.** A job whose rows partly failed still ends `succeeded`. So does a job whose every row was skipped (for example `writeMode: 'update'` with no match), and a job with no rows. A cancel still wins: a cancelled job ends `cancelled` whatever its rows did. Counts and `results` are written as before.
- **Who sees it.** A client that polls an import job and branches on `status === 'succeeded'` is now told `failed` for a job that imported nothing. Undo is unaffected: such a job wrote nothing, so it was never undoable.

**The remedy.** Read `failed` as "this job imported nothing"; read `errors` and `results` for why. A client that wants to treat such a job as finished can treat `succeeded` and `failed` alike as terminal, as before.
