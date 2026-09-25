---
'@objectstack/spec': minor
'@objectstack/driver-sql': minor
'@objectstack/driver-sqlite-wasm': minor
'@objectstack/driver-turso': minor
'@objectstack/driver-memory': minor
---

fix(spec, drivers)!: a `$like` / `$ilike` pattern holding U+0000 is refused by every driver that answers `$like`, instead of being cut at the NUL on SQLite

Clause-②: yes (narrowing)

On the SQLite faces `$like` / `$ilike` compile to `GLOB`, and SQLite reads a pattern only up to its first U+0000. A pattern holding U+0000 was cut there, so the filter answered a different question, and nothing raised. Measured through `find` over 13 stored values (12 non-NULL), against `@objectstack/formula` on the same rows: all 20 U+0000 cases of the probe (10 patterns, bare and under `$not`) differed on `SqlDriver` over better-sqlite3, on `SqliteWasmDriver`, on `TursoDriver`'s local mode, and on its remote mode over a stub and over a real `@libsql/client` engine, with identical answers on all five. For example:

- `$like: '%'` + U+0000 returned all 12 non-NULL rows, where `formula` returns the two ending in U+0000;
- `$like: 'a'` + U+0000 + `'b'` also returned `'a'`;
- `$ilike: 'AB'` + U+0000 also returned `'AB'` and `'ab'`.

`driver-memory` answered all 20 as `formula` does. SQLite has no NUL-safe pattern primitive to compile to instead: `LIKE` cuts the same way, `replace()` cannot target U+0000, and `instr()` has no wildcards. So the one contract is a refusal, the way a pattern ending in a lone unpaired backslash is refused.

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). **A filter that answered before is now refused**: a `$like` or `$ilike` pattern holding U+0000 anywhere (at the start, in the middle, at the end, alone, or after a backslash) gets `INVALID_FILTER` / 400, on every door that already refused the lone trailing backslash:

- `@objectstack/driver-sql`: on the filter walk, before a dialect is chosen, so SQLite, Postgres and MySQL all refuse it. `@objectstack/driver-sqlite-wasm` and `TursoDriver`'s local mode inherit it; `@objectstack/driver-sqlite-wasm`'s own code does not change.
- `@objectstack/driver-turso`: the remote transport's `$like` / `$ilike` arm, before anything is sent to the engine.
- `@objectstack/driver-memory`: the shape gate of the query path and of the reference matcher `match()`, and the QueryAST `comparison` spelling (`like` / `ilike`).
- `@objectstack/spec` exports the shared test, `hasNulInLikePattern`, beside `hasDanglingLikeEscape`, and the `$like` operator's description now names the refusal.

On `driver-sql` and the Turso remote transport the refusal goes through the read-scope provenance seam, like every other filter-compile refusal there. On `driver-sql` (and so `driver-sqlite-wasm` and Turso's local mode), a caller whose predicate is marked `'author'` reads the operator, the field, the filter path and the pattern, with U+0000 written as `\u0000`. Any other caller gets only the class statement, and the rest goes to the server log. The remote transport withholds the same way, and through `TursoDriver` in remote mode no mark reaches it, so every caller gets the class statement there. On `driver-memory` every caller reads the full text, as for its dangling-escape refusal.

A pattern that ends in a lone unpaired backslash AND holds U+0000 keeps the dangling-escape refusal it had before.

**What stays accepted**, pinned per face: every `$like` / `$ilike` pattern without U+0000 answers exactly as before.

**Not changed here:**

- A pattern without U+0000 matched against a STORED value that holds U+0000 still differs from `formula` on the SQLite faces, because `GLOB` also reads the stored value only up to its first U+0000. No refusal of the pattern can reach that half.
- `@objectstack/formula` still evaluates such a pattern. It refuses nothing, and answers `false` for a dangling escape rather than refusing it, so it is not one of these doors.
- `driver-mongodb`, objectql `having` and `service-analytics` refused every `$like` / `$ilike` before this change, and still do.

**What an affected author does.** Remove the U+0000 from the pattern. No escape makes it portable: a backslash before it still leaves a U+0000 in the pattern.

Blast radius, measured on this tree: no example or template writes a `$like` or `$ilike`, and the published `objectstack-query` skill and the hand-written docs that show one show no pattern holding U+0000. Whether any out-of-repo caller sends one is NOT measured and is not claimed to be zero.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing at the filter-compile doors: no key, Zod schema, object definition or stored representation is added, removed or renamed. `$like` and `$ilike` keep their names and their `z.string()` comparand, and the only spec symbol added is the predicate `hasNulInLikePattern`. What moves is which PATTERN VALUES the drivers answer, and no rewrite of a stored pattern keeps its meaning (dropping the U+0000 changes which rows match), so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. -->
