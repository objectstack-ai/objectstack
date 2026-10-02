---
"@objectstack/objectql": minor
---

fix(objectql)!: a comparand against a declared boolean field is narrowed to its boolean at the engine's filter door, and any string other than "true" / "false" / "1" / "0" is refused with `INVALID_FILTER` / 400

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal and a narrowing of filter COMPARANDS at the engine's query door, against a declared boolean or toggle field. No authorable key, spelling, export or stored shape moves: every query shape, every FilterCondition and every object definition parse as before, @objectstack/objectql exports nothing new and nothing less, and no stored row is read or rewritten. What is refused is a comparand that matched no row (and every row under $ne) on InMemoryDriver and on SqlDriver over SQLite (PostgreSQL and MySQL not measured), and which boolean a caller meant by "yes" is not something a ledger entry can decide. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand, and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what a filter may compare a declared `boolean` or `toggle` field with, at every filter position and through every door that reaches the engine's filter walk (`engine.find` / `findOne` / `count` / `aggregate` / `update` / `delete`, and every spelling the data API hands it). It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What was accepted before.** A string compared with a boolean field was neither refused nor read as a boolean: the engine handed it to the driver as written, and every answer was a 200. Measured on two rows (one `true`, one `false`) on InMemoryDriver and on SqlDriver over SQLite, through `engine.find`, `engine.aggregate` and the protocol's `findData` with each spelling the `POST /api/v1/data/:object/query` and `GET /api/v1/data/:object` routes hand it:

- `"true"` (implicit, `$eq`, `$in`) and `"false"` (implicit), and both through `?filter=`, `?$filter=`, the filter AST and the bare query parameter (`?flag=true`), matched no row on either driver;
- `$ne "true"` and `$nin ["true"]` returned both rows, the true row included;
- `"yes"` matched no row, and `$ne "yes"` both rows;
- `1`, `"1"`, `0` and `"0"` at `where` (and `"1"` / `"0"` through every spelling above) matched the right row on SQLite and no row on InMemoryDriver (`$ne 1` returned both rows there);
- the per-aggregation `filter` and `having` (the engine's own evaluator) answered `"true"` with no row and no group, and `$ne "true"` with every one.

**What is answered now.** At `where` (both spellings), the per-aggregation `filter` and `having`, on every verb that collects a filter, before any driver is asked for a row:

- `true` / `false` are handed to the driver as written;
- `1` / `0`, `"1"` / `"0"` and `"true"` / `"false"` are narrowed to `true` / `false`, so every driver receives the one boolean each names. Measured on InMemoryDriver and on SqlDriver over SQLite, `?flag=true` and `?flag=1` now return the true row; any other driver receives the same narrowed boolean by mechanism (PostgreSQL and MySQL not measured);
- any other string, a different letter case (`"TRUE"`), surrounding whitespace, a blank and a `{placeholder}` included, is refused `INVALID_FILTER` / 400. The message names the field, its declared type, the comparand and its position, and says what is wrong with it.

The accepted set is the one the record validator already admits when a boolean field is WRITTEN. The rule lives in `@objectstack/spec/data`'s `filter-boolean-comparand-declared-type.ts`, and the engine applies it in the same walk that judges number comparands.

**The remedy.** Write `true` or `false`. In a querystring, where every value is a string, write `true` / `false` or `1` / `0`.

**Unchanged.** A boolean comparand, `null` (the null test) and the flag operators (`$null`, `$exists`, `$empty`) answer as before, and so does every comparand against a field that is not boolean. A number other than `1` / `0` against a boolean field is still handed to the driver as written. A filter on a `formula` field is still refused one step earlier, as before.
