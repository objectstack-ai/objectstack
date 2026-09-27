---
"@objectstack/service-analytics": patch
---

fix(service-analytics): on SQLite, the text operators in analytics filters and read scopes compare the whole stored value and the whole comparand, instead of stopping at their first U+0000 (#20025)

Clause-②: no

`service-analytics` compiles its own SQL for `$contains`, `$notContains`, `$startsWith`, `$endsWith` and `$icontains`, in three places: the read scope applied to an analytics query (`compileScopedFilterToSql`), the `where` that `NativeSQLStrategy` executes, and the `ObjectQLStrategy` statement the `/analytics/sql` caller runs. On a SQLite datasource all three compiled these operators to `GLOB`, and SQLite's `glob()` reads both the pattern and the stored value only up to their first U+0000. Nothing raised, and the filter answered a different question. Measured on better-sqlite3 (SQLite 3.53.4) and sql.js (3.49.1), every one of these faces alike:

- a comparand holding U+0000 was cut at it, so `$contains` / `$endsWith` could match every row and `$notContains` none;
- a stored value holding U+0000 was read only up to it, so `$contains` / `$endsWith` / `$icontains` missed a match after it, `$endsWith` could match what came before it, and `$notContains` / `$not` returned a row whose value does contain the comparand.

On a read scope the first kind widens what the scope admits and the second narrows or widens it. `driver-sql` and `driver-turso` already compile these operators this way (the #19999 and #20024 fixes); this package re-emits their construct table rather than importing it, and its copy had kept `GLOB`.

What changes: on the `sqlite` dialect these operators now compile to `driver-sql`'s constructs, cell for cell. `$contains`, `$notContains` and `$icontains` use `instr()`; `$endsWith` compares the value's trailing bytes over BLOB, with an empty comparand using `instr()` so it still matches every non-NULL value; a `$startsWith` comparand holding U+0000 uses `instr(…) = 1`. Such a filter now returns the rows `@objectstack/formula` and `driver-sql` return for it, on all three faces, bare and under `$not`, with `''` and NULL values included. The comparand is bound as written, so `*`, `?` and `[` in it are literal, as they were. `$icontains` still folds ASCII letters only, and `$notContains` still returns a row whose value is NULL.

What does not change:

- `$startsWith` with a comparand without U+0000 compiles to the same `GLOB` with the same bound pattern as before; the stored value's cut cannot change its answer. It keeps its index search (`EXPLAIN QUERY PLAN` over an indexed TEXT column on both engines); the other operators scanned the table under `GLOB` and still do.
- The Postgres and MySQL arms, and every comparand refusal that runs before the text arm, are untouched.
- A host that answers no SQL dialect for a SQLite datasource still gets the dialect-neutral `LIKE`, which SQLite also reads only up to the first U+0000.
- `$like` and `$ilike` are still refused by these compilers, as before.
