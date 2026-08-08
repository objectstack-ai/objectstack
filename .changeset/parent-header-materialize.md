---
"@objectstack/objectql": patch
---

fix(objectql): materialise the master-detail header a `parent`-scoped predicate reads (#6457)

`readonlyWhen: parent.status == 'paid'` and `requiredWhen: parent.status == 'sent'`
are documented **server** guarantees (#4889 / #4977 bound the `parent` root at the
write path so they are enforced by the engine and not only by the inline grid).
What was still storage-dependent is what that bound header CONTAINS. The engine
resolved it with a plain driver read and passed the row through as-is, so a driver
that returns only the columns it stored handed the predicate a header missing the
very key it reads.

CEL is strict about missing keys, and the resulting fault is `No such key: status`
— **not** `Unknown variable: parent`, because `parent` IS bound. That misses
#4889's fail-closed carve-out and takes the ordinary fail-OPEN exit, so:

- a `readonlyWhen` lock was **let through** and the frozen field was written;
- a `requiredWhen` requirement was **not enforced** and the record was accepted
  with the field empty.

Whether a declared lock or requirement enforced anything therefore depended on
which columns the driver happened to echo back — something the author who wrote
the predicate cannot see or control. This is #4953's trap on a different root:
the 2026-08-06 ruling made `record` / `previous` total at every server seam and
deliberately left `parent` out, as an ABSENT `parent` is the fail-closed signal.

**The header is now made TOTAL over the MASTER object's declared fields** inside
`ObjectQL.resolveMasterDetailParent` and `resolveMasterDetailParents` — the only
place holding both the master's schema and the just-read row, so one change
serves both consumers and no strip/validator signature moves. It reuses the same
`materializeDeclaredFields` helper as every other server seam (#1871/#4649/#4953),
covers the single-id, bulk and insert paths, adds no query (the declared-field
table is a registry lookup, read once per batch), and copies each header before
materialising so the stored row never gains materialised nulls.

**Verdicts move, in both directions, and only for a header that RESOLVED:**

| header state | before | now |
|---|---|---|
| carries the key | evaluates per verdict | unchanged |
| resolved, key absent | fault ⇒ fail-OPEN (lock let through / requirement skipped) | evaluates — the key reads `null`, so locks lock and requirements enforce |
| unresolvable (`null`) | `readonlyWhen` LOCKED (#4889) / `requiredWhen` fail-OPEN (#4977) | **unchanged** |

The bottom row is the one thing this change does not touch. Materialisation is
only ever applied to a header row that exists, so an unresolvable header still
leaves `parent` unbound, still faults as `Unknown variable: parent`, and is still
read as LOCKED for `readonlyWhen` — and still fail-OPEN for `requiredWhen`, the
deliberate #4977 asymmetry. The two cases stay distinguishable by fault channel,
and both are pinned.

**Consequences worth knowing before writing a `parent`-scoped predicate**, the
same two `declared-fields.ts` states for `record`:

- `has(parent.<declared field>)` is now uniformly TRUE — a materialised `null` is
  a PRESENT key holding null (CEL's own rule). `has()` guards against an
  UNDECLARED key on the header, not against an empty value; test emptiness with
  `parent.x != null`.
- Scope is the master's DECLARED fields only. A typo (`parent.stauts`) stays
  unevaluable and therefore reportable rather than silently reading as `null`.

If you have a `parent`-scoped `readonlyWhen` that was quietly failing open on a
sparse-returning driver, it starts locking; a `requiredWhen` in the same position
starts rejecting writes that leave the field empty. That is the declaration being
enforced as written.
