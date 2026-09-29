---
'@objectstack/driver-memory': patch
---

fix(driver-memory): a cube `where` `$lte` on a bare day keeps the whole day on a declared `datetime` field (#20661)

Clause-②: no

`MemoryAnalyticsService` put a `$lte` comparand into the field's storage form before it applied the whole-day rule for a bare-day upper bound. On a field declared `datetime` (through `syncSchema`) the storage form of `'2026-07-28'` is the instant `'2026-07-28T00:00:00.000Z'`, and the whole-day rule does not widen an instant. So `where: { created_at: { $lte: '2026-07-28' } }` compiled an inclusive bound at that midnight and dropped every row later in the named day, while `find()` with the same filter kept them. `generateSql()` echoed the same narrowed bound.

Both exits now follow ADR-0053's order: the bare day is widened first, and only the resulting bound is converted to the storage form. On a declared `datetime` field the example compiles `created_at < '2026-07-29T00:00:00.000Z'` and answers the same rows as `find()`. On `9999-12-31`, the last supported day, a declared `datetime` field now asks only for a value (`IS NOT NULL` in the echo), as an undeclared field already did.

Unchanged: an undeclared field, a declared `date` field, a full timestamp or `Date` comparand (inclusive, as written), and a `timeDimensions[].dateRange` end, which already widened the day before building its bounds. `$between` stays refused on this face (`INVALID_FILTER`, 400). Nothing is removed or renamed, and there is nothing to migrate.
