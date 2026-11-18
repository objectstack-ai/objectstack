---
'@objectstack/objectql': patch
---

fix(objectql)!: a roll-up `summary` field is read-only on update whether or not it declares `readonly: true`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is whether a non-system update may store a caller's value in a roll-up summary column. The one-line fix for a refused write is in the body: leave the summary field out of the update payload, or write it from server code with isSystem: true. -->

**BREAKING** for a caller that updates a `summary` field. A `PATCH /api/v1/data/:object/:id`, an import with `writeMode: 'update'`, a predicate (`multi: true`) update and the `update`-mode preview (`validate`) now drop a value sent for a roll-up summary field, as they already did for one declared `readonly: true`. The rest of the write is stored, and `droppedFields` / `onFieldsDropped` name the field with reason `readonly`. Under `strictReadonlyWrites` the whole update is refused with `ERR_READONLY_FIELD_REJECTED` and nothing is written. Before this change the typed value was stored and read downstream (defaults, rules, reports) until the next child write recomputed the roll-up. An import with `writeMode: 'upsert'` drops the value on the rows it updates; the rows it creates are covered by the create-side entry (`34672-summary-readonly-on-create`). Undoing a non-historical import that was committed before this release restores the rows' `before` snapshot through an ordinary update, so a summary value that import overwrote is not put back; it stays until the next child write recomputes it.

To fix a refused or dropped write: leave the summary field out of the update payload. Server code that must set the column (a migration, a repair job) passes `{ context: { isSystem: true } }`, which the roll-up recompute itself uses and which this lock exempts, as it exempts every read-only column.

Not changed by this entry: the create side, which the create-side entry (`34672-summary-readonly-on-create`) narrows in the same release; seed data and a historical import, which write as the system principal, still carry a pre-computed total on create. A historical import (`treatAsHistorical: true`, which writes with `preserveAudit`) keeps a summary value it sends on update too, as it keeps any other read-only value it sends, and so does the undo of such an import. The roll-up recompute, the backfill and the enable refresh write as before. A summary field that already declares `readonly: true` answers exactly as before.
