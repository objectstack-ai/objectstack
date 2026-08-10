---
"@objectstack/spec": minor
"@objectstack/platform-objects": minor
"@objectstack/objectql": minor
"@objectstack/service-storage": minor
---

fix(objectql): a value admitted by an `OS_ALLOW_LAX_*` escape hatch stops released field files from being collected (#4797)

`recordDataMigrationRun`'s contract says a deployment whose data has regressed
since it last verified closes its own gate. That only happened when a migration
was re-run — nothing told the ledger when the data actually regressed.

Normally nothing has to. Once `sys_migration` records a verified ADR-0104
migration the write path is strict, a non-conforming value is refused, and the
certificate cannot go stale. **The operator escape hatches are the exception,
and they exist precisely to relax a deployment that has already verified.** With
`OS_ALLOW_MEDIA_VALUES` / `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`
on, a non-conforming value is admitted and persisted while the row still reads
`verified_at` non-null, `blocking: 0`. Turn the switch off — or let any other
process or machine run without it — and strict returns to reject the very data
this deployment stored. Meanwhile the `adr-0104-file-references` row also governs
reclamation of released field files, so the reap guard kept **deleting bytes** on
the strength of a certificate that was no longer true, with nothing in the ledger
saying so.

**A lax-admitted write now records a deviation.** The engine's admit path — the
same sink that already tallies counterexamples for #4769 — stamps
`sys_migration.deviation_observed_at` (plus a `deviation_detail` naming the
object, field, type and parse issue) on the migration whose contract the value
broke.

**The marker gates the irreversible path, and only that.** Authority is withdrawn
in proportion to reversibility:

| behaviour | reversible? | predicate | while a deviation stands |
| --- | --- | --- | --- |
| strict value-shape enforcement (#3438) | a rejected write is retried | `isDataMigrationFlagVerified` | continues |
| tombstoning a released file (#3459 PR-5b) | lifted on re-attach | `isDataMigrationFlagVerified` | continues |
| reap guard's byte delete | **never** | `authorisesIrreversibleAction` | **refuses** |

A certificate is not a boolean; it is authority over a set of behaviours, and the
two halves are withdrawn on different evidence. One admitted write is a complete
disproof of "nothing here violates this contract" — enough to stop deleting data
forever. It is *not* evidence of the same order as the full-store scan that
earned the certificate, so it does not revoke it: doing that would turn an
explicitly temporary switch into a one-way door, forcing a full re-migration on
anyone who used the escape hatch once.

Recording without gating was rejected for the opposite reason — a marker no code
consumes is a declared-but-unenforced field, and the bytes get deleted regardless.

**Getting back to full authority is the documented route.** A real
`os migrate files-to-references --apply` / `os migrate value-shapes --apply` run
walks the whole store again, which *is* evidence of the same order, and clears
the marker.

Additive and backward compatible. A `sys_migration` row written before these
columns existed reads as "no deviation observed", so upgrading never retroactively
closes a gate a deployment earned — the marker only ever closes it on an observed
deviation. `isDataMigrationFlagVerified` is unchanged and keeps its existing
consumers; the new `authorisesIrreversibleAction` (spec) and `mayActIrreversibly`
(platform-objects) are the stronger pair, and the reap guard is their one caller.
