---
'@objectstack/objectql': patch
---

fix(objectql)!: a roll-up `summary` field is read-only on update whether or not it declares `readonly: true`

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is whether a non-system update may store a caller's value in a roll-up summary column. The one-line fix for a refused write is in the body: leave the summary field out of the update payload, or write it from server code with isSystem: true. -->

**BREAKING** for a caller that updates a `summary` field. A `PATCH /api/v1/data/:object/:id`, an import with `writeMode: 'update'`, a predicate (`multi: true`) update and the `update`-mode preview (`validate`) now drop a value sent for a roll-up summary field, as they already did for one declared `readonly: true`. The rest of the write is stored, and `droppedFields` / `onFieldsDropped` name the field with reason `readonly`. Under `strictReadonlyWrites` the whole update is refused with `ERR_READONLY_FIELD_REJECTED` and nothing is written. Before this change the typed value was stored and read downstream (defaults, rules, reports) until the next child write recomputed the roll-up.

To fix a refused or dropped write: leave the summary field out of the update payload. Server code that must set the column (a migration, a repair job) passes `{ context: { isSystem: true } }`, which the roll-up recompute itself uses and which this lock exempts, as it exempts every read-only column.

Not changed: a create keeps a value sent for a summary field as its starting value, so seed data and a historical import may still carry a pre-computed total; the next child write replaces it with the computed one. The roll-up recompute, the backfill and the enable refresh write as before. A summary field that already declares `readonly: true` answers exactly as before.
