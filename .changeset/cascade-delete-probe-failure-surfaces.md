---
"@objectstack/objectql": patch
---

fix(objectql): a cascade-delete dependents probe that FAILS no longer skips the referential guard — only an unprovisioned child table is read as "no dependents" (#8895)

`ObjectQL.cascadeDeleteRelations()` probes each child relation
(`find(child, { where: { fk: id } })`) to decide what the parent's delete must
do. That probe **is** the referential-integrity guard, and it sat behind a bare
`catch { continue; }` — so **any** failure of it (a connection drop, a timeout,
a permission denial, a query error, a missing column) was indistinguishable
from "this child has no rows":

- a `deleteBehavior: 'restrict'` relation never refused the delete, so a delete
  the integrity rules say must be **refused was allowed through**;
- `set_null` / `cascade` never ran, so child rows that should have been nulled
  or removed were **left orphaned**, pointing at a parent that no longer exists;
- nothing was logged and nothing was returned, so the caller was told the
  delete **succeeded**.

That is fail-OPEN on an integrity guard: the read never happened and the answer
"there are none" was invented for it (ADR-0110 D3 — "the probe found nothing"
and "the probe could not run" are different facts, and here they have opposite
meanings).

The `catch` is not removed; it is **discriminated by error type**, through the
same shared `isMissingTableError` predicate (`@objectstack/metadata/errors`)
that `seedAutonumber` and `resolveFileReferences` already use:

- **benign, unchanged** — the child object is registered but its **table** was
  never provisioned (schema sync not run yet). It cannot hold a row referencing
  anything, so zero dependents is the truth and the relation is skipped exactly
  as before.
- **everything else now surfaces** — the delete fails with the probe's own
  error, envelope intact, and nothing is written. A guard that could not be
  **evaluated** must not silently pass.

No new error code, no new response field: the caller receives the failure the
probe itself raised. The only behavioural change is that a delete which used to
report success over an unreadable child relation now reports the failure that
made the relation unreadable.
