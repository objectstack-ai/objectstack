---
"@objectstack/objectql": minor
---

feat(objectql): report dangling lookup references left behind by `isSystem` writes (#4551)

#4441 made the write path refuse a `lookup` id that exists in no row of the
object it references, but deliberately exempted `isSystem` writes: seed replay,
package install and boot-time provisioning legitimately write rows in an order
that is self-consistent only once the batch completes, and failing them closed
would turn an ordering detail into a boot failure. The exemption is correct, and
it left a real residual — **the platform itself could still store a reference
pointing at nothing, and nothing said so.** PR #4511 recorded that residual
rather than silently accepting it; this closes it, by reporting.

`ObjectQL.inspectDanglingReferences()` walks the non-`readonly` reference fields
of every registered object and names each stored id that resolves to no row:
object, record id, field, target object, the id itself, and the holding row's
tenant. It **reports and never rewrites** — the rows genuinely exist and were
genuinely written, so nulling a link would make the stored data disagree with
what happened, and whether the repair is to create the missing target, re-run
the seed or delete the holder is a judgement the platform cannot make.

Three properties are worth knowing before reading a report:

- **Unknown is not healthy.** The probe is the same one the write path enforces
  with. It answers "missing" only when it RAN and found nothing; an unregistered
  target, an absent driver or a probe that throws is counted into
  `undetermined`, and an unreadable object is named in `skipped`. A datasource
  outage can therefore never read as a clean bill of health.
- **`readonly` references are skipped**, as on the write path: the value there
  was minted by the platform, and at least one is a sentinel by design
  (`sys_metadata_history.recorded_by` stores `actor ?? 'system'` in a
  `lookup('sys_user')`).
- **Bounded, RBAC-first.** The RBAC link tables are visited first — a dangling
  row there is a security-surface record that resolves to nothing, and the
  audience-anchor gate has to resolve that very target to evaluate the grant.
  Per-object and total row caps bound one pass; hitting one sets `truncated`, so
  a report that stopped early cannot read as "everything was checked".

It rides the existing ADR-0057 lifecycle clock (hourly, first run delayed past
boot — exactly when seed-written references become checkable) rather than arming
a second one, so the finding surfaces without an operator knowing to go looking.
It runs *after* the sweep and is isolated from it in both directions.
`LifecycleService.sweep()` is unchanged: tooling that calls it directly still
gets policy enforcement and nothing else.

New exports from `@objectstack/objectql`: `DanglingReference`,
`DanglingReferenceReport`, `REFERENCE_SCAN_PRIORITY_OBJECTS`,
`DANGLING_SCAN_ROWS_PER_OBJECT`, `DANGLING_SCAN_MAX_ROWS`. Nothing was removed
or renamed, and #4441's enforcement is untouched.
