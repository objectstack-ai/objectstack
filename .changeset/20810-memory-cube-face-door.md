---
'@objectstack/driver-memory': minor
---

`MemoryAnalyticsService` (the in-memory analytics cube face) now runs the two shared filter comparand doors every other analytics face runs, then the shared filter lowering of ADR-0053 D-D1 (as amended), before it compiles a query's `where`. It also compiles `$or` and `$null`, the two parts of the lowering's output it could not.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: no spec key, export name or stored row moves. What changes is which filter comparand values one runtime face of this package accepts, to the set every other face already accepts; which value the caller meant by a refused comparand is not something a ledger entry can decide. The package publishes (not `unpublished`); no ADR-0087 id covers a comparand check (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: `query()` and `generateSql()` now refuse, with `INVALID_FILTER` / 400, filter comparands they used to answer. Each is refused the same way by every other analytics face and by the query engine, so a filter that worked here worked nowhere else. Measured on a fixture where `d` is `'v1'`, `'v2'`, `null` and absent:

- `undefined` in any comparand position — `{ d: undefined }` and `{ d: { $eq: undefined } }` answered the no-value rows, `{ d: { $ne: undefined } }` the valued ones, `{ d: { $in: ['v1', undefined] } }` row `v1`;
- a `null` member of `$in` / `$nin` (`{ d: { $in: ['v1', null] } }` answered `v1` and both no-value rows), and a `null` under an ordering operator (`{ d: { $gt: null } }` answered no row);
- a scalar where `$in` / `$nin` takes a list (`{ d: { $in: 'v1' } }`);
- a plain object, a `Map` or a binary value as a comparand — `{ d: { $ne: { a: 1 } } }` and `{ d: new Map() }` answered EVERY row.

The fix is to write the comparand you mean: `null` or `{ $null: true }` for "has no value", a list for `$in` / `$nin` (and `{ $null: true }` in a `$or` for "one of these, or no value"), a scalar for an ordering operator.

Corrected answers, each now what the live query path (`find()`) returns:

- a bigint comparand within 2^53 (`{ n: { $gt: 2n } }`) is read as its number and answered; beyond 2^53 it is refused `INVALID_FILTER` / 400. Both used to fail with an uncoded error.
- `$between` is answered as its two bounds, with a bare-day maximum widened to the whole day before it is converted to the field's storage form; it was refused.
- `$null` (true: no value; false: has a value) and `$or` (a `{}` branch is TRUE, `$or: []` is FALSE) are compiled on both exits; they were refused. `$not`, `$startsWith`, `$endsWith` and `$empty` stay refused. `ANALYTICS_FILTER_CAPABILITIES` names `$null` and the `$or` combinator accordingly.

The `generateSql()` echo and the `query()` pipeline dump for `$ne`, `$nin` and `$notContains` now show the lowering's NULL escape around this face's own guard — `(d IS NULL OR (d IS NULL OR d != 'v1'))` — the same rows as before.
