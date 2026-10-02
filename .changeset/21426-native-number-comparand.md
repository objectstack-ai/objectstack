---
'@objectstack/service-analytics': minor
---

The analytics native-SQL path judges a comparand against a declared number field by the platform's number-comparand rule, the one the data engine's `where` already applies

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal or narrowing of a filter comparand against a declared number column at the analytics native-SQL face alone, the same comparand the engine's where door already judges: no authorable key, spelling, export, type or stored shape moves. Every dataset, cube and analytics query parses and saves as before, the filter's text is untouched, @objectstack/service-analytics exports the same names with the same types, and no stored row is read or rewritten. Which number the author meant by a refused comparand is not something a ledger entry can decide, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand's type and this diff adds none (not registered / already-registered); and the change is runtime behaviour with no published interface or type changed (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what the analytics native-SQL face accepts. A query or dataset that compares a declared number field with a comparand the number-comparand rule refuses used to answer 200 with a count on the native face (a 500 on PostgreSQL for a non-numeric string). It now refuses `INVALID_FILTER` / 400 before any statement runs, which is what the engine-aggregate face already answered. It ships as `minor` under the launch-window convention for accept-set narrowings. No export, type or error code changes.

- **What changed.** A comparand against a `number`, `currency`, `percent`, `rating`, `slider`, `progress` or `summary` column is judged by `numberComparandDoorVerdict` from `@objectstack/spec/data` before the native statement compiles. This covers the query's `where` (including the dataset query's `runtimeFilter`, which is merged into it), each measure's own `filter` and a dataset's own `filter`. The rule runs in the same pass as the boolean rule.
  - A numeric string (`'12'`, `'1e3'`) is bound as the number it names, which is what the engine binds.
  - Anything else the rule refuses (a string with no numeric reading such as `'abc'`, `''` or `'+5'`, a boolean, or a list where one number belongs) is refused `INVALID_FILTER` / 400 with the rule's own message, before any statement runs.
  - A relationship-path member is judged at the related object's declared column.
- **Before.** The native strategy bound the comparand as written. So `{ amount: 'abc' }` counted no rows on SQLite and answered a 500 on PostgreSQL, `{ amount: true }` bound `1` and answered 200, and `{ amount: { $lte: '9999-12-31' } }` counted every row. The engine-aggregate strategy refused all three with 400.
- **What you may notice.** An analytics query or dataset that compared a number field with a value outside the rule's accepted set now refuses instead of answering. Write a number, or a string of exactly that number's JSON spelling (`'12'`).
- **Unchanged.** A number, `null` (the null test), a `{ $field }` reference, a column that is not a number or a boolean, and a host that relays no declared field types (nothing is judged without one).
