---
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/driver-turso": patch
---

fix(driver-sql, driver-turso): on SQLite, a `$contains` / `$notContains` / `$icontains` / `$startsWith` / `$endsWith` comparand holding U+0000 is compared whole, against the whole stored value, instead of being cut at the U+0000 by `GLOB` (#19999)

Clause-②: no

On the SQLite faces these five operators compile to `GLOB`, and SQLite's `glob()` reads both the pattern and the stored value only up to their first U+0000. Nothing raised, and the filter answered a different question. Measured on `SqlDriver` over better-sqlite3 (SQLite 3.53.4), on `SqliteWasmDriver` over sql.js (3.49.1), and on `TursoDriver`'s remote transport over a local libSQL engine (3.45.1). All three answered alike. Over the values `'a'` + U+0000 + `'b'`, `'ab'` + U+0000, U+0000 + `'z'`, `'plain'` and `''`:

- `$contains: U+0000` and `$endsWith: U+0000` returned all five rows;
- `$contains: U+0000 + 'b'` returned all five rows, where the JavaScript answer is `'a'` + U+0000 + `'b'` only;
- `$startsWith: U+0000` returned `''` and U+0000 + `'z'`, where the JavaScript answer is U+0000 + `'z'` only.

What changes: a comparand holding U+0000 now compiles to a length-aware comparison instead. `$contains`, `$notContains`, `$icontains` and `$startsWith` use `instr()`, and `$endsWith` compares the value's trailing bytes over BLOB. Such a filter now returns the rows `driver-memory` and `@objectstack/formula` return for it. The comparand is bound as written, so `*`, `?` and `[` in it are literal, as they were before. `$icontains` still folds ASCII letters only, and `$notContains` still returns a row whose value is NULL.

- `@objectstack/driver-sql`: the SQLite arm of `SqlDriver`'s text-operator compiler. `SqliteWasmDriver` and `TursoDriver`'s local mode inherit it.
- `@objectstack/driver-sqlite-wasm`: none of its own code changes. It inherits the fix, and its exact-text bind reaches every parameter the new comparison binds.
- `@objectstack/driver-turso`: the remote transport's own emitter, changed the same way.

What does not change: a comparand without U+0000 compiles to the same `GLOB` with the same bound pattern as before. The Postgres and MySQL arms are untouched. `GLOB` still reads a stored value only up to its first U+0000, so for a comparand without U+0000, `$contains`, `$notContains`, `$icontains` and `$endsWith` over a stored value that holds one still compare only the part before it.
