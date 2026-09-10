---
'@objectstack/spec': patch
---

Correct `FieldReferenceSchema`'s first TSDoc `@example`: a `{ $field }` comparand names a column of the SAME row, never a relation path.

The example spelled its comparand as `{ "$eq": { "$field": "order.owner_id" } }` and captioned it as a join ON clause, while the same docblock's "Execution support" prose states that a dotted path is refused by SQL push-down with `INVALID_FILTER` (HTTP 400). Copied as written it does not fail at the schema door — both spellings parse — so it fails later and quietly: the in-memory evaluator answers `false` for a flat row, and SQL push-down refuses. The ON clause it advertised no longer exists either; `query.joins` was removed and related records are read through `expand`. The example is now the same-table cross-field comparison both execution paths compile, and the docblock header no longer advertises a join surface. `@objectstack/spec` publishes `src/**/*.zod.ts`, so this docblock ships to authors and to IDE hover.
