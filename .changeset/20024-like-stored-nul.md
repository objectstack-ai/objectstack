---
"@objectstack/driver-sql": patch
"@objectstack/driver-sqlite-wasm": patch
"@objectstack/driver-turso": patch
---

fix(driver-sql, driver-turso): on SQLite, `$like` / `$ilike` read the whole stored value, instead of stopping at its first U+0000 (#20024)

Clause-②: no

On the SQLite faces `$like` and `$ilike` compiled to `GLOB`, and SQLite's `glob()` reads the stored value only up to its first U+0000. So a pattern without U+0000 answered a different question over a value holding one, and nothing raised. Measured on `SqlDriver` over better-sqlite3 (SQLite 3.53.4), on `SqliteWasmDriver` over sql.js (3.49.1), on `TursoDriver`'s local mode, and on its remote transport over a local libSQL engine (3.45.1). All four answered alike:

- `$like: 'a'` returned a value stored as `'a'` + U+0000 + `'b'`, and `$like: ''` returned U+0000 + `'z'`;
- `$like: '%b'`, `$like: 'a_b'` and `$ilike: 'A_B'` did not return `'a'` + U+0000 + `'b'`;
- `$like: '_'` did not return a value that is a lone U+0000.

Over 108 patterns and 22 `$not` / `$or` / `$and` compositions against 59 stored values, 359 of the 3380 cells over values holding U+0000 differed from `@objectstack/formula` on each face.

What changes: a stored value holding U+0000 now has each U+0000 replaced by one stand-in character before `GLOB` reads it. The stand-in is never a literal character of the pattern, never an ASCII letter, and never U+0000. A U+0000 in the value can only be matched by `%` or `_`, and so can the stand-in, so the answer is the one the whole value gives. Such a filter now returns the rows `driver-memory` and `@objectstack/formula` return for it, under `$not`, `$or` and `$and` as well: 0 of those 3380 cells differ on any of the four faces. `$ilike` still folds ASCII letters only.

- `@objectstack/driver-sql`: the SQLite arm of `SqlDriver`'s `$like` / `$ilike` compiler. `SqliteWasmDriver` and `TursoDriver`'s local mode inherit it.
- `@objectstack/driver-sqlite-wasm`: none of its own code changes. It inherits the fix.
- `@objectstack/driver-turso`: the remote transport's own emitter, changed the same way.

What does not change:

- A stored value without U+0000 gets the same answer as before: 0 of 16640 such cells moved on any face.
- A pattern that is a literal prefix followed only by `%` (`'ab%'`, `'%'`) compiles to the same `GLOB` with the same bound pattern as before. Cutting the value at its first U+0000 cannot change that answer.
- No index is lost. Under `EXPLAIN QUERY PLAN` over an indexed TEXT column on all three engines, each `$like` pattern measured that starts with a literal (`'ab%'`, `'ab_'`, `'ab%cd'`, `'abc'`, `'a%b%'`) keeps its covering-index search, and each one that starts with a wildcard still scans. A case-exact pattern with a literal prefix now leads with `GLOB '<prefix>*'`, which every matching value satisfies and which is what keeps that search.
- `_` still matches one character, as `GLOB`'s `?` does. A character outside the Basic Multilingual Plane is one character to `_` on SQLite and two to `@objectstack/formula`, which counts UTF-16 units. That difference is older than this change, and this change does not alter it.
- A pattern holding U+0000 is still refused (`INVALID_FILTER` / 400).
- The Postgres and MySQL arms are untouched.

Cost, measured over 10,000 rows on the three engines: against a value without U+0000 the new compile adds one `instr()` per row, and those queries took 1.1 to 2.4 times as long as `GLOB` alone, at most 4.5 ms. A value holding U+0000 pays the rewrite: 10,000 rows each holding one to three U+0000 took up to 35 ms, against at most 3 ms for `GLOB`.
