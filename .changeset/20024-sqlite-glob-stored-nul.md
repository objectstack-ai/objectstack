---
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/driver-turso": patch
---

fix(driver-sql, driver-turso): on SQLite, `$contains` / `$notContains` / `$icontains` / `$endsWith` read the whole stored value, instead of stopping at its first U+0000 (#20024)

Clause-②: no

On the SQLite faces these four operators compiled to `GLOB` for a comparand without U+0000, and SQLite's `glob()` reads the stored value only up to its first U+0000. Nothing raised, and the filter answered a different question. Measured on `SqlDriver` over better-sqlite3 (SQLite 3.53.4), on `SqliteWasmDriver` over sql.js (3.49.1), on `TursoDriver`'s local mode, and on its remote transport over a local libSQL engine (3.45.1). All four answered alike:

- `$contains: 'b'` did not return a value stored as `'a'` + U+0000 + `'b'`;
- `$endsWith: 'a'` returned that value, and `$endsWith: 'b'` did not;
- `$notContains: 'b'` returned it;
- `$icontains: 'B'` did not return `'A'` + U+0000 + `'B'`.

What changes: these four operators now compile to the length-aware comparisons a comparand holding U+0000 already used, for every comparand. `$contains`, `$notContains` and `$icontains` use `instr()`, and `$endsWith` compares the value's trailing bytes over BLOB. An empty `$endsWith` comparand uses `instr()` too, so it still matches every non-NULL value. Such a filter now returns the rows `driver-memory` and `@objectstack/formula` return for it, under `$not`, `$or` and `$and` as well. The comparand is bound as written, so `*`, `?` and `[` in it are literal, as they were before. `$icontains` still folds ASCII letters only, and `$notContains` still returns a row whose value is NULL.

- `@objectstack/driver-sql`: the SQLite arm of `SqlDriver`'s text-operator compiler. `SqliteWasmDriver` and `TursoDriver`'s local mode inherit it.
- `@objectstack/driver-sqlite-wasm`: none of its own code changes. It inherits the fix.
- `@objectstack/driver-turso`: the remote transport's own emitter, changed the same way.

What does not change:

- `$startsWith` with a comparand without U+0000 compiles to the same `GLOB` with the same bound pattern as before. The stored value's cut cannot change its answer.
- No index is lost. The SQL `SqlDriver` compiles, run under `EXPLAIN QUERY PLAN` over an indexed TEXT column on all three engines, scanned the table for these four operators under `GLOB` and still does; `$startsWith` keeps its index search.
- The Postgres and MySQL arms are untouched.
- `$like` and `$ilike` are outside this entry. Two other entries in this release cover them: on SQLite they now read the whole stored value as well, and every driver that answers `$like` refuses a pattern holding U+0000 (`INVALID_FILTER` / 400).
