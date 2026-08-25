---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): warn at load time when a seed defers a `required` column, before the engine rejects the row (#11674)

The seed loader defers an unresolvable reference to pass 2 by **deleting the
column** from the pass-1 row. On a `required: true` column that turns the insert
into one the write contract rejects (ADR-0113), so the row never lands and pass
2 has no row to back-fill — measured against the real `ObjectQL` engine in
`packages/objectql/src/engine-seed-required-deferral.test.ts`. It is the second,
independent road to the same loud failure that the pass-2 internal-id write-back
could not clear, and it is why a `required` id half stays **order-dependent**
even though a declared pointer pair contributes no static ordering edge.

Nothing about that failure was quiet — it is a write error naming the column, a
dropped-deferral error, and `success: false`. What was missing is **when** the
author learns: only after the engine rejected the row, from a driver-level
message that does not mention seeding order. The loader now says it first.

- **Load-time warning, scoped to the required subset.** When a dataset defers a
  reference on a column the write contract requires on insert, the loader logs
  one `warn` naming the object, the field, the target object that is not seeded
  yet, what deferring did to the row, and the fix — order the target dataset
  first. Emitted before the row reaches the engine, once per dataset and field
  rather than once per row.
- **⛔ The accept set is unchanged.** Nothing is counted, nothing reaches
  `result.errors`, `success` is untouched, and every existing loud failure and
  its tests are preserved verbatim. Only the log gains a line.
- **The predicate mirrors the write contract instead of approximating it**
  (`required && !readonly && !system`, and only on rows headed for an INSERT).
  Two configurations were measured on the real engine where a deferral on a
  `required` column is accepted today — an upsert replay taking the UPDATE arm
  (an omitted column is not a cleared one) and a `readonly` required column
  (required-validation skips it on insert) — and the warning correctly stays
  silent on both. They are pinned as controls.

The constraint is also now documented at the four pointer-pair declaration
sites: `sys_approval_request`, `sys_record_share` and `sys_share_link` must seed
the target dataset first; `sys_audit_log` (optional id half) is genuinely
order-independent and says why it differs.
