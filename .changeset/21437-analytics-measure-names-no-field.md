---
'@objectstack/service-analytics': minor
---

fix(service-analytics)!: a caller-named analytics measure whose inferred source names no field (`_sum`, `*`, `*_sum`, an empty spelling) is refused with `INVALID_FIELD` / 400 at the analytics door, naming the spelling sent, on both strategies, before any statement is built (#21437)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at the analytics door of a caller-named measure spelling whose inferred source names no field. No authorable key, spelling, export type or stored shape moves: AnalyticsQuerySchema still parses every measures list it parsed (the refusal is a runtime rule on the request, not a schema change), CubeSchema and DatasetSchema are untouched, a member a cube declares is never minted and is served as before, the package index exports the same names with the same types, and no stored row is read or rewritten. A refused spelling had no answer to preserve: both strategies answered 500 for it, and which column a caller meant by an empty prefix is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a caller-named measure spelling, and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept in `measures`, on both strategies and every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export, published type or error code changes.

**The rule.** A `measures` entry the cube does not declare is inferred: the bare `count` counts rows (`COUNT(*)`), and any other spelling aggregates one of the object's own fields, named before an aggregation suffix (`_sum`, `_avg`, `_average`, `_min`, `_max`, `_count_distinct`) or, with no suffix, by the whole spelling. The bare `count` is now the only spelling that reads the row wildcard `'*'`. A spelling whose source is empty or is `'*'` names no field, and it is refused with `400 INVALID_FIELD` before anything is executed. The error names the spelling as it was sent (`member`, with `param: 'measures'` and `cube`); a `<cube>.` qualifier is kept in the name.

**Before**, measured through `POST /api/v1/analytics/query` on SQLite, on the native-SQL and the ObjectQL strategy, on an ad-hoc cube and on an authored cube that does not declare the member:

- `_sum`, `_avg`, `_average`, `_min`, `_max`, their `<cube>.`-qualified forms, `*`, `*_sum`, `*_avg` and the empty spelling `''` answered `500 DATABASE_ERROR`, after a statement reached the database (`SUM(*)`, `AVG(*)`, `SUM()`).
- `_count_distinct` and `*_count_distinct` answered `500 DATABASE_ERROR` on the native-SQL strategy (`COUNT(DISTINCT *)`). On the ObjectQL strategy the engine answered `400 INVALID_QUERY` after the aggregate was called.
- The qualifier alone (`<cube>.`) answered `403 PERMISSION_DENIED` from the member-shape gate. It now answers the same `400 INVALID_FIELD`, because it names no field either.

**Now** each of those answers `400 INVALID_FIELD`, and no statement and no engine aggregate runs. `POST /api/v1/analytics/sql` refuses the same spellings instead of returning a statement that cannot run.

**What to write instead.** Ask for `count` to count rows, or put the field's name before the suffix: the sum of `amount` is `amount_sum`.

**Who is affected.** A caller that sent a measure spelling with nothing before the suffix, or the row wildcard itself. Every such request was already a 500. No example app, shipped dashboard, report, dataset, cube, doc or skill in this repository sends one. The console's analytics adapter composes a measure as the value field, an underscore and the aggregate function, so a widget whose value field is empty posts `_sum`. At the pinned `.objectui-sha` that adapter reads a 500 as an unknown failure and answers with its own client-side aggregation; it reads the 400 as a rejected request and surfaces it as an error.

**Unchanged.** The bare `count`; a field-prefixed spelling such as `amount_sum`; the no-suffix spelling of a field (`amount`); a measure a cube declares, including one declared under a key such as `_sum`, which is the cube's own vocabulary and is never inferred; and the authored-position twin of this rule, the `@objectstack/spec` parse refusal of `'*'` outside a `count` on a cube or dataset measure (#21409).
