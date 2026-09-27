---
"@objectstack/spec": minor
"@objectstack/formula": minor
"@objectstack/driver-memory": minor
---

`$like` / `$ilike`: `_` matches exactly one Unicode code point on every face, so an emoji or any other character outside the Basic Multilingual Plane is one `_`, as SQL `LIKE` and SQLite `GLOB` count it (#20143).

The SQLite faces (`driver-sql` on better-sqlite3, `driver-sqlite-wasm`, `driver-turso` local and remote) already answered by code points. The JavaScript faces did not: they compiled the spec's `likePatternToRegexSource` with no regular-expression flags, so `_` read one UTF-16 code unit, which is half of an emoji. The same REST filter returned a different row set depending on which driver backed the object. Measured at `e7f69dbb` over values holding `😀` (U+1F600) and `𝒜` (U+1D49C), 48 answer cells on the JS faces differed from the SQLite faces; after this change, none do.

- **`@objectstack/spec`**: a new export, `likePatternToRegExp(pattern, foldAscii?)`, compiles the translation with the `u` flag, the one compilation in which `_` is one code point. `matchesLikePattern` evaluates it. `likePatternToRegexSource` is unchanged and still exported; its source means one code point per `_` only under `u`. The `$like` description now says that a character is one Unicode code point.
- **`@objectstack/formula`**: `matchesFilterCondition` answers `$like` / `$ilike` by code points, through the spec's `matchesLikePattern`. Its own CEL `size()` already counted code points.
- **`@objectstack/driver-memory`**: all three `$like` doors (the `$like` filter and the AST `like` / `ilike` node through mingo, and the reference matcher) answer by code points.

The answer set moves in both directions on those three faces, only for values holding a character outside the BMP:

| pattern | a stored `😀` | `a😀b` | `a😀😀b` |
|---|---|---|---|
| `_` | now matches | — | — |
| `__` | no longer matches | — | — |
| `a_b` | — | now matches | — |
| `a__b` | — | no longer matches | now matches |

`$ilike` moves the same way. No pattern is newly refused and no refusal is lifted. Values made only of characters inside the BMP answer exactly as before.

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes is removed or renamed: no spec key, no export and no config field moves, and no stored metadata representation changes, so `objectstack migrate meta` has nothing to rewrite. What moves is the row set a `$like` / `$ilike` query returns on the JavaScript faces, and only for stored values holding a character outside the BMP, where it now equals what every SQLite face already returned. -->
