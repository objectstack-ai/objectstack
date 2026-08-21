---
"@objectstack/metadata-protocol": patch
"@objectstack/platform-objects": patch
---

fix(metadata-protocol): the seed/API tenancy repair now records each applied run in `sys_migration`, so "was my data rewritten, and when" survives the container being replaced (#9451)

`backfillSeedTenancy` (#8686) is the platform's only row-rewriting repair that
runs unattended: it stamps `organization_id` onto business rows, merges one
autonumber counter and deletes another. It persisted nothing about having done
so. The only evidence was one `logger.info` line, and the healthy path is silent
by design — so once that line had scrolled, a silent boot and a boot that
rewrote data were indistinguishable. The operator most likely to need the record
(a fresh install, repaired during the first admin sign-up, where nobody is
reading server stdout) was the one least likely to have captured it.

An `applied` run now writes one row into the **existing** `sys_migration`
deployment ledger — the face that already answers "has this deployment run this
data migration", and is already written at boot by the ADR-0104 attestation
path:

```sql
SELECT last_run_at, advisory, details FROM sys_migration
WHERE id = 'seed-tenancy-backfill';
```

`details` carries the run's status, the objects stamped, the organization
adopted and the identifiers that could not be adopted because they were already
minted on both sides of the split.

Deliberately narrow:

- **`applied` only.** `no-split` stays silent — a row per healthy boot would be
  a ledger of non-events.
- **`verified_at: null`, `blocking: 0`, always.** This repair runs no self-check
  and gates no consumer, so it claims no certificate; the collision count goes
  to `advisory`, which never gates. Every reader of this ledger looks a row up
  by `id`, so the new id cannot reach another migration's gate.
- **Best-effort, and loud when it fails.** A boot is never failed by
  bookkeeping (2026-08-15 ruling), so a failed receipt write is reported at
  `error` — naming that the rows *were* rewritten, that the repair is not
  retried, and what to do — rather than rethrown.
- **No new schema, no new authoring surface, no new dependency.** The row is
  written against the `@objectstack/spec/system` contract that
  `metadata-protocol` already depends on.
