---
"@objectstack/metadata-protocol": minor
---

feat(metadata-protocol): `publishPackageDrafts` takes an opt-in `backfill` that writes the literal `defaultValue` of fields the publish adds into the object's existing rows, as the caller

Clause-②: yes (widening)

- **New request keys.** `backfill?: Array<{ object, field }>` names fields this publish adds; `context` is the caller's execution context the writes run as. Absent or `[]`, no row is touched.
- **Judged before anything is published.** Every entry must name an object drafted in the package, a field its draft declares, a field the published object does not have yet, and a literal `defaultValue` (a runtime token such as `NOW()` or `current_user`, or an expression, is resolved per new record and is refused). A malformed entry, a duplicate, or a backfill without a caller context is refused too. All problems come back in one `400 VALIDATION_ERROR`, one `issues[]` entry per problem with its `backfill.N` path, and nothing is promoted or written.
- **Written after the publish, as the caller.** Once the drafts are live and the new column exists, rows whose value is absent are read and written 200 at a time through `updateManyData` with the caller's context, so permissions, RLS/FLS, validation and record hooks run as on that caller's own edit. A value already stored is never overwritten.
- **New response key `backfillApplied`:** `{ success, fields: [{ object, field, updated, error?, code? }] }`, one element per requested field. `updated` counts the rows this publish wrote. A field stops at its first failing row and reports the rows written so far with the error; the publish is not undone. On the SQL driver the new column's DEFAULT already fills existing rows, so `updated` is 0 there.
