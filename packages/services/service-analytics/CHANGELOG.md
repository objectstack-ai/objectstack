# Changelog — @objectstack/service-analytics

## 17.7.0

### Minor Changes

- 99589f9: fix(service-analytics)!: both analytics strategies refuse a cube measure whose `type` names no aggregate, in the spec's words — the custom-SQL `EXPRESSION_METRIC_TYPES` partition is gone with the three types it named (#21000)
  
  **BREAKING** — `@objectstack/spec` retired the cube metric types `number`, `string`
  and `boolean` from `AggregationMetricType` (a measure's `sql` is a column reference,
  so they had nothing left to compute). Every door that parses a cube refuses them;
  this release removes the runtime branches that still served them for a cube that
  reached the analytics service WITHOUT meeting that parse — one a host registers
  in-process from a literal, through `AnalyticsServicePlugin({ cubes })` or
  `AnalyticsService({ cubes })` (the registry never parses).
  
  | | before | now |
  | --- | --- | --- |
  | `NativeSQLStrategy`, a measure typed `number` / `string` / `boolean` | served: the column emitted UNAGGREGATED in the statement (`amount AS "m"` beside `GROUP BY`) | refused, nothing executed |
  | `ObjectQLStrategy`, the same measure | refused `INVALID_FIELD` / 400 | refused, nothing executed |
  | either strategy, a type the spec never declared (`median`) | native: refused; ObjectQL: forwarded to `executeAggregate` as the method (the auto-bridge refused it; a host's own executor received it), and `/analytics/sql` echoed `MEDIAN(amount)` | refused, nothing executed |
  
  **The one refusal** is `aggregateOfMeasure`'s, shared by both strategies and both
  doors (`POST /analytics/query` and `POST /analytics/sql`): it names the measure and
  the cube, then quotes the spec's own verdict on the type — for a retired type the
  retirement prescription (the six aggregates to choose from, and where a per-row or
  derived value goes instead), for anything else zod's message listing the six. It is
  a bare `Error`, the undeclared-500 tier this package assigns to a cube that never
  met the parse, so the HTTP answer is `500` with the message readable in the body
  (measured through the dispatcher's analytics route), never a caller-blaming `400`.
  The ObjectQL envelope for the three retired types therefore moves from
  `INVALID_FIELD` / 400 to that tier.
  
  **The fix:** give the measure one of the six aggregate types — `count`, `sum`,
  `avg`, `min`, `max`, `count_distinct` — or parse the cube through `CubeSchema`
  before registering it, which refuses the same types with the same prescription.
  
  **Removed export:** `EXPRESSION_METRIC_TYPES` from
  `strategies/native-sql-strategy.ts` (internal to the package; not re-exported from
  its entry point). **Unchanged:** every aggregate measure on both strategies, the
  auto-bridge's own parse of an engine method (still pinned, driven directly), and
  `GET /analytics/meta`, which keeps publishing each registered measure's `type` as
  registered.
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: registered cube-metric-expression-types-retired -->
- 713b0fa: fix(metadata-protocol)!: a metadata body's stored content hash is served and compared only in keyed form, never copied, and never evaluated (#21207)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) the stored content hash of a metadata body stays the canonical hash at rest and no metadata body, authorable key, spelling or export moves; what changes is the form a door serves the hash in (a keyed digest: the crypto provider's, or a process-scoped ephemeral key's when none is registered), the form an inbound version token is compared in, and which query shapes the doors accept over the two hash columns, so `objectstack migrate meta` has nothing to rewrite. The operator-run rewrite this release asks for is of audit, activity and decision-audit copies, not of metadata. The other categories are closed on facts: every package here publishes (not `unpublished`); no ADR-0087 id covers a served version token or a refused query shape (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what the metadata doors serve and accept for the stored content hash of a metadata body — a hash over the whole stored body, withheld credential material included. Served beside the projected body it let a reader confirm a guess at that material offline; filtered on, it confirmed one online. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  **Three things change for callers and operators.**
  
  1. **A held version token gets one `409 METADATA_CONFLICT`.** Every door that hands out a metadata version token — the save, publish, package-publish and rollback receipts and the history read — now hands out a keyed digest of the stored hash instead of the hash itself, and the save and reset doors compare a token they are sent in that same form. The key is the crypto provider's; a host that registers none keys under a process-scoped ephemeral key instead, so a token is always issued and never empty. A token a client held from before the upgrade is refused once; take the token from the next read or receipt and retry. On a host with no provider the same happens after a restart, and on any host when a provider is first registered. An empty, withheld, raw or stale token is refused with the same `409`; it is never read as "no pin".
  2. **Filter, sort and group on the two stored content-hash columns, and on the version history's change note, now answer `400 INVALID_FIELD`** — on the generic data door, the MCP stdio reader and the analytics door, before the engine runs. The change note is included because a draft promotion that stated no message of its own recorded the draft's stored hash in it; the publish door now always states a hash-free message, and a note written before this release is served with the quoted hash in keyed form. A data-door search over the two stored-metadata tables no longer scans those columns or the stored body column, and an explicit search-field list naming one answers the same `400`. Every other column of the two tables is served, filtered, sorted and grouped as before, and every other object is unchanged.
  3. **Operators run `os migrate audit-metadata-bodies` once after upgrading, dry run first.** The audit ledger, the activity feed and the metadata decision-audit trail no longer copy the stored hash. The extended command drops it from the copies already written and withholds it in the decision-audit notes and their copies: a dry run by default, `--apply` to rewrite, idempotent. The version history stays the lineage.
  
  **What else changes.** The data door serves the two hash columns of the stored-metadata tables in keyed form, under the same key as the version tokens. The MCP stdio reader serves them keyed under the crypto provider's key, and omits them on a host with no provider. A `409` conflict refusal carries keyed values or none. The ObjectQL engine gains a read accessor for the registered provider's keyed digest; it is additive. A member's read of these tables is refused as before.
- 1caa603: fix(service-analytics)!: an analytics `order` key that names no member the query selects is refused with `INVALID_FIELD` / 400 at the analytics door, on both strategies, before either runs
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a refusal at the analytics door of an `order` key the query does not select. No authorable key, spelling, export or stored shape moves: `AnalyticsQuerySchema` still parses every `order` it parsed (the refusal is a runtime rule on the request, not a schema change), `CubeSchema`, `DatasetSchema` and the dashboard and report schemas are untouched, the new module is internal to the package (not exported from `index.ts`), and no stored row is read or rewritten. An unselected key had no defined meaning to preserve: the native-SQL strategy answered 500 for it, or on SQLite ordered the groups by an arbitrary row, and the ObjectQL strategy never applied `order` at all; which member a caller meant is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an analytics order key, and this diff adds none (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on both strategies and every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **The rule.** Each `order` key must be a column the answer carries: one of the query's own `dimensions` entries, one of its `measures` entries, or a `timeDimensions` entry that carries a `granularity`, spelled exactly as it is selected (a `<cube>.`-qualified measure keeps its qualifier in the answer, so the bare spelling names no column beside it, and the other way round). A `timeDimensions` entry with only a `dateRange` bounds the rows and is not a column. Any other key is refused with `400 INVALID_FIELD`, naming every such key and the members the query does select, and nothing is executed. The thrown error carries `param: 'order'` and `field` (the first such key).
  
  **Before**, measured through `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14, for a cube that declares no join over an object whose lookup target also declares `note`:
  
  - `dimensions: ['owner.email']` with `order: { note: 'asc' }`: native-SQL strategy `500` on both drivers (PostgreSQL 42702, `note` is ambiguous); ObjectQL strategy `200`.
  - `dimensions: ['note']` with `order: { amount: 'asc' }`: native-SQL strategy `200` on SQLite, ordered by an arbitrary row's `amount`, and `500` on PostgreSQL (42803, must appear in GROUP BY); ObjectQL strategy `200`.
  - `dimensions: ['note']` with `order: { 'owner.email': 'asc' }`: native-SQL strategy `500` on both drivers (PostgreSQL 42703, no such column); ObjectQL strategy `200`.
  
  **Now** each of those answers `400 INVALID_FIELD` on both strategies and both drivers, and `POST /api/v1/analytics/sql` refuses them the same way instead of returning a statement whose `ORDER BY` cannot run.
  
  **What to write instead.** Add the key to the query's `dimensions` (or `measures`), so the answer carries it, or drop it from `order`.
  
  **Who is affected.** A caller that posted an `order` key it did not select. On the native-SQL strategy those queries were already a 500 everywhere but the one SQLite shape, whose order was arbitrary. No example app, shipped dashboard, report, dataset or cube authors such a key, and the console's analytics adapter sends no `order` to this route.
  
  **Unchanged.** Ordering by a selected dimension, a selected measure or a bucketed time dimension; the dataset door (`POST /api/v1/analytics/dataset/query`), which already refused an unselected `selection.order` key with `400 DATASET_INVALID` and pushes an `order` down only when the selection selects every key; and a key naming a field the caller may not read, which keeps the `403 PERMISSION_DENIED` the field-level read gate answers for every position.
- 8b123c0: Row-level security policies and the analytics native-SQL path judge a comparand against a declared boolean field by the platform's boolean-comparand rule, the one the data engine's `where` already applies
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a refusal or narrowing of a filter comparand against a declared boolean column at two compilers outside the engine's where door, the same comparand that door already judges: no authorable key, spelling, export or stored shape moves. RowLevelSecurityPolicySchema, every permission set, every dataset, cube and analytics query parse and save as before, the predicate's and the filter's text are untouched, @objectstack/plugin-security and @objectstack/service-analytics export the same names with the same types, and no stored row is read or rewritten. Which boolean the author meant by a refused comparand is not something a ledger entry can decide, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers a filter comparand's type and this diff adds none (not registered / already-registered); and the change is runtime behaviour with no published interface or type changed (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING**: this narrows what two compilers outside the engine's `where` door accept. The RLS compile seam now drops a row-level policy, and the analytics native-SQL face now refuses a query, when either compares a declared boolean field with a comparand outside the accepted set. It ships as `minor` under the launch-window convention for accept-set narrowings. No export, type or error code changes.
  
  - **Row-level security (`@objectstack/plugin-security`).** A compiled `using` / `check` predicate on a `boolean` or `toggle` column (or a `formula` returning `boolean`) is judged by `booleanComparandDoorVerdict` from `@objectstack/spec/data`, in the same pass as the number rule. `'true'` / `'false'`, `'1'` / `'0'` and `1` / `0` are read as the boolean each names. Anything else the rule refuses (a string such as `'yes'`, `'TRUE'` or `''`, a number other than `1` / `0`) drops the policy as a refused comparand: the read is filtered by the deny sentinel, the write is refused 403, and the WARN line names the clause, the field and the position. Before, `record.flag != 'true'` kept every row on SQLite and the write check admitted every row, so the exclusion the author wrote was not applied.
  - **Analytics native SQL (`@objectstack/service-analytics`).** The query's `where` (and the dataset query's `runtimeFilter`, which is merged into it), each measure's own `filter` and a dataset's own `filter` are judged by the same rule before the statement compiles. An accepted spelling is read as its boolean, and anything else the rule refuses is refused `INVALID_FILTER` / 400 with the rule's own message, before any statement runs. The native strategy now answers what the engine-aggregate strategy answers. Before, `{ flag: 'true' }` counted no rows on SQLite, `{ flag: { $ne: 'true' } }` counted every row, and `{ flag: 'yes' }` answered 200.
  - **What you may notice.** A policy or analytics filter that compared a boolean field with a value outside the accepted set now refuses instead of answering. Write `true` / `false`. A policy `record.flag == 1` now admits writing a `true` row, which its read already showed.
  - **Unchanged.** A boolean literal, a column that is not boolean, a `{ $field }` reference, and an object whose declaration cannot be read (nothing is judged without one).
- 81e69ca: fix(service-analytics)!: the analytics read scope, the `where` tree and the draft preview take the shared lowering's bound and NULL guards; their own whole-day and NULL-polarity copies are deleted (ADR-0053 D-D1 items 7 to 9)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a change of how the native analytics strategy and the draft preview answer an ordering comparison on a column its host declares neither datetime nor date, and of how the draft preview reads a window end, not of anything an author writes: no spec key, spelling, export or stored shape moves. AnalyticsQuerySchema, CubeSchema, DatasetSchema and every RLS policy parse and save as before, the package index exports the same names with the same types, and no stored row is read or rewritten. What moves is the row set a bare-day upper bound selects on such a column, which now equals the engine's own answer for the same filter, and the row set the draft preview selects for a window, which now equals what it selects for the same bounds written as a where; so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter's bound semantics and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING**: this narrows the rows the native analytics strategy and the draft preview (`queryDataset` with `previewDrafts`) select for a bare-day upper bound on a column the host declares as neither `datetime` nor `date` — a `text` column, for example. It ships as `minor` under the launch-window convention for answer narrowings. No export, published type, accepted input or error code changes.
  
  **What is deleted.** The native SQL strategy no longer reads a bare `YYYY-MM-DD` `$lte`, a `$between` maximum or an explicit `dateRange` end as "through that whole day" on every column, and no longer drops such a bound on `9999-12-31` whatever the column holds. The whole-day rule is applied once, by the shared `lowerFilterCondition` (`@objectstack/spec/data`), with the column's declared type, the reader the plugin already wires from the engine's registry (`sourceFieldMeta`): a declared `datetime` column keeps the whole day, and every other declared column is compared as written, as the engine compares it. The `/analytics/sql` echo renders the same lowering.
  
  **The native face now agrees with the engine.** Measured through `AnalyticsService.query` (what `POST /api/v1/analytics/query` relays) in the plugin's own composition, on SQLite and on PostgreSQL 16, over a `text` column `note` holding `'2026-07-27'`, `'2026-07-28'`, `'2026-07-28 late'`, `'n'` and no value:
  
  - `{ note: { $lte: '9999-12-31' } }` counted every row with a value (4). It now counts 3, the rows the engine's `find` returns: `'n'` sorts above `'9999-12-31'`.
  - `{ note: { $lte: '2026-07-28' } }` counted 3, the `'2026-07-28 late'` row included. It now counts 2.
  - `$between ['2026-07-28', '2026-07-28']` and a `dateRange` window of the same day counted 2; they now count 1. Their negation through `$not` gains the row the bound lost.
  
  On a declared `datetime` or `date` column every answer is unchanged, on both strategies.
  
  **A host with no typed reader** (a strategy context with no `declaredFieldType` hook, or an `AnalyticsService` built without `sourceFieldMeta`) reads every column type-blind, as ADR-0053 D-D1 item 7 prescribes for a seam that cannot read declarations: its native answers do not move. Pass `sourceFieldMeta` (the README shows how) to get the engine's answer on a non-temporal column.
  
  **The `/analytics/sql` echo.** A `dateRange` window on a declared `date` column now prints the inclusive `<=` the engine runs, where it printed `<` the next day; on a column the host names no type for, it prints the bound the ObjectQL strategy hands the engine, as written. A preset window that stops before its end (`today`, `this_month`, …) now prints `<` its end instant with that instant bound, where it printed `<=` with no value bound. The NULL guards print once where they printed two or three nested copies of the same guard; every row set is unchanged.
  
  **The draft preview now agrees with the engine too.** `queryDataset` with `previewDrafts` evaluates drafted seed rows in memory; it kept its own whole-day copy, read on every column. It now hands the evaluator the drafted object's declared types (`sourceFieldMeta`), and the shared lowering applies the rule with them: a declared `datetime` column keeps the whole day, any other declared column is compared as written, and a column the host names no type for is read type-blind (ADR-0053 D-D1 item 7). Measured through the plugin's own composition over the same rows, five of the preview's `note` cells moved, each onto the engine's answer: `$lte` a day 3 to 2, `$between` and a window of one day 2 to 1, a window to `9999-12-31` 3 to 2, and the `$not` gains the row. Its `$lte` and `$between` to `9999-12-31` already gave the engine's answer and are unchanged. Every `datetime` and `date` cell is unchanged.
  
  - A preview window is now the `{ $gte, $lte }` pair the ObjectQL strategy hands the engine, matched like the same bounds in a `where`. Its end used to be read with a `'~'` suffix ("that instant and its own sub-values"), a reading no other face gives. Measured on a `datetime` column over SQLite, a canonical end (`…T10:00:00.000Z`) answers as before and as the engine. An end spelled shorter than the stored value is compared as text, as the preview's `where` already compared it: an end of `…T10:00` or `…T10:00:00` now leaves out the row stored at exactly that instant (the engine keeps it), and leaves out the rows inside that minute or second (the engine leaves them out too; the old reading kept them). Write a window end in full (`2026-07-28T10:00:00.000Z`) to get the engine's rows on the preview.
  - A window over rows that hold a `Date` (the BSON storage form a MongoDB-backed draft reads back) is compared as instants, like the preview's `where`; it was compared as the `Date`'s display text.
  - A host that wires no `sourceFieldMeta` (or an object the registry does not hold yet) reads every column type-blind. On a `text` column holding a value that sorts above `'9999-12-31'` (`'n'`), a `$lte` or `$between` maximum of `9999-12-31` now keeps that row, as every other type-blind seam does; the deleted copy left it out.
  
  **Unchanged.** Every answer on a declared `datetime` or `date` column, on the native strategy, the ObjectQL strategy and the draft preview; every answer of the ObjectQL strategy; every answer of the read scope.
- 086ad0a: The analytics native-SQL path judges a comparand against a declared number field by the platform's number-comparand rule, the one the data engine's `where` already applies
  
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
- 0b82391: fix(service-analytics)!: a caller-named analytics measure whose inferred source names no field (`_sum`, `*`, `*_sum`, an empty spelling) is refused with `INVALID_FIELD` / 400 at the analytics door, naming the spelling sent, on both strategies, before any statement is built (#21437)
  
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
- 35dfb81: fix(service-analytics): the ObjectQL face echoes a date-bucketed dimension in the bucket expression the driver itself groups by, so SQLite runs the statement it prints
  
  Clause-②: yes (widening)
  
  **Before**, the ObjectQL strategy printed every date-bucketed dimension as `date_trunc('<granularity>', col)` in the `sql` it echoes and in the `POST /analytics/sql` body, on every dialect. The native strategy declines a granularity, so every bucketed query lands on this face. Measured through `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` in the default composition: the rows were right. On SQLite the echo failed with `no such function: date_trunc` (month, quarter and week). On PostgreSQL 16.14 it ran but answered `2026-01-01T00:00:00.000Z` where the face answers `2026-01`. The driver groups by `strftime('%Y-%m', …)` on SQLite and `to_char((…)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM')` on PostgreSQL.
  
  **Now** the echo prints the driver's own expression, so it runs on that dialect and answers the face's bucket keys.
  
  - **`@objectstack/driver-sql`**: `SqlDriver.dateBucketSql(objectName, field, granularity)` returns the expression `aggregate` groups by, rendered as SQL text: the existing `buildDateBucketExpr`, unchanged, with each identifier quoted by the dialect. It returns `null` for a granularity the dialect buckets in memory (`week` on SQLite). The MySQL arm (`date_format(convert_tz(…))`) is checked by code read only, because no MySQL server was available.
  - **`@objectstack/service-analytics`**: the new optional `AnalyticsServiceConfig.dateBucketSql` hook carries the expression to the ObjectQL strategy. `AnalyticsServicePlugin` wires it from the driver that serves the object, as it wires `sqlDialect`.
  - **`@objectstack/driver-turso`**: a comment that said `SqlDriver` buckets with `date_trunc` now names the SQLite `strftime` expression it emits. The inherited `dateBucketSql` answers on the remote face too: it renders the same SQLite expression with no connection, and libSQL runs it.
  
  **Unchanged.** The rows every face answers. The echo keeps `date_trunc(…)` where nothing answers: a host that wires no hook, a driver with no bucket expression (memory, MongoDB), a granularity the driver buckets in memory, and a query with a non-UTC `timezone`, which the engine buckets in memory on that zone's calendar.
- 1ca1eb0: fix(service-analytics)!: the analytics read scope and the draft preview compare a temporal comparand in the column's storage form, as the engine does (ADR-0053 D-A1 / D-A2) (#21505)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a change of which rows the analytics read scope and the draft preview select for a value comparison on a declared datetime, date or time column, not of anything an author writes: no spec key, spelling or stored shape moves. AnalyticsQuerySchema, CubeSchema, DatasetSchema and every RLS policy parse and save as before, the package index exports the same names, and no stored row is read or rewritten. The two new options members are optional and identity when absent, so every existing caller of compileScopedFilterToSql compiles as before. What moves is the row set such a comparison selects, which now equals the engine's own answer for the same filter, so there is nothing for objectstack migrate meta to rewrite. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a filter comparand's storage form and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration alone (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING**: this changes the rows two analytics faces select for a value comparison on a declared temporal column, in both directions, onto the rows `engine.find` selects for the same filter: on some filters fewer rows than before, on others more. The faces are the row-level read scope compiled into the native statement, and the draft preview (`queryDataset` with `previewDrafts`). It ships as `minor` under the launch-window convention for answer changes. No export is removed, no accepted input is refused and no error code changes.
  
  **The read scope.** `compileScopedFilterToSql` takes two new optional members in its options, `coerceTemporalFilterValue(field, value)` and `coerceTemporalFilterColumn(field, columnSql)`. Together they are the driver's `temporalFilterValue` / `temporalFilterColumnSql` pair, bound to the object the scope reads. After the shared lowering, every value comparison binds its comparand through the first and reads its column through the second: equality, `$ne`, the four orderings, `$in`, `$nin` and `$between`. Null tests, `$empty` and the text operators read the column as stored. An absent member is identity: the comparand and the column stay as written, which is what a host that passes neither got before. `NativeSQLStrategy` (the read scope merged into the native statement) and the `ObjectQLStrategy` echo (`/analytics/sql`) pass the context's pair, which `AnalyticsServicePlugin` wires to the driver. Before, the comparand was bound as written and the database read it by its own rules, on SQLite and on PostgreSQL whatever the server's time zone.
  
  **The draft preview.** It has no driver, so each value comparison on a column the host declares `datetime`, `date` or `time` now puts both sides in the storage form `@objectstack/core`'s `temporalStorageForm` gives: the comparand, and the drafted row's value, as `driver-memory` reads them. Before, it compared the two spellings as text. A column the host names no type for is compared as written, as before.
  
  A `date` column answered the engine's rows on both faces before and still does when both sides are spelled as days. No `@objectstack/spec` contract changes and no dependency edge is added. A host that calls `compileScopedFilterToSql` directly gets the coercion by passing the pair from its driver.

### Patch Changes

- f9f9f91: Analytics filter refusals, the no-strategy diagnostic and the cube-gate warning no longer cite tracker numbers; each one states the decision behind it in words
  
  Clause-②: no
  
  Some strings the analytics service shows to callers, authors and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.
  
  - The two field-reference refusals (a `{ $field }` comparand the SQL lowering cannot render, and a `{ $field }` used as a `$between` bound) say the engine path's driver enforces the cross-field rules (declared same-table columns only, never the tenant-isolation column, one comparison class) with metadata it owns, so those rules are enforced in one place. The bound refusal also says `FieldReferenceSchema` was removed from the `$between` endpoint union rather than implemented there, since nothing asked for it.
  - The no-strategy diagnostic for a cross-field filter on a deployment with no aggregate bridge says the same about the engine path.
  - The `where` refusals: an undefined comparand is refused rather than read as null, on the SQL drivers and on this door alike; a field constraint with zero operators is refused on every backend, because neither "every row" nor "no row" is the author's intent; a field constraint mixing `$` operators with bare keys is refused by both doors in the package; and the two filter-array refusals say a filter array is lowered at every door or refused, never dropped, so it means the same rows whichever door it enters. Where the undefined-comparand refusal cited a tracker number for the silent widening, it now says that a dropped predicate widens the query; the mixed-wrapper refusal already said so and only drops its citation.
  - The dotted-measure refusal drops its citation; the sentence already says measures do not traverse relationships and that the prefix used to be dropped silently.
  - The warning logged when no object-registry hook is configured says the inactive gate is the one that answers 404 `CUBE_NOT_FOUND` for a name that is neither a registered cube nor a registered object.
  
  Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
- 44072fc: The read-scope comparand refusals, the native-SQL cross-field backstop and the two display-SQL echo refusals no longer cite tracker numbers; each one states the decision behind it in words
  
  Clause-②: no
  
  Some strings the analytics service shows to operators and callers pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.
  
  - The read-scope compiler's undefined-comparand refusal says an undefined comparand is refused rather than read as null, on the SQL drivers and on this door alike. Its refusal of a non-boolean `$null`, `$exists` or `$empty` comparand says a non-boolean comparand for any of the three is refused rather than coerced, on every driver and on this door alike. Both still say they fail closed, and that the producer to fix is whoever built the read scope, never the caller of the query.
  - The native-SQL strategy's cross-field backstop and the `/analytics/sql` echo's refusal of a field-reference comparison say the engine path's driver enforces the cross-field rules (declared same-table columns only, never the tenant-isolation column, one comparison class) with metadata it owns, so those rules are enforced in one place, next to the metadata they read.
  - That echo refusal and the echo's unmapped-operator refusal say the echo renders every predicate the query runs with, or refuses.
  
  Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
- 41a3c8d: Published comments that named `driver-memory`'s retired reference matcher as a live filter backend now name what replaced it
  
  Clause-②: no
  
  `driver-memory`'s reference matcher (`memory-matcher.ts`) was retired in commit `8fec76a2b`. Four published packages still described it as a live surface in text that ships:
  
  - `@objectstack/spec`:
    - The backend table in the filter-logic conformance docblock, which ships in `data/index.d.ts` and `data/index.d.mts`, now lists the in-memory backend as `driver-memory`'s query path (`normalizeFilterCondition`, then mingo) where it listed `memory-matcher`, and says the matcher held that row until commit `8fec76a2b` retired it.
    - `src/data/filter.zod.ts` ships as source. In it, the `$icontains` implementation table lists `driver-memory`'s query path and analytics face, both on `asciiCaseInsensitiveRegexSource`. The `$like` / `$ilike` and `$empty` tables keep the matcher only in a note that commit `8fec76a2b` retired it. The `foldAsciiCase` docblock counts five JS evaluation faces where it counted six. The `asciiCaseInsensitiveContains` docblock names objectql's `having` and `formula` as its callers. The string-ordering note says `driver-memory`'s query path hands the comparison to mingo. Of these, the `foldAsciiCase`, `asciiCaseInsensitiveContains` and `FILTER_OPERATORS` docblocks also ship in the filter declaration chunk (`filter.zod-*.d.ts` / `.d.mts`).
    - `src/ui/view.zod.ts` ships as source. It now says that `driver-memory`'s query path runs `assertFilterConditionShape` through `convertToMongoQuery`, where it said `match()` did.
    - A comment inside `FILTER_TEXT_CASES` ships in `data/index.js` / `.mjs` and `browser/data/index.js` / `.mjs`. It now says the reference matcher measured case-exact until commit `8fec76a2b` retired it.
  - `@objectstack/service-analytics`: two comments in `ObjectQLStrategy`, which ship in the JavaScript output (the first also in `index.d.ts` / `index.d.cts`), changed. The first names `driver-memory`'s query path, not its matcher, as a face that pins `{$not: {}}` as the zero-row filter. The second says in the past tense that `memory-matcher.ts` read `$regex` as a real regex, until `$regex` was retired and commit `8fec76a2b` retired the matcher too.
  - `@objectstack/formula`: the comment over the `$icontains` arm in `matches-filter.ts` ships in `index.js` / `index.mjs`. It now names objectql's `having` as the other caller of `asciiCaseInsensitiveContains`. It says `driver-memory`'s reference matcher called it until commit `8fec76a2b` retired it, and that `driver-memory`'s query path folds through `asciiCaseInsensitiveRegexSource`.
  - `@objectstack/objectql`: the comment over the `having` walker's `$notContains` arm in `having-filter.ts` ships in `index.js` / `index.mjs` and `core.js` / `core.mjs`. It now says the record-at-a-time faces (`formula` and this walker) answer the predicate on a stored value that is not a string, as `driver-memory`'s reference matcher did until commit `8fec76a2b` retired it.
  
  Comment only: no export, type, error code, status, message text or runtime behaviour changes.
- fbe2deb: fix(service-analytics): the ObjectQL strategy applies a query's `order`, then its `offset` and `limit`, to the aggregated answer, as its echoed `sql` says
  
  Clause-②: no
  
  **Before**, the ObjectQL strategy passed none of the three keys to `engine.aggregate`, which has no ordering or window grammar, and applied none of them itself. Every date-bucketed query lands on that strategy, because the native-SQL strategy declines `granularity`. Measured through `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14:
  
  - `timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }]`, `order: { closed_on: 'desc' }`, `limit: 1` answered every month, unordered (ascending on SQLite, `04, 03, 05` on PostgreSQL).
  - A selected dimension with `order: { note: 'desc' }`, and a selected measure with `limit: 2, offset: 1`, answered every group in the engine's order.
  
  The echoed `sql` and `POST /api/v1/analytics/sql` rendered `ORDER BY … LIMIT … OFFSET …` for all three.
  
  **Now** the strategy orders the answer by `order`, in the key order given, and then applies `offset` and `limit`. This happens on the direct path and on the cross-object (FK-expand) path, after the re-bucket. A bare `limit` with no `order` slices the engine's order, as `LIMIT` without `ORDER BY` does. Where the native-SQL strategy answers the same query, the two answer the same rows for numbers and for text of single-case ASCII letters. The comparison is the dataset door's own `applyOrdering`, which sorts NULL and `''` last in both directions, while SQL places NULL by driver (lowest on SQLite, highest on PostgreSQL), so the two faces can still order NULL, `''`, numeric text and mixed-case text differently.
  
  **Dataset door.** `POST /api/v1/analytics/dataset/query` pushes a single query's `order`, `limit` and `offset` down to the strategy, and then windowed the answer a second time, so `offset` was applied twice. `limit: 2, offset: 1` over five groups answered one row, the third, on the native-SQL strategy. It now windows only a grid it could not push down. The ObjectQL strategy answered that page correctly before, because it dropped the window; it still does.
  
  **Unchanged.** A query with no `order`, `limit` or `offset` answers exactly the engine's aggregate rows. Which `order` keys are accepted is unchanged: the analytics door still refuses a key the query does not select. The dataset door's own ordering is unchanged too: label sort keys, derived measures, the implicit dimension order for a bare `limit`, and the chronological default.
- 6d67ad5: fix(spec)!: an analytics query's `limit` and `offset` are non-negative integers, and the native face runs an `offset` with no `limit` on SQLite
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered analytics-query-window-non-negative-integer -->
  
  **BREAKING** — an accept-set narrowing of a published request schema, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads it: the `/analytics` doors, which parse every body with `AnalyticsQueryRequestSchema` (`POST /analytics/query`, `POST /analytics/sql`) or `DatasetSelectionSchema` (`POST /analytics/dataset/query`), and answer `400 VALIDATION_FAILED` before any engine runs.
  
  **`@objectstack/spec`**
  
  - **`AnalyticsQuerySchema.limit` and `.offset`** were a bare `z.number()`. They are `z.number().int().nonnegative()` now. A negative number, a fraction, and an integer above `Number.MAX_SAFE_INTEGER` are refused at the member. `limit: 0` stays legal and answers no rows.
  - **`DatasetSelectionSchema`** reads the same two declarations off `AnalyticsQuerySchema.shape`, so the dataset door holds the same accept set with no second copy. **`AnalyticsQueryRequestSchema`** extends the query, so it holds it too.
  - The TypeScript types are unchanged (`number`). Only the parse narrows.
  
  Before, no refused value had one answer. Measured at `POST /api/v1/analytics/query` on SQLite and PostgreSQL 16.14, `order { note: 'asc' }` over four groups:
  
  | window | native SQLite | native PostgreSQL | ObjectQL face |
  |:--|:--|:--|:--|
  | `limit: -1` | every row | 500 | all but the last row |
  | `limit: 1.5` | 500 | two rows | one row |
  | `offset: -1` | 500 | 500 | every row |
  
  Each one now answers `400 VALIDATION_FAILED`, with `details.fields[].field` naming `limit` or `offset` (`selection.limit` / `selection.offset` at the dataset door), on both drivers and both faces.
  
  **`@objectstack/service-analytics`**
  
  - **An `offset` with no `limit`** is a valid window: every row after the offset. The native-SQL strategy wrote `OFFSET n` with no `LIMIT` in front of it, and SQLite's grammar has no `OFFSET` without a `LIMIT`, so the query answered `500` (`near "OFFSET": syntax error`) on SQLite, while PostgreSQL and the ObjectQL face answered rows. The statement now carries the executing driver's no-limit spelling, read off the `sqlDialect` hook: `LIMIT -1 OFFSET n` on SQLite, `OFFSET n` alone on PostgreSQL (unchanged bytes), and `LIMIT 9223372036854775807 OFFSET n` when the host names no dialect. The MySQL arm is `LIMIT 18446744073709551615`, asserted as text only (no MySQL server was available to run it).
  - The echoed `sql` and `POST /analytics/sql` show the statement that ran, byte for byte, on this face.
  
  ## FROM → TO
  
  | you wrote in an analytics query or dataset selection | write instead |
  |:--|:--|
  | `limit: -1` (meant: no limit) | omit `limit` |
  | `limit: 1.5` | the integer page size you meant, for example `limit: 2` |
  | `offset: -1` | omit `offset`, or `offset: 0` |
  | `offset: 2.5` | the integer number of rows to skip, for example `offset: 2` |
  
  The one-line fix: write `limit` and `offset` as non-negative integers, or leave them out.
  
  ## Who is affected, measured
  
  At `origin/main` `ee75aae1a`: no example, package fixture, document or published skill writes a negative or fractional analytics `limit` or `offset`. The one stored producer that lowers into a dataset selection, a dashboard widget's `limit`, is already declared a positive integer (`z.number().int().positive()`). The sibling console repository and deployed metadata were not measured. The service does not parse a query passed to it in-process, so a host that builds an `AnalyticsQuery` in code parses it with `AnalyticsQuerySchema` before handing it over.
- d7d5b4f: fix(service-analytics): the ObjectQL strategy's echoed `sql` renders an offset with no limit in the dialect's own spelling, so SQLite runs the statement it prints
  
  Clause-②: no
  
  **Before**, the ObjectQL strategy wrote its own row window into the statement it echoes: `LIMIT n` when a limit was set, then `OFFSET n` when an offset was. An `offset` with no `limit` therefore echoed a bare `OFFSET`, which SQLite's grammar does not have. Measured through `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` on SQLite, for a composition served by the engine aggregate, with `order: { note: 'asc' }` and `offset: 1`: the rows were right (every group after the first), but the echoed `sql` and the `/analytics/sql` body both ended `ORDER BY "note" ASC OFFSET 1`, and SQLite refuses that statement with `near "OFFSET": syntax error`.
  
  **Now** the statement ends with the same window clause the native-SQL strategy runs, for the dialect of the driver that serves the object: `LIMIT -1 OFFSET 1` on SQLite, which runs and answers the same rows. One function renders the window for both strategies.
  
  **Unchanged.** The rows either strategy answers. A window with a `limit` keeps its bytes (`LIMIT 2 OFFSET 1`) on every dialect, and on PostgreSQL an offset with no limit still echoes `OFFSET 1` alone. A host that wires no `sqlDialect` hook gets the native strategy's dialect-neutral spelling, `LIMIT 9223372036854775807 OFFSET 1`. A date-bucketed dimension still echoes as `date_trunc(…)`, which SQLite does not run; this change touches only the window.
- 5d095a0: On SQLite, a `week` date bucket is grouped in SQL, and the analytics SQL echo never prints a bucket statement that SQLite refuses (#21595).
  
  Clause-②: no
  
  - **What was wrong.** `driver-sql` grouped `day`, `month`, `quarter` and `year` in SQL on SQLite, but not `week`. Its `supports.queryDateGranularity` said `week: false`, so the engine bucketed weeks in memory, and the ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` echoed the bucket as `date_trunc('week', col)`. SQLite has no `date_trunc`, so that echo could not run. A non-UTC `timezone` on SQLite gave the same echo for every granularity.
  - **What it does now.**
    - SQLite advertises all five granularities. `week` buckets as `YYYY-Www`, the ISO 8601 week that the PostgreSQL and MySQL arms answer. The expression does not use `strftime('%V')`, which needs SQLite 3.46: `@libsql/client` 0.18.0 bundles SQLite 3.45.1, where `%V` answers NULL. It runs on better-sqlite3, on libSQL (`driver-turso`) and on sql.js (`driver-sqlite-wasm`). A `Field.date` still buckets as its own calendar day.
    - The echo prints that expression for a `week` bucket on SQLite, and the statement runs.
    - With a non-UTC `timezone` on SQLite, `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. `POST /api/v1/analytics/query` still answers the rows, and its answer carries no `sql`. The engine buckets on that zone's calendar in memory, and SQLite has no time-zone database, so no SQLite statement produces those keys.
  - **Where it shows.** `aggregate()` with a `week` group on SQLite, `SqlDriver.dateBucketSql()`, and the analytics SQL echo. A query sent with `timezone: 'UTC'`, or with no `timezone`, still echoes the driver's own expression.
- 1968d5e: With a non-UTC `timezone`, the analytics SQL echo of a date-bucketed dimension refuses on every dialect instead of printing `date_trunc` (#21630).
  
  Clause-②: no
  
  - **What was wrong.** With a non-UTC `timezone`, the engine buckets a date dimension in memory on that zone's calendar, on every driver. The ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` still echoed the bucket as `date_trunc('month', col)` (or the asked granularity) on PostgreSQL and MySQL, a statement the engine never ran. On PostgreSQL that statement groups on the database session's calendar: measured on PostgreSQL 16.14 with the server at `Asia/Shanghai`, it answered timestamp keys such as `2025-12-31T16:00:00.000Z` where the query answered `2026-01`, and with `timezone: 'America/New_York'` it grouped the rows differently from the query. MySQL has no `date_trunc` at all. SQLite already refused this echo.
  - **What it does now.** For a date-bucketed dimension with a non-UTC `timezone`, on every dialect:
    - `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. This is the answer SQLite already gave.
    - `POST /api/v1/analytics/query` answers the same rows as before, and its answer carries no `sql`.
  - **Unchanged.** A query sent with `timezone: 'UTC'`, or with no `timezone`, still echoes the expression the driver groups by: `to_char(…)` on PostgreSQL, `date_format(…)` on MySQL and `strftime(…)` on SQLite.
- 31e3e00: The analytics SQL echo prints a date bucket only in the expression the driver itself groups it by, and refuses everywhere else, including on the in-memory and MongoDB drivers (#21647).
  
  Clause-②: no
  
  - **What was wrong.** At a `timezone` of `UTC`, or with none, the ObjectQL face of `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` echoed a date-bucketed dimension as `date_trunc('month', col)` (or the asked granularity) wherever the driver renders no bucket expression of its own, and documented that as representative. On `driver-memory` the engine only fetches the rows and buckets them itself, answering keys such as `2026-01` and `2026-W02`, while both faces printed `date_trunc(...)`, a statement nothing ran. `driver-mongodb`, which groups the bucket in its own aggregation pipeline, took the same path. So did any host that wires no `dateBucketSql` hook.
  - **What it does now.** Wherever no driver expression stands for the bucket, on every driver and dialect:
    - `POST /api/v1/analytics/sql` refuses with `NOT_IMPLEMENTED` / 501, declared as a refusal so its message reaches the caller. Its message names the cause. A non-UTC `timezone` and SQLite already answered this way.
    - `POST /api/v1/analytics/query` answers the same rows as before, and its answer carries no `sql`.
  - **Unchanged.** On PostgreSQL, MySQL and SQLite at `UTC` or with no `timezone`, the echo still prints the expression the driver groups by: `to_char(...)`, `date_format(...)` and `strftime(...)`.
- Updated dependencies [ecb6ca0]
- Updated dependencies [135daaa]
- Updated dependencies [22c2d6f]
- Updated dependencies [909229e]
- Updated dependencies [0721848]
- Updated dependencies [bdd3654]
- Updated dependencies [aead296]
- Updated dependencies [c205b6c]
- Updated dependencies [ad7c351]
- Updated dependencies [e901c27]
- Updated dependencies [a387354]
- Updated dependencies [f6b7520]
- Updated dependencies [36e4647]
- Updated dependencies [93a54b8]
- Updated dependencies [f623e2f]
- Updated dependencies [96a9719]
- Updated dependencies [41a3c8d]
- Updated dependencies [c52c49d]
- Updated dependencies [cfa4d74]
- Updated dependencies [99589f9]
- Updated dependencies [36ad321]
- Updated dependencies [dcc5ef4]
- Updated dependencies [748b240]
- Updated dependencies [9b7a0ef]
- Updated dependencies [5a9292e]
- Updated dependencies [30af17e]
- Updated dependencies [1c52a5e]
- Updated dependencies [99e1912]
- Updated dependencies [7ebb543]
- Updated dependencies [3911901]
- Updated dependencies [222ecc2]
- Updated dependencies [3937ad2]
- Updated dependencies [3a6d92f]
- Updated dependencies [7526058]
- Updated dependencies [53fd35e]
- Updated dependencies [23365ea]
- Updated dependencies [32d5769]
- Updated dependencies [16eefc6]
- Updated dependencies [6e33b67]
- Updated dependencies [57cc695]
- Updated dependencies [db3fee3]
- Updated dependencies [4c8363f]
- Updated dependencies [9f13c94]
- Updated dependencies [6d67ad5]
- Updated dependencies [ca0dfb6]
- Updated dependencies [45efcfa]
- Updated dependencies [6d728b8]
- Updated dependencies [c9c555a]
- Updated dependencies [68c5ab7]
- Updated dependencies [b793010]
- Updated dependencies [5555047]
- Updated dependencies [85e29b8]
- Updated dependencies [aa46322]
- Updated dependencies [100c394]
- Updated dependencies [72217cd]
- Updated dependencies [72af58c]
- Updated dependencies [1289925]
- Updated dependencies [958cfe2]
- Updated dependencies [ced3e1a]
- Updated dependencies [7d674df]
- Updated dependencies [3f1bc81]
- Updated dependencies [72f3c74]
- Updated dependencies [529d971]
- Updated dependencies [16d241a]
- Updated dependencies [4331a6b]
- Updated dependencies [6c5697d]
- Updated dependencies [9a4182a]
- Updated dependencies [41b1333]
- Updated dependencies [f1e4ae5]
- Updated dependencies [eb9ef79]
- Updated dependencies [eb9ef79]
- Updated dependencies [f83d066]
- Updated dependencies [1ac7308]
- Updated dependencies [10454b3]
- Updated dependencies [9e9d693]
- Updated dependencies [6ec54f0]
- Updated dependencies [98eb3b9]
- Updated dependencies [a2aadab]
- Updated dependencies [fe10172]
- Updated dependencies [ed15448]
- Updated dependencies [9d91f58]
- Updated dependencies [9059082]
- Updated dependencies [309224d]
- Updated dependencies [e83c9f6]
- Updated dependencies [045f764]
- Updated dependencies [2df3d13]
- Updated dependencies [07bf21f]
- Updated dependencies [6fb7115]
- Updated dependencies [53021e3]
- Updated dependencies [a0176ef]
- Updated dependencies [149153c]
- Updated dependencies [ba57588]
- Updated dependencies [a43d90a]
- Updated dependencies [607463d]
- Updated dependencies [cab6396]
- Updated dependencies [e864db5]
- Updated dependencies [866683f]
- Updated dependencies [88a39c0]
- Updated dependencies [8e35895]
- Updated dependencies [1f04696]
- Updated dependencies [d16b9fb]
- Updated dependencies [bab7685]
- Updated dependencies [fb69825]
- Updated dependencies [48eb9c1]
- Updated dependencies [8832655]
- Updated dependencies [100f68b]
- Updated dependencies [8963dbf]
- Updated dependencies [1354e7b]
- Updated dependencies [1cbe165]
- Updated dependencies [15fe567]
- Updated dependencies [0bddffd]
- Updated dependencies [7e0066a]
  - @objectstack/spec@17.7.0
  - @objectstack/core@17.7.0
  - @objectstack/types@17.7.0

## 17.6.0

### Minor Changes

- c8dd8dd: An authored analytics cube's measure `format` and time-dimension `granularities` now take effect on the analytics query doors, the way a compiled dataset's always have (#20282).
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered analytics-cube-single-granularity-default-enforced -->
  
  **BREAKING**: this narrows what `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` answer for one class of request. When an authored cube's time dimension declares exactly one granularity, a query that groups by that dimension without stating a granularity is now bucketed at the declared one. The raw-SQL path declines every bucketed query, so such a query now runs on the engine aggregate path, which answers `400 INVALID_FIELD` for every member it cannot evaluate: a custom-SQL measure (a measure of type `number`, `string` or `boolean` whose `sql` is an expression); and, on a cube whose members resolve through its `joins`, a measure or a `where` field over a joined object, a `timeDimensions` entry over a joined object (bucketed or a `dateRange` window, so grouping by a one-granularity time dimension over a joined object is refused too), a dimension that traverses more than one relationship, and an `avg` or `count_distinct` measure beside any dimension over a joined object. The raw-SQL path answers every one of these, with one group per distinct timestamp; each is now refused, exactly as it already was when the caller stated that granularity by hand. On a host that overrides `queryCapabilities` to offer raw SQL with no engine aggregate bridge (the plugin's default wires both), no strategy remains for a bucketed query, so every newly bucketed query, a plain `count` included, now answers "No strategy can handle query" instead of grouping raw timestamps. The remedy: run such a query without grouping by that dimension, or, if the dimension is not meant to have one default bucket, declare the granularities it offers as a list of two or more (or omit the key); on a raw-SQL-only host, add the engine aggregate bridge. It ships as `minor` under the launch-window convention; the widening half is two authored keys taking effect.
  
  Until this change both keys were read on the compiled-dataset path only. One cube shape has three producers — cubes authored with `defineCube()` / `defineStack({ analyticsCubes })`, cubes the dataset compiler mints, and cubes inferred for an ad-hoc query — and only a compiled dataset's cube reached the two readers:
  
  - **`measures.<metric>.format`** reached a caller as `fields[].format` only because the dataset door copies it from the DATASET measure. An authored cube has no dataset, so `POST /api/v1/analytics/query` described its measure columns with `name` and `type` alone. Now every measure column a query names carries the `format` its cube measure declares, whichever strategy answered, and a column that declares none carries no `format` key at all. `GET /api/v1/analytics/meta` is unchanged: its projection stays `name`, `type` and `title`, and a client reads `format` off the query result's `fields[]`, as the Data API page already says. The value is relayed verbatim; the vocabulary `fields[].format` documents is a numeral pattern such as `"$0,0.00"` or `"0.0%"`.
  - **`dimensions.<dimension>.granularities`** was the default bucket only for a compiled dataset, which the dataset executor filled in before querying. An authored cube's time dimension grouped raw timestamps whatever it declared. Now `query()` and the `generateSql()` dry run read it the same way, through the one rule both paths share: a single-entry list is the dimension's default bucket for a query that groups by it; a granularity the query states always wins, and one the list does not name is not refused (the dataset path compares against no list either); a list of two or more states no default; and a `timeDimensions` entry that carries only a `dateRange` for a dimension the query does not group stays a filter.
  
  What to expect after upgrading:
  
  - **A cube measure that declares `format`** now carries it on `POST /api/v1/analytics/query` results. A client that formats amounts from `fields[].format` starts formatting that column.
  - **A cube time dimension that declares one granularity** (`granularities: ['month']`) is now bucketed by it when a query groups by it without stating one: one row per month where there was one row per timestamp. Name another granularity in the query's `timeDimensions` to bucket differently.
  - **A cube time dimension that declares several, or none**, behaves exactly as before.
  - **Compiled datasets** (`POST /api/v1/analytics/dataset/query`) answer exactly as before: the value read off their cube is the one the dataset door already used.
  
  In `@objectstack/spec`, `MetricSchema.format` and `DimensionSchema.granularities` now carry descriptions that state what the analytics service does with them (the metric's example values move from the names "currency" / "percent" to numeral patterns, the vocabulary the `fields[].format` slot documents), and the liveness ledger rows `analytics_cube.measures.format` and `analytics_cube.dimensions.granularities` move from `dead` to `live`, citing the new readers.
- 03cdb9a: `GET /api/v1/analytics/meta` now publishes an analytics cube's `description`, each measure's and dimension's `description`, and each measure's `format`, when the cube definition declares them (#20282).
  
  Clause-②: yes (widening)
  
  - `CubeMeta` (`@objectstack/spec/contracts`) gains an optional `description` on the cube and on each measure and dimension, and an optional `format` on each measure. `AnalyticsMetadataResponseSchema` declares the same members. A definition that declares none of them is published exactly as before.
  - `AnalyticsService.getMeta` copies what the definition declares and fills in nothing. A cube compiled from a dataset carries each dataset measure's `format` and no `description`.
  - The liveness ledger rows `analytics_cube.description`, `measures.description` and `dimensions.description` move from `dead` to `live`.
  
  This supersedes one sentence of this release's note on an authored cube's measure `format` and `granularities`: it says `GET /api/v1/analytics/meta` is unchanged and keeps `name`, `type` and `title`. With this change `/meta` also publishes each measure's declared `format`. A client that formats a result column still reads `format` off the query result's `fields[]`.
- 00a92e1: fix(service-analytics)!: a cube or dataset dimension on a structured-JSON field is refused with `INVALID_FIELD` / 400 at the analytics door, before any SQL is built
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a refusal of a grouping TARGET at the analytics door: a `dimensions` entry, or a bucketed `timeDimensions` entry, whose column is a declared json, composite, repeater, record, location, address or vector field. No authorable key, spelling, export or stored shape moves (the door module is internal; `@objectstack/service-analytics` exports nothing new and nothing less, and `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every member), and no stored row is read or rewritten. The grouping had no shared meaning to preserve (one group per serialized document on SQLite, a 500 on PostgreSQL), and which scalar part of the document a caller meant to group on is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a grouping target (not `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what the analytics query doors accept as a dimension. A cube dimension, or a dataset dimension, whose column is a declared field of the structured-JSON class (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`) is refused before either strategy builds a statement, when it groups the result: a `dimensions` entry, or a `timeDimensions` entry with a `granularity`. The column is judged where it is declared: on the cube's object, or, for a dotted path such as a dataset dimension over `account.hq`, on the object the cube's declared join for that path names. It holds on `POST /api/v1/analytics/query`, on its dry run `POST /api/v1/analytics/sql`, and on `POST /api/v1/analytics/dataset/query`, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **What an author sees now.** `400 INVALID_FIELD`, naming the member as the request wrote it (the cube dimension, or the dataset dimension), the column it groups by, the object and the column's declared type, saying the query was not run, and naming the route: group by a field that stores one scalar value, storing the part of the document you group on in a field of its own. The thrown error carries `member`, `param` (`dimensions` or `timeDimensions`), `cube`, `field` and `object`.
  
  **Why a refusal.** A JSON document is no group key the SQL dialects share. Measured through `POST /api/v1/analytics/query` over three rows with a different document each, on the service `AnalyticsServicePlugin` composes over a real engine: SQLite answered 200 with one group per serialized document, and PostgreSQL 16 answered 500 `DATABASE_ERROR`. A dataset dimension over a joined object's `json` field answered the same two ways through `POST /api/v1/analytics/dataset/query`. The native-SQL strategy compiled the `GROUP BY` itself, so the engine's own refusal of a structured-JSON `groupBy` never saw the query; the engine-aggregate strategy did reach that refusal, but named the engine's `groupBy[0]` position rather than the member the caller wrote. The class is `@objectstack/spec/data`'s `STRUCTURED_JSON_TYPES`, the one the engine's refusal reads. No producer groups by such a field: no cube or dataset dimension in the example apps names one.
  
  **Who is affected.** A dashboard, report or caller that grouped an analytics query by a structured-JSON field on SQLite and read one group per serialized document as real groups. On PostgreSQL the same query was already a 500.
  
  **Unchanged.** A dimension on any other type; a `timeDimensions` entry with no `granularity`, which bounds a range and groups nothing; measures (this door judges only the members that group); a dotted dimension path the cube declares no join for, whose object is not a declaration; a member naming a column the object does not have, which keeps its existing `INVALID_FIELD` answer first; and a host that wires no `sourceFieldMeta`, where the column's type cannot be read.
- 793fb83: The analytics seams now run the one shared filter lowering (`lowerFilterCondition`, `@objectstack/spec/data`) that ADR-0053 D-D1, as amended, places at every seam that runs the shared comparand doors: after the doors and after filter-token resolution, so each face compiles one lowered condition — the `$between` split, the whole-day upper bound on a bare `YYYY-MM-DD`, the last supported day, and the NULL-polarity guards.
  
  Clause-②: yes
  
  **The read scope (`compileScopedFilterToSql`).** The scope is lowered at the compiler's entry, right after its placeholders resolve. It reads each column's declared type from the `declaredValueShape` option both of its consumers already pass, so the whole-day rule rewrites a declared `datetime` column and nothing else; with no declarations handed in, no column is read as `datetime`. Corrected answers, each now the rows `SqlDriver.find` returns for the same filter:
  
  - a bare-day `$lte` on a declared `datetime` column kept only the rows before that day and dropped the day itself. Rows at 10:00Z on 07-27, 07-28 and 07-29 under `{ signed_at: { $lte: '2026-07-28' } }` answered 07-27 alone; they now answer 07-27 and 07-28, compiled as `< '2026-07-29'`. This is the NativeSQL statement's read scope and the `/analytics/sql` echo's.
  - a bare-day `$between` on a declared `datetime` column answered no row for a one-day range, and now answers that day's rows.
  - a `{today}` (or any date-macro) upper bound is widened as the day it resolves to.
  
  An RLS `using` bound already reached the read scope lowered by the RLS compile seam, and answers as before. A declared `date` column compiles byte-identical to before.
  
  **The analytics `where` and draft-preview door.** The condition the door admits is lowered before either face reads it. The `where` → tree face (both strategies) reads each member's declared column type through the host's declared-type hook: a bare-day `$lte` on a `datetime` member now reaches the engine as `$lt` the next day, and the `/analytics/sql` echo prints that half-open bound — the statement the engine runs, where it used to print `<=` the named day. Rows are unchanged on every strategy. A nested-relation filter (`{ account: { region: 'NA' } }`) is spelled as the dotted member it has always compiled to before the lowering reads it, so a guard it adds under `$not` names that member.
  
  The draft preview (`queryDataset` with `previewDrafts`) now evaluates `$null` — the one operator the lowering emits that it did not — so a drafted chart filtered on `{ field: { $null: true } }` is answered instead of refused `INVALID_FILTER` / 400; `$exists` and `$empty` stay refused. Corrected answers: a row with no value now satisfies `$ne`, `$nin` and the negation of an equality even when the comparand is the text `"null"` or `"undefined"`, which this face used to compare as text against the missing value — the answer every data driver gives. Its bare-day bounds answer as before.
  
  Compiled SQL for `$ne`, `$nin`, `$notContains` and a `$not` operand now carries the lowering's NULL guard around each face's own copy of it: the same rows, a longer statement, until those copies are deleted.
- 8d329f0: fix(service-analytics)!: the nested-relation filter `{ relation: { field: value } }` gets the engine's answer on every analytics face — the related object read as the caller, capped
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a change of what the analytics query doors answer for one filter form, the nested-relation condition `{ relation: { field: value } }`: it is now answered by the data engine, which reads the related object as the caller and refuses past its cap, where the analytics layer used to join the related table itself. No authorable key, spelling, export or stored shape moves: `@objectstack/service-analytics` exports nothing new and nothing less, `FilterCondition`, `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every value they parsed, and no stored row is read or rewritten. What a stored dashboard or dataset filter carrying the form now gets is the engine's own answer for the same filter on `find()`, so there is no older meaning to preserve or rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a filter's analytics semantics (not `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what the analytics query doors answer for the nested-relation filter form — a plain object with no `$` key beneath a field, `{ owner: { region: 'NA' } }` — on the native-SQL path, and widens it everywhere else. It holds on `POST /api/v1/analytics/query`, on `POST /api/v1/analytics/dataset/query`, and on their dry run `POST /api/v1/analytics/sql`, on every SQL driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **What an author sees now.** The same answer `find()` gives for the same filter. The data engine reads the related object with the condition as the caller — that object's row scope and field permissions apply — and matches the relation against the ids it returns: `$in` on a single-valued relation, any member on a multi-valued one. It is the one rule, in the engine; the analytics layer holds no copy of it.
  
  - A condition on a field of the related object the caller cannot read is refused with `403 PERMISSION_DENIED`, naming the field — never answered.
  - A condition matching more than 1,000 related records is refused with `400 INVALID_FILTER`, naming the two-step route — never run over a cut-off list.
  - At a measure's own `filter` the form is refused with `400 INVALID_FILTER`, as the engine refuses it at an aggregation's own `filter`: put the condition in the query's `where`.
  - `POST /api/v1/analytics/sql` refuses a `where` carrying the form with `400 INVALID_FILTER`: no statement it could print reproduces a read of the related object as the caller. The query itself is answered by `POST /api/v1/analytics/query`.
  
  **Why.** Measured on the base before the field-level gate (#20917) and the relationship-path admission (#20933) landed, over one fixture with the real security layer (a related field the caller may not read, a related row scope, 1,001 matching related records). The native-SQL strategy flattened the form to a dotted member and joined the related table: through a dataset that `include`d the relationship it answered rows for a condition on a field the caller cannot read, answered a match past the engine's cap, and counted a measure filter carrying the form; without the declared join it named a table that does not exist (500), and a multi-valued relation was refused. The engine-aggregate strategy refused the form as a cross-object filter (400). The engine serves the form since the nested-relation filter landed in `where`.
  
  **How.** The native-SQL strategy declines a query in which the form appears in the `where`, the dataset's own `filter` or a requested measure's `filter`, so the query runs on the engine-aggregate path, which hands the form to the engine as written.
  
  **A read scope carrying the form.** Unchanged in outcome: where a read scope is compiled to SQL (`compileScopedFilterToSql`, on the native-SQL path and in both SQL echoes) it is still refused fail-closed with `500 READ_SCOPE_COMPILE_FAILED`, the policy withheld — that compile holds no data engine to read the related object with. Its words now name the route that serves the form. On the engine-aggregate path the scope reaches the engine as written, and the engine serves it as the caller, as before.
  
  **Who is affected.** A dashboard, dataset or caller that wrote the nested form in an analytics filter on a SQL driver and read the joined answer: a condition on a related field the caller may not read, a match past 1,000 related records, a measure filter carrying the form, or a query that needs the native-SQL strategy for another part (a cross-object measure, a multi-hop dimension), which the engine-aggregate path refuses in its own words.
  
  **Unchanged.** The dotted cube member (`{ 'owner.region': 'NA' }`), a traversal through the cube's declared join; an empty object beneath a field (`{ owner: {} }`), still refused as a field constraint with no operator; every filter without the form.
- bb2eccf: fix(service-analytics)!: a grouped dimension on a multi-value field and a `count_distinct` measure over a JSON-stored field are refused with `INVALID_FIELD` / 400 at the analytics door, before any SQL is built; a dataset `count_distinct` measure over a field declared `multiple: true` is refused at compile time
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (runtime-interface-only packages/services/service-analytics/src/dataset-compiler.ts#DatasetCompileOptions) a published options interface of `compileDataset`, whose one probe member is renamed and now answers the field's declaration instead of its type. It is not a Zod schema, a `packages/spec` declaration or an object definition, it is not a projection of a schema, and no metadata surface references it, so `objectstack migrate meta` has nothing to rewrite; the TypeScript host that passed the old member is told by its compiler at its own call site. The other halves refuse a QUERY shape at the analytics door (a grouping or distinct-count target) and one aggregate x declaration pair at the dataset compile door: no authorable key, spelling or stored row moves (`CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every member), and which scalar a caller meant to group on or count is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an analytics grouping or distinct-count target or this interface, and this diff adds none (not `registered` / `already-registered`); and the interface was concretely typed at the merge base, not erased (not `type-surface-only`). -->
  
  **BREAKING**: this narrows what the analytics query doors accept, in two positions, and what the dataset compiler accepts, in one. It holds on `POST /api/v1/analytics/query`, on its dry run `POST /api/v1/analytics/sql` and on `POST /api/v1/analytics/dataset/query`, on every driver and on both strategies. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  - A cube or dataset dimension whose column is a **multi-value** field, when it groups the result (a `dimensions` entry, or a `timeDimensions` entry with a `granularity`): an inherently multi option type (`multiselect`, `checkboxes`, `tags`), or a `select`, `radio`, `lookup`, `user`, `file` or `image` field declared `multiple: true`. The same types without the flag are served.
  - A `measures` entry that resolves to a `count_distinct` measure whose column is **JSON-stored**: a structured-JSON type (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), an inherently multi option type, or a multi-capable field declared `multiple: true`. An authored cube measure, a suffix-inferred one (`tags_count_distinct`) and a compiled dataset's are judged alike; a `count` measure is not judged.
  - A dataset measure that pairs `count_distinct` with a base-object field declared `multiple: true` is refused `400 DATASET_INVALID` when the dataset compiles, at registration and on the request door, beside the type row that already refused `tags`.
  
  The column is judged where it is declared: on the cube's object, or, for a dotted path, on the object the cube's declared join names.
  
  **What an author sees now.** `400 INVALID_FIELD`, naming the member as the request wrote it, the column, the object, the declaration (`select with multiple: true`), saying the query was not run, and naming the route. For a multi-value field the route is a record query on the declaring object filtered by one member with `$contains`, one query per member. For a structured-JSON field it is to store the scalar part in a field of its own. The thrown error carries `member`, `param` (`dimensions`, `timeDimensions` or `measures`), `cube`, `field` and `object`. The dataset compile refusal names the measure, the field and its declaration with `multiple: true`.
  
  **Why a refusal.** The engine's aggregate door already refuses both shapes, and the native-SQL strategy compiled its own statement and never reached it. Measured through this service as `AnalyticsServicePlugin` composes it over a real engine: a dimension on a `tags`, `multiselect` or `multiple: true` select answered 200 with one group per serialized array on SQLite and 500 `DATABASE_ERROR` on PostgreSQL 16; an inferred `count_distinct` over a `json`, `tags` or `multiple: true` select field answered 2, 3 and 2 on SQLite and 500 on PostgreSQL; a dataset `count_distinct` over the `multiple: true` select registered, then answered 2 on SQLite and 500 on PostgreSQL. The engine-aggregate strategy answered 400 for every one of these, under the engine's position (`groupBy[0]`, `aggregations[0].field`) rather than the member the caller wrote. The predicates are `@objectstack/spec/data`'s, the ones the engine's doors read: `isMultiValueField`, and the aggregate × field-type table's `count_distinct` row.
  
  **Your fix (a host calling `compileDataset` directly).** `DatasetCompileOptions` no longer has `declaredFieldType`. Pass `declaredValueShape` instead: the same read of the field's metadata, answering `{ type, multiple }` (the type, and `multiple === true`) rather than the type alone, or `undefined` when nothing answers. A host that passes neither compiles exactly as before, with no aggregate × field-type refusal at all. `AnalyticsService` and `AnalyticsServicePlugin` wire it themselves from `sourceFieldMeta`.
  
  **Who is affected.** A dashboard, report or caller that grouped by a multi-value field, or counted a JSON-stored field distinct, through the native-SQL strategy on SQLite and read the serialized arrays or the text-compared count as real answers. On PostgreSQL the same queries were already a 500. A dataset that pairs `count_distinct` with a `multiple: true` field no longer registers.
  
  **Unchanged.** A dimension or `count_distinct` on a scalar-stored field, a single-value `select` or `lookup` included; `count` over any field; a member naming a column the object does not have, which keeps its existing `INVALID_FIELD` answer first; a dotted path the cube declares no join for; a measure whose `sql` is an expression; and a host that wires no `sourceFieldMeta`, where the declaration cannot be read.
- 1571aed: fix(service-analytics)!: every analytics face answers the engine's field-level read refusal, whichever strategy serves the cube: a field the caller may not read is judged before either strategy runs (#20917)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses analytics queries that read a field the caller's field-level permissions hide, which the engine already refuses on the data API and on the ObjectQL strategy, so there is nothing for `objectstack migrate meta` to rewrite. The one public-surface addition is a new optional service hook. -->
  
  **BREAKING for analytics queries that read a field the caller may not read: on a SQL deployment, and on `POST /api/v1/analytics/sql` whichever strategy serves the cube.**
  
  **What changed.** `POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`
  and `POST /api/v1/analytics/dataset/query` now judge every field a query reads
  against the caller's field-level read permissions before a strategy is chosen:
  dimensions, measures, time dimensions, filter members, order keys, members
  joined through a relationship, and a dataset's own and its requested measures'
  filters. A member of an authored cube is judged by the field it resolves to,
  not by its name in the cube. A field the caller may not read answers
  `403 PERMISSION_DENIED`, in the words the engine uses for the same field. The
  native-SQL strategy, the one a SQL driver serves first, answered such queries;
  the ObjectQL strategy already refused them on `POST /api/v1/analytics/query`
  and `POST /api/v1/analytics/dataset/query`, as the data API did, but printed
  the statement on `POST /api/v1/analytics/sql`.
  
  **What is not affected.** A query that reads only fields the caller may read
  answers as before. A system context, and a caller with no permission sets, are
  unaffected, as on the data API. A host read scope (row-level policy) may still
  name fields the caller cannot read. A deployment with no security service is
  unaffected too: the in-repo kernels throw on a `security` service nothing ever
  registered, so its analytics queries were already refused, fail-closed, at the
  object-level read gate, and still are. A member of an authored cube whose `sql`
  is an expression is not attributed to a field.
  
  **New hook.** `AnalyticsServiceConfig.getReadableFields(object, context)` supplies
  the reader. `AnalyticsServicePlugin` wires it to the `security` service's
  `getReadableFields`; a host that constructs `AnalyticsService` itself passes its
  own, and without one no field-level check applies.
  
  **If a widget stopped answering for some users,** it reads a field those users
  may not read. Grant that field's read permission to the users who need it, or
  build the widget on fields they can read.
  
  *Erratum, 2026-10-08 — this entry said "A deployment with no security service applies no field-level check, as on the data API." The sentence was false when published: in the published 17.6.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, and the analytics bridges answer that throw by refusing the query, fail-closed. One passage above is corrected in place; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 5dbeb7d: fix(service-analytics): on the engine-aggregate path, a `$not`, `$notContains` or null test over a multi-valued lookup now gets the engine's rows instead of `400 INVALID_FILTER` (#20918)
  
  Clause-②: yes
  
  **What changed.** `POST /api/v1/analytics/query` and `POST /api/v1/analytics/dataset/query`, when served by the engine-aggregate strategy (a query with a granularity, or a host with no raw SQL), used to refuse these filters on a SQL driver when the field is a multi-valued lookup (or any other JSON-stored multi-value field). The engine's `find()` and the native-SQL strategy answered them:
  
  - `{ $not: { owners: { $contains: 'u1' } } }`, and any `$not` whose operand tests such a field;
  - `{ owners: { $notContains: 'u1' } }`;
  - `{ owners: { $null: false } }`, `{ owners: { $exists: true } }`, `{ owners: { $null: true } }`, and the same tests in a dataset measure's own `filter`.
  
  Each now answers the rows the native-SQL strategy answers. Where `engine.find()` serves the same filter, those are its rows too.
  
  **Why.** The analytics `where` door adds a NULL test beside each leaf of a `$not` operand, so that a row holding no value is still answered by the negation. It adds a NULL alternative to the negative-polarity operators too. The engine-aggregate strategy passed both tests to the engine as `{ $ne: null }` and the bare `{ field: null }`. `driver-sql` refuses both spellings over a JSON column, so the whole filter was refused. They now reach the engine as `{ $null: false }` and `{ $null: true }`. The engine's own filter lowering writes the same tests in those spellings for every driver, and `driver-sql` applies them on a JSON column.
  
  **Unchanged.** Every filter on a single-valued field gets the same rows as before. The native-SQL strategy and the `POST /api/v1/analytics/sql` echo are unchanged: they compile their own SQL. A read scope is unchanged too.
  
  **One difference from the engine remains.** `{ owners: { $ne: null } }` and the bare `{ owners: null }` are null tests at the analytics door. Both strategies now answer them, the native strategy as before. `engine.find()` refuses them, because `driver-sql` reads `$ne` and the bare equality as value comparisons on a JSON column. `{ $null: false }` / `{ $null: true }` is the spelling both read the same way.
- 5f6b63a: fix(service-analytics)!: an object an analytics query reads through a relationship path is admitted and row-scoped exactly as a declared join to it is, on both strategies (#20933)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses, or row-scopes, what the native-SQL strategy read from an object reached through an undeclared relationship path, the way a declared join to the same object already was; there is nothing for `objectstack migrate meta` to rewrite. -->
  
  **BREAKING for analytics queries that read a related object through a relationship path the cube does not declare: on a SQL deployment, and on `POST /api/v1/analytics/sql` whichever strategy serves the cube.**
  
  **What changed.** The analytics door admits and row-scopes one object set
  before either strategy runs. It held the cube's base object and the joins the
  cube declares (`joins`, or a dataset's `include`). An object reached through a
  relationship path the cube does not declare was not in it, although both
  strategies read that object: a dotted member of an inferred cube, an authored
  member whose `sql` walks a relationship the cube's `joins` does not list, or a
  dotted member the query names itself. Every such object is now in the set, so
  `POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql` and
  `POST /api/v1/analytics/dataset/query` treat it exactly as a declared join:
  
  - a related object the caller may not read answers `403 PERMISSION_DENIED`,
    naming that object, before any statement runs;
  - the caller's row scope on the related object is applied, so related rows
    outside it are not read. On the native-SQL strategy a base row whose related
    record is outside the scope drops out of the answer, as it already did for a
    declared join; the ObjectQL strategy still groups such rows as restricted;
  - a related-object scope the native-SQL strategy cannot compile routes the
    query to the ObjectQL strategy, as it already did for a declared join.
  
  Each hop of a multi-hop path is judged on its own object, resolved the way the
  field-level gate resolves it: the join the cube keys by the path, or else the
  relationship name itself.
  
  **What is not affected.** A query through a related object the caller may read
  answers as before, within the caller's row scope. A system context, and a
  caller with no permission sets, are unaffected, as on the data API. A
  deployment with no security service is unaffected too: the in-repo kernels
  throw on a `security` service nothing ever registered, so the object-level
  gate already refused its analytics queries, fail-closed, and still does.
  
  **Refusals that change form.** On the ObjectQL strategy a related object the
  caller may not read was already refused on `POST /api/v1/analytics/query` and
  `POST /api/v1/analytics/dataset/query`, though `POST /api/v1/analytics/sql`
  printed the statement; on those two doors it now answers the analytics door's
  refusal rather than the engine's, the same one a declared join gets. A filter,
  a time window or a two-hop path through such an object moves from
  `400 INVALID_FIELD` to that `403`. A relationship path whose relationship name
  is not itself an object name was never served by either strategy; for a caller
  the object-level check applies to, it now answers `403 PERMISSION_DENIED`
  naming that relationship.
  
  **If a widget stopped answering for some users,** it reads a related object
  those users may not read. Grant read access on that object to the users who
  need it, or build the widget on objects they can read.
  
  *Erratum, 2026-10-08 — this entry said "A deployment with no security service applies no object-level check, as on the data API." The sentence was false when published: in the published 17.6.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, and the analytics bridges answer that throw by refusing the query, fail-closed. One passage above is corrected in place; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 83480c6: fix(service-analytics)!: a field the caller is served masked is refused as a group key, an aggregate input, a filter or a sort key on every analytics face, whichever strategy serves the cube (#20935)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key, export or stored shape is removed or renamed. The change refuses analytics queries that group, aggregate, filter or sort by a field the caller may only see masked, which the engine already refuses on the data API and on the ObjectQL strategy, so there is nothing for `objectstack migrate meta` to rewrite. The one public-surface addition is a new optional service hook. -->
  
  **BREAKING for analytics queries on a SQL deployment that group, aggregate, filter or sort by a field the caller may only see masked.**
  
  **What changed.** The field-level gate on `POST /api/v1/analytics/query`,
  `POST /api/v1/analytics/sql` and `POST /api/v1/analytics/dataset/query` judged
  each member by the caller's readable fields. A field whose `maskingRule` applies
  to the caller is readable (its values are served masked), so the gate admitted
  it, and the native-SQL strategy then grouped or filtered by the stored value.
  The gate now also asks which fields the caller may query on, and refuses a
  member naming a masked field with `403 PERMISSION_DENIED`, in the words the
  engine uses for the same field. The ObjectQL strategy and the data API already
  refused these queries.
  
  **What is not affected.** A caller who holds the capability that lifts a
  field's masking rule queries the field as before. A system context is
  unaffected. A query that names no masked field answers as before.
  
  **New hook.** `AnalyticsServiceConfig.getQueryableFields(object, context)`
  supplies the answer. `AnalyticsServicePlugin` wires it to the `security`
  service's `getQueryableFields`. When that service predates the method, or
  answers "no answer", the plugin treats every field that declares a
  `maskingRule` as not queryable, for every caller. A host that
  constructs `AnalyticsService` itself with `getReadableFields` and without
  `getQueryableFields` is warned once at construction.
  
  **If a widget stopped answering for some users,** it groups or filters by a
  field those users see masked. Give the users who need it the capability the
  field's `requiredPermissions` names, or build the widget on fields they can query.
- 9b81314: fix(service-analytics)!: a relationship-path hop the cube declares no join for reads the object its lookup field declares, so an inferred cube's dotted path through a lookup named differently from its target is answered
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a change of which OBJECT the analytics doors read at a relationship-path hop the cube declares no join for: the object the lookup field declares as its `reference`, where it used to be an object named after the field. No authorable key, spelling, export or stored shape moves: `@objectstack/service-analytics` exports nothing new and nothing less, `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every value they parsed, and no stored row is read or rewritten. A cube that declares its join keeps it. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers which object a hop reads (not `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this widens what the analytics query doors answer for a dotted relationship path the cube declares no join for — an inferred cube's dotted member (`owner.region`), or an authored member whose `sql` walks a relationship its `joins` does not list — and narrows it in one case, named below. It holds on `POST /api/v1/analytics/query` and on its dry run `POST /api/v1/analytics/sql`, on both strategies and every SQL driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **What an author sees now.** Each hop of the path reads the object its lookup field declares as its target, the way a join the cube declares already did. With a lookup `owner` that references a person object:
  
  - the caller may read the person object: `dimensions: ['owner.region']` is answered with the person rows' regions on both strategies, and `where: { 'owner.region': 'NA' }` is answered on the native-SQL strategy with what the nested form `{ owner: { region: 'NA' } }` answers. The engine-aggregate strategy keeps refusing a filter on a related value with its own `400 INVALID_FIELD`, as it does through a declared join;
  - the caller may not read the person object: `403 PERMISSION_DENIED` naming the person object, before any statement runs;
  - the field-level gate judges `region` on the person object, and the caller's row scope on the person object is applied where the related value is read (the join on the native-SQL strategy, the related read on the engine-aggregate one).
  
  A lookup to the cube's own object (a self-reference such as `parent`) is read the same way. A lookup named after its target answers exactly as before.
  
  **Why.** An inferred cube declares no join, so a hop fell back to an object named after the lookup field. For a lookup named differently from its target that is no object: a caller who may read both objects was refused `403` "reading "owner" is not permitted", and a caller the object check passes reached a statement over a table named `owner` (`500`).
  
  **The narrowing.** A lookup whose name is ALSO the name of another object — a field `account` referencing `crm_account` while an object `account` exists — used to be read from that other object: joined by the ids of the records the field points to, admitted and scoped as that other object. It now reads its declared target. So that path answers from the target's rows, and a caller who may not read the target is refused `403 PERMISSION_DENIED` naming it, where the query used to be answered.
  
  **Unchanged.** A cube that declares a join for the path keeps reading the join's object. A host that wires no `relationshipResolver` (`AnalyticsServicePlugin` always wires it, from the data engine's object schema), or a relationship field it cannot answer for, keeps reading the object named after the field. A dataset's `include` compiles to declared joins, so a path it declares is unchanged.
- 58a77db: fix(service-analytics)!: the analytics read scope and the native `where` answer `$contains` / `$notContains` on a multi-valued or JSON-stored field by membership, with the one construct `driver-sql` emits, now exported from `@objectstack/core` (#20987)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a correction of which rows two analytics SQL faces answer for one operator on one declared field class: the read scope `compileScopedFilterToSql` compiles from a row policy, and the native strategy's rendering of a query's `where`. No authorable key, spelling, export or stored shape of metadata moves; `packages/spec` is untouched, and the contract sentence the faces now meet (`FILTER_OPERATORS.$contains`) is the one already declared. A policy or filter that was written stays written as it was, and what it now selects is what the data door already selected for it, so there is nothing a ledger entry could rewrite. The new refusal on a datasource whose SQL dialect the host cannot name is a refusal of a query, not of stored metadata. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a filter operator's reading (not `registered` / `already-registered`); and the change is runtime behaviour plus one additive export, not a declaration change (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what the analytics doors answer for one class of read. A row policy (the read scope the analytics plugin compiles from the security service, or a host's own `getReadScope`) whose `$contains` or `$notContains` names a field declared multi-valued (`multiple: true` on a multi-capable type, or a multi-option type) or JSON-stored now selects the rows holding the comparand as an ELEMENT of the stored list. It used to select every row whose stored JSON text contained the comparand as a substring, so on SQLite a policy could admit rows outside it, and on PostgreSQL every query under such a policy answered `500` (MySQL was not measured). An analytics count under such a policy now equals what the same caller reads through the data door. On a datasource whose SQL dialect the analytics host cannot name, such a policy now refuses the query (`READ_SCOPE_COMPILE_FAILED` / `500`) instead of falling back to the substring reading. It ships as `minor` under the launch-window convention.
  
  **The `where`.** `POST /api/v1/analytics/query`, the dataset door and `/analytics/sql` on the native strategy render the same membership test for a `$contains` / `$notContains` in a query's `where` (or a dataset's `runtimeFilter`) on such a field: on PostgreSQL the query answers rows where it answered `500`, and on SQLite the count stops over-counting (`$contains`) and under-counting (`$notContains`). On a datasource whose dialect the host cannot name, the operator on such a field is refused `INVALID_FILTER` / `400`. The ObjectQL strategy already answered membership and is unchanged.
  
  **Unchanged.** On a scalar text field `$contains` stays the substring test, on every face. `$notContains` keeps its NULL rule: a row with no value satisfies it. A host that wires no field metadata keeps the substring reading, because it cannot tell a JSON column from a text one; the analytics plugin wires it from the data engine.
  
  **New export.** `@objectstack/core` exports `jsonMembershipPredicate(dialect, emitters, value)` and `jsonMembershipCandidates(value)`, with the `JsonMembershipDialect` and `JsonMembershipEmitters` types: the per-dialect membership construct (#17590) moved from `@objectstack/driver-sql`, where it was module-private, and made placeholder-agnostic. `@objectstack/driver-sql` imports it and emits byte-identical statements and bindings.
  
  **What to do after upgrading.** Nothing, unless a policy or a dashboard filter relied on the substring reading of a multi-valued or JSON-stored field: such a filter now selects members only, as the data door always did. A host whose analytics `sqlDialect` hook answers nothing for a SQL datasource should answer `'sqlite'`, `'postgres'` or `'mysql'`, or the operator on such a field is refused.
- 39ab294: fix(service-analytics)!: the cube door asks the aggregate × field-type table for every measure, so a configured or suffix-inferred cube measure whose aggregate the table refuses for its column's declared type answers `INVALID_FIELD` / 400 on every driver and both strategies, and a `min` / `max` over a temporal column is described `time` in `fields[]`
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered dataset-measure-selecting-aggregate-field-type-refused, dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: every refused min / max pair is registered under protocol major 18 by the first id and every refused sum / avg pair by the second, each with its routes (count, a sort for a first or last record, or a numeric / temporal field for a quantity stored as text). This change adds a query-time reader of the same table at the analytics cube door; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves: CubeSchema and the analytics query body keep parsing every member. -->
  
  **BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on every driver and on both strategies. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  FROM → TO, for a `measures` entry that resolves to a cube measure over a column of the cube's own object (an authored cube measure, or a suffix-inferred one such as `note_max`):
  
  - `min` / `max` over a type outside the numeric, temporal and boolean classes (the string family such as `text`, `email` and `url`; `select`, `radio`, `lookup`, `user`; `autonumber`; the JSON-stored, file and `formula` types): FROM, on the native-SQL strategy, `200` with the column's own value (a string such as `"y"`) under `fields[] { type: 'number' }`, on SQLite and PostgreSQL alike; on the ObjectQL strategy the engine's door already answered `400 INVALID_FIELD` after the strategy began. TO `400 INVALID_FIELD` before either strategy reads anything.
  - `sum` / `avg` over a type outside the numeric and boolean classes (`sum` also refuses `percent`): FROM `200` with a plausible `0` on SQLite and `500 DATABASE_ERROR` on PostgreSQL (the ObjectQL strategy refused `avg` at the engine and passed `sum` to the driver, which answered the same `0` / `500`). TO `400 INVALID_FIELD`.
  - `min` / `max` over a `date`, `datetime` or `time` column: FROM `fields[] { type: 'number' }` beside the instant. TO `fields[] { type: 'time' }`, the `DimensionType` word a temporal dimension column already carries, by the same rule the dataset door applies (`measureResultType`).
  
  **What an author sees now.** `400 INVALID_FIELD`, naming the measure as the request wrote it, the cube, the column, the object and its declared type, saying the query was not run, and naming the types the aggregate accepts, read off `AGGREGATE_FIELD_TYPE_COMPATIBILITY`. The thrown error carries `member`, `param` (`measures`), `cube`, `field` and `object`.
  
  **Why a refusal.** The dataset door (`POST /api/v1/analytics/dataset/query`) refuses every one of these pairs at compile by the same table (`DATASET_INVALID`), and the engine's aggregate door refuses most of them on the ObjectQL strategy; the native-SQL strategy compiled its own statement and asked nothing. Measured through the real dispatcher route on SQLite and PostgreSQL 16: a configured cube's `max` over a `text` column answered `"y"` under a column described `number` on the native strategy and `400` on the ObjectQL strategy, and `sum` over the same column answered `0` on SQLite and `500` on PostgreSQL. One cube, one query, an answer chosen by the driver.
  
  **What to write instead.** Aggregate a field of a type the aggregate accepts. A question that was counting in disguise is `count` (or `count_distinct` over a scalar-stored field). A first or last record by a text value is a sort on a list, not an aggregate. A quantity stored as text belongs in a numeric field of its own, aggregated there.
  
  **Who is affected.** A dashboard, report or caller that asked `min` / `max` / `sum` / `avg` of such a column through `/analytics/query` on the native-SQL strategy and read the answer as a real one. No example app and no shipped cube authors such a pair. A reader that branched on `fields[].type === 'number'` for a temporal `min` / `max` column now sees `time`.
  
  **Unchanged.** Every pair the table accepts, a `max` over a `boolean` column included (its column keeps `number`: the rule declines the boolean class); `count` over any column; `count_distinct`, which keeps its own door and words; a measure over a relationship path (`account.name`), which this door does not judge; a column the host's field metadata cannot resolve, or a type outside `FieldType`; a measure whose `sql` is `*`; an expression metric type (`number` / `string` / `boolean`); and a host that wires no `sourceFieldMeta`, where the declaration cannot be read. The dataset door keeps its own `DATASET_INVALID` answer at compile.
- cb45469: fix(service-analytics)!: the analytics native-SQL strategy declines an object an engine middleware is registered for, so the engine serves it and that object's read gates apply; the engine answers which objects carry one (`IObjectQLEngine.hasObjectMiddleware`) (#21080)
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a correction of which analytics strategy serves a query that reads an object the data engine holds a per-object middleware for, decided at request time. No authorable key, spelling, value domain or stored metadata shape moves: every dataset, cube and dashboard parses as before, nothing stored is rewritten, and the only declaration change is ADDITIVE (one optional member on IObjectQLEngine, one public method on ObjectQL, one optional member on AnalyticsServiceConfig), so there is nothing for an author to convert and nothing for `objectstack migrate meta` to reach. The queries newly refused are refused at request time by the ObjectQL strategy's existing envelope, not by a schema. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers strategy routing and this diff adds none (not registered / already-registered); and the change is runtime behaviour plus additive declarations, not a removal from a published interface (not runtime-interface-only / type-surface-only). -->
  
  **BREAKING**: this narrows what the analytics doors serve for one class of query. It ships as `minor` under the launch-window convention for narrowings.
  
  **What changes.** On a SQL driver, `NativeSQLStrategy` compiled a query to SQL and ran it through the driver's raw-SQL seam, so no engine operation ran and no engine middleware did. It applied the security service's object admission and read filter and nothing else, so the read gates that live in the engine as per-object middlewares did not apply there: a caller admitted to such an object at object level read grouped results and counts over every row, rows about parent records that caller cannot read included. It now declines a query that reads (as its base object, a declared join, or through a relationship path) an object the data engine holds a middleware registered for. The ObjectQL strategy serves it through the engine with the caller's context, so the engine's middlewares run, and the analytics answer for that caller equals the data door's. On the stock composition the objects that move off the native path are `sys_comment`, `sys_activity` and `sys_attachment` (read gates), `sys_approval_request` (the snapshot redaction), and `sys_user_position` and `sys_permission_set` (write-side middlewares, which move as a side effect: a middleware does not declare its operation). No shipped dataset or dashboard reads any of them.
  
  **What is newly refused.** A query on such an object that the ObjectQL strategy cannot serve is refused with that strategy's existing `400`, where the native strategy used to serve it: for example a dimension reached through a relationship path combined with a measure that cannot be recombined across it (`avg`, `count_distinct`). Correctness wins over the fast path for a gated object.
  
  **It fails closed.** `AnalyticsServicePlugin` asks the data engine. An engine without `hasObjectMiddleware`, or no engine, cannot say, and the strategy declines then too: every query on such a host is served by the ObjectQL strategy, and the plugin says so once at `warn`. A host that constructs `AnalyticsService` with `executeRawSql` and without the new `hasObjectMiddleware` config member keeps the native path for every object and is told so once at construction.
  
  **New, additive.** `IObjectQLEngine.hasObjectMiddleware?(objectName): boolean` (`@objectstack/spec`), `ObjectQL.hasObjectMiddleware(objectName)` (`@objectstack/objectql`): whether a `registerMiddleware(fn, { object })` names the object; a global registration (no `object`, or `'*'`) is keyed to none and is not counted. `AnalyticsServiceConfig.hasObjectMiddleware` (`@objectstack/service-analytics`), which the plugin fills from the data engine.
  
  **Unchanged.** Objects no middleware names keep the native path. The middleware chain, `registerMiddleware` and every gate are unchanged.
  
  **What to do after upgrading.** Nothing on the stock composition. A host whose `"data"` service is not ObjectQL should implement `hasObjectMiddleware` to keep the native path for ungated objects. A host that builds `AnalyticsService` itself with `executeRawSql` should pass `hasObjectMiddleware` from its engine.
- 336e191: fix(security)!: stored metadata bodies are projected or refused at the audit, analytics, realtime and data-door filter/sort exits too
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) further read/copy/evaluate exits for a stored metadata body (sys_metadata / sys_metadata_history), each routed through the one shared redactor or refused: the audit/activity write-time copy is projected, a data-door filter or sort on the body column is refused (the sibling of the already-registered-as-not-required groupBy refusal), an analytics query member on the body column is refused, and a data.record.* realtime event body is projected. No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer; the published surfaces gain and lose nothing. The other categories are closed on facts: the packages publish (not `unpublished`); no ADR-0087 id covers a filter/sort target, an analytics member or an event body (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what three doors accept or serve for the two stored-metadata tables — the generic data door refuses a filter or sort on the body column, the analytics door refuses it as a dimension / measure / filter / sort member, and the realtime event and the audit/activity copy now carry the body as its type's read projection instead of the stored bytes. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **What changes.**
  
  - **Audit / activity copy (`@objectstack/plugin-audit`).** The audit writer copies a `sys_metadata` / `sys_metadata_history` row into `sys_audit_log.new_value` / `old_value` and `sys_activity.metadata`. That copy now projects the body through the shared redactor, so stored credential material is withheld from the second store too. A new `os migrate audit-metadata-bodies` command rewrites the copies already at rest (dry run by default, `--apply` to write, idempotent).
  - **Analytics (`@objectstack/service-analytics`).** A query naming the stored body column of these objects as a dimension, measure, filter or sort is refused with `400 INVALID_FIELD`, before any strategy runs — the posture analytics already takes for a member it will not evaluate.
  - **Realtime (`@objectstack/objectql`).** A `data.record.*` event projects its `after` / `changes` body through the same redactor, so a subscriber to these objects' events receives no stored credential.
  - **Data door filter / sort (`@objectstack/metadata-protocol`).** A filter or sort on the body column is refused with `400 INVALID_FIELD`, the same family and shape as the existing groupBy refusal.
  
  **What stays answerable.** Every scalar column of these objects — `type`, `name`, `scope`, `state`, timestamps — is still grouped, filtered, sorted, counted and served; only the body column is affected. Every other object is unchanged.
- 3a7b6eb: fix(service-analytics)!: a cube measure whose `sql` is a relationship path (`account.name`) is judged by the aggregate × field-type table, described in `fields[]` and presented on the native-SQL strategy by the declaration on the object the path's last hop reaches, as a measure over the cube's own column already was
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered dataset-measure-selecting-aggregate-field-type-refused, dataset-measure-aggregate-field-type-refused) the pairs this change refuses are exactly the pairs AGGREGATE_FIELD_TYPE_COMPATIBILITY already refuses, and the table is not edited: every refused min / max pair is registered under protocol major 18 by the first id and every refused sum / avg pair by the second, each with its routes. This change makes the cube door read a relationship-path column's declaration on the object the path reaches, where it already read a base-object column's; it refuses a query shape, not a stored one, and no authorable key, export or stored row moves. -->
  
  **BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept on the native-SQL strategy, on every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  The column a relationship path names is located by the one hop resolver both strategies join and read it through: the cube's declared join at that path, else the relationship field's declared `reference`.
  
  FROM → TO, for a `measures` entry that resolves to a cube measure over a relationship path (an authored cube measure, or a compiled dataset's measure over an `include`d relationship):
  
  - `min` / `max` / `sum` / `avg` over a related field of a type the table refuses for that aggregate (the string family such as `text`, `select`, `lookup`; the JSON-stored, file and `formula` types; and the rest the table lists): FROM, on the native-SQL strategy, `200` with the related column's own value (a string such as `"zeta"`) under `fields[] { type: 'number' }` on SQLite and PostgreSQL, and for `sum` a plausible `0` on SQLite and `500 DATABASE_ERROR` on PostgreSQL; the ObjectQL strategy refused it as a cross-object measure. TO `400 INVALID_FIELD` on both strategies, before either reads anything — the refusal a base-object column of the same type already got.
  - `min` / `max` over a related numeric field on PostgreSQL: FROM the exact-decimal string (`"250.000000000000000000000000000000"`) under `fields[] number`. TO the number `250`.
  - `min` / `max` over a related `date`, `datetime` or `time` field: FROM `fields[] { type: 'number' }` beside the instant. TO `fields[] { type: 'time' }`.
  
  **What an author sees now.** `400 INVALID_FIELD`, naming the measure as the request wrote it, the cube, the path, the related object and the type it declares, saying the query was not run, and naming the types the aggregate accepts. The thrown error carries `member`, `param` (`measures`), `cube`, `field` (the path, `account.name`) and `object` (the related object that declares the column).
  
  **What to write instead.** Aggregate a related field of a type the aggregate accepts, or `count` the rows. A first or last related record by a text value is a sort on a list, not an aggregate.
  
  **Who is affected.** A dashboard, report or caller that asked `min` / `max` / `sum` / `avg` of such a related column through the native-SQL strategy and read the answer as a real one. No example app and no shipped cube or dataset authors such a pair. A dataset whose measure aggregates such a related field is now refused when its query runs (`INVALID_FIELD`), where its compile check, which reads the base object's declaration, still lets it through.
  
  **Unchanged.** Every pair the table accepts; a measure over the cube's own column; `count`, and `count_distinct`, which keeps its own door; a related column the host's field metadata cannot describe; an expression `sql` or `*`; a host that wires no `sourceFieldMeta`; and the ObjectQL strategy's refusal of a related-field measure the table accepts (`max` over a related `number`), a capability limit of the engine aggregate — run that query on a native-SQL driver.
- ce4e205: fix(service-analytics)!: a dataset's own `field` text that is not a column reference is refused at the analytics dataset door, inline or saved
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a dataset's own dimension or measure `field` text that is not a column reference (a field, a relationship path ending in one, or `*`) is refused at the analytics dataset door — whichever branch supplied the dataset, an inline `body.dataset` or a saved `body.datasetName` — before the dataset is compiled and before any strategy runs, for every caller and whether or not a security service is wired, through the field-read gate's existing judge and envelope (`PERMISSION_DENIED` / 403). No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer; the published surface gains and loses nothing. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a dataset `field` (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). A dataset names a column instead of writing an expression, which is ADR-0021's author surface already ("zero raw expressions"), so there is no FROM → TO mapping to carry. -->
  
  **BREAKING**: this narrows what the analytics dataset door accepts. A dataset whose dimension or measure `field` is not a column reference is now refused with `403 PERMISSION_DENIED` instead of being evaluated — an inline dataset and a saved dataset queried by name alike, since both reach the same door. No shipped dataset carries a non-column `field`. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  **What changes.** The service compiles a dataset into a cube whose members read as declared, so a dimension or measure whose `field` was a raw expression resolved to a declared cube member and was left to the field-level read gate, which stands down where no field reader is wired (a host that constructs `AnalyticsService` without one) and on an object its reader answers `undefined` for; in those tiers the expression reached the native statement as written. (A deployment with no security service is not such a tier: the in-repo kernels throw on a `security` service nothing ever registered, so its analytics queries are refused, fail-closed.) The dataset's own `field` text is now judged at the dataset door, before compile and before any strategy runs, through the field-read gate's existing judge (`PERMISSION_DENIED` / 403, naming the member and never the expression text), for every caller, admin included, and with or without a security service. There is no new error code and no new admission module.
  
  **What stays answerable.** Every dataset whose fields are columns or relationship paths is unchanged, inline or saved. A saved dataset whose `field` is an expression is refused the same way as an inline one; refusing such a `field` when it is authored belongs to the dataset schema's own retirement of expression fields, not to this door. The dataset's own filter, the selection's runtime filter and cube-query members are lowered into the compiled query and already judged on the query path, so they are unchanged.
  
  *Erratum, 2026-10-08 — this entry said the field-level read gate "stands down with no security service". The sentence was false when published: in the published 17.6.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, and the analytics bridges answer that throw by refusing the query, fail-closed. One passage above is corrected in place; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 4727fcb: fix(service-analytics)!: a grouped dimension or a `count_distinct` measure over a JSON-stored column reached through a relationship path the cube declares no join for is refused with `INVALID_FIELD` / 400 at the analytics door, as the same member over a declared join already was
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a refusal of a grouping or distinct-count TARGET at the analytics door, extended from a relationship path the cube declares a join for to one it does not: the door now locates the column on the object the one hop resolver names (the declared join, else the relationship field's declared reference), the object both strategies already join and read. No authorable key, spelling, export or stored shape moves (`assertNoStructuredJsonDimension` is internal to the package; `CubeSchema`, `DatasetSchema` and the analytics query body keep parsing every member), and no stored row is read or rewritten. The grouping and the distinct count had no shared meaning to preserve (one group or one distinct value per serialized document on SQLite, a 500 on PostgreSQL), and which scalar part a caller meant is not something a ledger entry can rewrite. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers an analytics grouping or distinct-count target, and this diff adds none (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: this narrows what `POST /api/v1/analytics/query` and its dry run `POST /api/v1/analytics/sql` accept, on both strategies and every driver. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  The column of a dotted path is now located by the one hop resolver both strategies join and read it through: the cube's declared join at that path, else the relationship field's declared `reference`, else the relationship's own name for a host that cannot answer. Before, the door read the cube's declared joins alone and stood down on a path the cube declares no join for. This reverses one clause of the earlier entries for this door in the same release, which listed such a path as unchanged.
  
  **Before and after**, measured on a configured cube over an object whose lookup the cube declares no join for — `owner`, declaring `reference` a person object — and a member over that lookup. An ad-hoc query's inferred cube declares no join at all, and a dotted dimension on it (`owner.prefs`) now gets the same refusal:
  
  - A `dimensions` entry, or a `timeDimensions` entry with a `granularity`, over a structured-JSON field (`owner.prefs`, `json`) or a multi-value field (`owner.labels`, `tags`; or a field declared `multiple: true`). Before, on the native-SQL strategy: `200` with one group per serialized value on SQLite and `500 DATABASE_ERROR` on PostgreSQL; the ObjectQL strategy answered `400 INVALID_FIELD` from the engine under its own position (`groupBy[1]`), a name the request never wrote. Now: `400 INVALID_FIELD` from this door on both strategies, before either reads anything.
  - A `count_distinct` measure over the same columns. Before, on the native-SQL strategy: `200` with a count of serialized values on SQLite and `500` on PostgreSQL; the ObjectQL strategy refused it as a cross-object measure. Now: the same `400 INVALID_FIELD` from this door.
  
  **What an author sees now.** The refusal the same member over a declared join already got: `400 INVALID_FIELD`, naming the member as the request wrote it, the cube, the path, the object the lookup declares as its target and the column's declared type, saying the query was not run, and naming the route. The thrown error carries `member`, `param` (`dimensions`, `timeDimensions` or `measures`), `cube`, `field` (the path, `owner.prefs`) and `object` (the target object).
  
  **What to write instead.** Group by, or count distinct, a related field that stores one scalar value. For a multi-value field, run a record query on the target object filtered by one member with `$contains`, one query per member.
  
  **Who is affected.** A dashboard, report or caller that grouped or counted distinct such a related column through a lookup the cube declares no join for, on SQLite, and read the serialized values as real groups or a real count. On PostgreSQL the same queries were already a 500. No example app and no shipped cube or dataset authors such a member.
  
  **Unchanged.** Every member over a declared join; a scalar related column (`owner.email`), which is served on both strategies; a related column whose object the host's field metadata does not describe; an expression `sql`; a host that wires no `sourceFieldMeta`; and a dataset dimension over an `include`d relationship, whose join the dataset compiler declares.

### Patch Changes

- 92fe081: **BREAKING** — the inner `name` on an analytics cube's measures and dimensions (`MetricSchema.name`, `DimensionSchema.name`) is now refused at parse: nothing ever read it. The record key a member is declared under IS its name — the analytics API publishes it as `<cube>.<key>` and a query names it that way. Delete the inner `name`; to rename a member, rename its key.
  
  Clause-②: no (narrowing)
  
  `measures` and `dimensions` are records, and the key was always the member's identity: `GET /api/v1/analytics/meta` publishes every member as `${cube.name}.${key}` (in `@objectstack/service-analytics` and in `@objectstack/driver-memory`), and both SQL strategies and the in-memory driver resolve a member by indexing the bag with that key. Measured before removal, with a lit control: zero reads of a member's inner `name` in non-test source, against four reads of the neighbouring `measure.label` / `dimension.label` in the same two `getMeta` projections. So the inner `name` was a REQUIRED second copy of the identity that nothing read — and one that disagreed with its key was silently ignored (this repository's own in-memory driver fixtures authored `totalAmount: { name: 'total_amount', … }` and queried `orders.totalAmount`).
  
  **Removed rather than enforced** (ADR-0049 enforce-or-remove; the triage verdict on the card, by the maintainer's criterion for declared-but-unenforced families): Cube.dev and LookML key a member by its declared name, with no second inner name that can disagree — and here the record key already delivered it.
  
  ## FROM → TO
  
  | you wrote (17.4 and earlier) | write instead |
  | --- | --- |
  | `measures: { total_amount: { name: 'total_amount', label: 'Total', type: 'sum', sql: 'amount' } }` | `measures: { total_amount: { label: 'Total', type: 'sum', sql: 'amount' } }` |
  | `dimensions: { status: { name: 'status', label: 'Status', type: 'string', sql: 'status' } }` | `dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } }` |
  | an inner `name` that DIFFERS from its key, e.g. `totalAmount: { name: 'total_amount', … }` | nothing changes at runtime — `orders.totalAmount` was already the name every query used. Delete the inner `name`, or, if `total_amount` is the name you meant, re-key the member and update every query, dashboard and report that names `orders.totalAmount` |
  
  **The one-line fix:** delete `name` from every metric and dimension; the key it is declared under is its name.
  
  **What an author who still writes it sees.** `tsc` fails at the authoring site (`Metric` / `Dimension` type the key `never`), and the parse — `defineCube()`, `defineStack({ analyticsCubes })`, `PUT /api/v1/meta/analytics_cube/:name` — refuses it at `measures.<key>.name` / `dimensions.<key>.name` with the prescription:
  
  > `measures.<metric>.name` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — it never had an effect: the record key is the metric's name. … Delete the key. To rename a metric, rename its key in `measures` — and every query, dashboard and report that names `<cube>.<key>`. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.
  
  `os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.
  
  ## The retirement kit
  
  - **`retiredKey()` tombstones, not a bare deletion** — even though both member shapes are `strictObject`s (the `action.aria` posture). A bare delete would still be loud, but only as a generic unrecognized-key report that cannot carry the prescription; the tombstone types the key `never` for `tsc` and raises the upgrade text at parse. The keys therefore stay in the walked shape: both liveness rows stay `dead` with a `REMOVED` note, and the authorable-surface baseline marks `data/Metric:name` and `data/Dimension:name` `[RETIRED]`.
  - **The D2 conversion `cube-member-inner-name-removed`** (protocol 18, retired from the load path) deletes the inner `name` from every metric and dimension of every `analyticsCubes[]` entry. It is owed because the key was REQUIRED, so every stored or built cube carries it. It strips a disagreeing value too — the key already won everywhere, so no query or discovery answer changes — and its notice prints both spellings (`from: name "total_amount"`, `to: (removed; the record key "totalAmount" is the name)`). Its D3 record is the semantic entry `cube-member-inner-name-retired`, which asks the author of a disagreeing name which spelling they meant.
  - **The producers stop writing it** (`@objectstack/service-analytics`): the dataset compiler (`compileDataset`), `CubeRegistry.inferFromObject` and the ad-hoc query mint no longer put an inner `name` on the members of the cubes they build. The members are filed under the same keys as before, so `/analytics/meta`, `/analytics/query` and `/analytics/sql` answer exactly as they did. The package README's cube example is corrected.
  - **The `measures` / `dimensions` descriptions now say it**: "keyed by metric name: the record key IS the metric's name, published and queried as `<cube>.<key>`".
  
  ## Reach, measured
  
  - This repository, non-test: the showcase cube (`examples/app-showcase`, 8 members), the published `objectstack-ui` skill's `defineCube` example (6), the `service-analytics` README (3), and the three internal cube mints above — every one wrote the inner `name` EQUAL to its key, and all are corrected here. Test fixtures: about 300 member literals and map-built members across 84 test and fixture files in eight packages, all EQUAL to their key except 21 in `driver-memory`, which disagreed (camelCase key, snake_case inner name) and were already queried by key.
  - Out-of-repo authors: NOT MEASURED.
  
  ## What an operator with a STORED cube sees
  
  A `sys_metadata` `analytics_cube` row or a built artifact written before this release carries the inner `name` on every member. Nothing breaks at read: the conversion replays on rehydration and at the artifact door and strips it, so the cube is served canonical and parses. `os migrate meta --stored --apply` rewrites the rows.
  
  <!-- adr-0087: registered cube-member-inner-name-removed, cube-member-inner-name-retired -->
- f1e921a: feat(spec)!: `$empty` joins `FILTER_OPERATORS`, and the view operators `is_empty` / `is_not_empty` lower to it (#20446)
  
  A stored 「is empty」 / 「is not empty」 — `['field', 'is_empty', …]`, `isempty`, `is_not_empty`, `isnotempty`, in a view rule, a sharing rule or any filter array — now lowers to `{ field: { $empty: true | false } }` instead of `$null`. `$empty` is answered by the field's DECLARED type: a text-like field is empty when it is null or `''`, a multi-value field (multiselect, checkboxes, tags, or a select / radio / lookup / user / file / image with `multiple: true`) when it is null or `[]`, and every other type only when it is null. So an 「is empty」 rule on a text field now also finds `''`, and on a multi-value field also finds `[]`, which the `$null` lowering missed. `is_not_empty` is its exact complement. `$empty` is in `FILTER_OPERATORS` (and `ALL_OPERATORS`) now, and `canonicalAstOperator` folds the empty pair onto `is_empty` / `is_not_empty` rather than onto `is_null` / `is_not_null`. On `@objectstack/driver-memory`, a QueryAST comparison node (`{ type: 'comparison', operator: 'is_empty' }`) is answered by the same declared-type arm.
  
  **BREAKING**: two things accepted before are refused now, each loudly and with its fix.
  
  - **A `{ $empty: … }` object written as a field value** (a `where` pasted into an insert or update payload) is refused with `VALIDATION_FAILED` (`invalid_type`, "$empty is a filter operator, not a value"). Before, a text-like field stored it as data.
    FROM `update('task', { title: { $empty: true } })` → TO write the value itself (`{ title: '' }`, `{ title: null }`); a filter belongs in `where`.
  - **`is_empty` / `is_not_empty` where no face holds the column's declared type** is refused with `INVALID_FILTER` / 400 (`READ_SCOPE_COMPILE_FAILED` / 500 on an analytics read scope). The `$null` lowering answered these. The compositions:
    - the built-in `id`, which no object declares. FROM `['id', 'is_empty', true]` → TO `['id', 'is_null', true]` / `is_not_null`;
    - a federated (external) object on a driver that does not implement `registerExternalObject` (driver-memory, driver-mongodb). The boot already reports such an object as NOT bound to its remote table, naming it, and its reads answered from a table named after the object. FROM `is_empty` on such an object → TO bind it on a driver that implements federation (driver-sql and its heirs, driver-turso);
    - an `AnalyticsService` constructed without `sourceFieldMeta`. FROM such a host → TO pass `sourceFieldMeta` (the package README shows it), or filter with `is_null` / `is_not_null`;
    - a multi-value column on a SQL dialect `driver-sql` does not model (a knex client other than SQLite, PostgreSQL or MySQL). FROM `['tags', 'is_empty', true]` there → TO `['tags', 'is_null', true]` / `is_not_null`.
  
  Stored sharing rules and views that use 「is empty」 are not rewritten; they are re-read under the new meaning. Production rules that use 「is empty」 on a text or multi-value field were not measured; each finds more rows (the `''` / `[]` ones) from this release.
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered filter-is-empty-lowers-to-empty-operator -->
- b785c3b: fix: `sum` / `avg` answer the same double on every face the platform owns, added with one compensated fold that `@objectstack/core` now exports as `compensatedSum` (#20544)
  
  Clause-②: yes
  
  **New export.** `@objectstack/core` exports `compensatedSum(nums)`: the sum of
  `nums`, added in order with Kahan-Babuska-Neumaier compensation, which is the
  summation SQLite (3.43 and later) uses for its own `sum` and `avg`. It moved
  here from `@objectstack/objectql`'s rows path (`in-memory-aggregation.ts`),
  which now imports it instead of keeping a private copy.
  
  **What changed.** Three folds still added a group's values naively, and now call
  the same function:
  
  - `@objectstack/driver-memory`'s `aggregate()` and `find()` with aggregations,
    the path `engine.aggregate` takes on an in-memory datasource;
  - `@objectstack/driver-memory`'s analytics face (`MemoryAnalyticsService`),
    whose `sum` / `avg` measures are now a `$group` `$accumulator` in place of
    mingo's `$sum` / `$avg`;
  - `@objectstack/service-analytics`' draft preview.
  
  Over a `number` column holding `0.1`, `0.2` and `0.3`, each of them answered
  `0.6000000000000001` / `0.20000000000000004`. They now answer `0.6` /
  `0.19999999999999998`, as SQLite and the engine's rows path do. Over
  `1e16, 1, -1e16` they answered `0` and now answer `1`. On driver-memory,
  `engine.aggregate` gave two answers depending on its path: `having { s: { $eq:
  0.6 } }` kept the group on the rows path and dropped it on the native path. It
  now keeps it on both.
  
  **What did not move.** Two addends, integers whose running total stays within
  2^53, and a non-finite total give the same answer as before. Which values count
  as addends did not change either: booleans as 1 / 0, and nulls and non-numeric
  strings left out, as each face already had it. `count`, `min` and `max` are
  untouched. The analytics face's pipeline dump (`result.sql`) now renders the
  accumulator's functions by name, so a `sum` measure and an `avg` measure still
  dump differently.
  
  **Residual.** PostgreSQL and MySQL add their doubles natively without
  compensation, and the platform does not wrap that arithmetic. So over three or
  more fractions their native path can still differ from these faces in the last
  place. An exact `$eq` on a fractional sum compares doubles; compare with a range.
- d282087: Provenance comments in `service-analytics` were re-anchored
  
  Comment and docblock lines under `src/` that cited tracker numbers which no
  longer resolve on GitHub now cite the commit in this repository's history that
  decided the matter, and say in their own words what was decided. Comments
  only: no type, schema, export, log or refusal text, or runtime behaviour changes.
- a6866da: fix(core): a date or time in the years 0001..0099 is read as written, not as 1900..1999, wherever a UTC instant is built from year / month / day / time parts
  
  `Date.UTC(year, …)` and `new Date(year, …)` read a year from 0 to 99 as 1900 + year. Core built its instants from parts that way, so every day of the years 0001..0099 (inside the supported range 0001..9999) landed in the 1900s at the sites below, with no error.
  
  - `@objectstack/core`: **new export** `wallClockToUtcMs(parts)`, the epoch milliseconds of a `WallClockParts` read as UTC. It is `Date.UTC` without the two-digit-year remap: `month` is 1-12, omitted time components are 0, and every component rolls over past its end as `Date.UTC` rolls it (`month: 13` is next January, `day: 0` the previous month's last day, `hour: 24` the next midnight). A `NaN` component gives `NaN`. Every site below now builds through it:
    - `zonedWallClockToUtcMs` and `zonedDateStartToUtcMs`, the wall clock and the zone-offset read. The offset read also takes the zone's era, so a wall clock early on 0001-01-01 in a zone west of UTC, whose offset probe lands in year 0, reads right.
    - `bucketKeyToCalendarRange` (`0050` spans 0050-01-01..0051-01-01, not 1950..1951; `0050-01-01` as a `day` key is no longer `null`) and `bucketDateKey`'s ISO week (0050-01-01 is in week 52 of 0049, not of 1949).
    - The date macros: `{1976_years_ago}` resolves to `0050-09-30`, not `1950-09-30`. A macro that lands in 0001..0999 is now spelled with a four-digit year, as the `date` storage form spells it (`0055-06-15`, not `55-06-15`, which names no day).
  - `@objectstack/service-analytics`: the preview evaluator's `week` key and the `compareTo` bucket alignment build their days through `wallClockToUtcMs`.
  - `@objectstack/trigger-schedule`: a time-relative window's day bounds build through `wallClockToUtcMs`.
  
  What an author sees: `POST /api/v1/data/:object/import` stores the `datetime` cell `0050-01-01 10:00` as `0050-01-01T10:00:00.000Z`, and in `Asia/Shanghai` as `0050-01-01T01:54:17.000Z` (the zone's local mean time for that year). Before, it stored `1950-01-01T10:00:00.000Z` and `1950-01-01T02:00:00.000Z` and reported the row `ok`. Measured through the import route and read back through `POST /api/v1/data/:object/query` on SQLite and PostgreSQL 16; the `2026-07-15 10:00` control is stored the same before and after. Every year from 0100 on builds exactly as before.
- 1a75e39: fix(spec,drivers): a `datetime` filter `$lte '9999-12-31'`, or a `$between` whose maximum is that day, includes the whole last supported day on every backend (#20600)
  
  Clause-②: yes (widening) — three new exports on `@objectstack/spec` (`data`) and `@objectstack/core`: the constant `UNBOUNDED_ABOVE`, its type `UnboundedAbove` and the guard `isUnboundedAbove`; `nextUtcCalendarDay` answers the constant for one input that used to answer a string. Nothing any door accepted before is refused, and nothing is removed or renamed.
  
  **BREAKING for TypeScript and JavaScript callers of `nextUtcCalendarDay`** (`@objectstack/spec/data`, re-exported by `@objectstack/core`): its return type gains a member and its answer for one input changes from a string to a symbol, landing in the launch window as `minor` (the lockstep convention: the bump level is not the carrier, this banner and the disposition below are). No filter an author writes and no stored row changes meaning except that a whole-day upper bound on `9999-12-31` now includes that day.
  
  `9999-12-31` is the last day of the supported years (0001..9999). A bare-day upper bound on a `datetime` field — `$lte`, a `$between` maximum, an analytics `dateRange` end — means that whole day, and is compiled as "before the next day's midnight". That day has no next day with a `YYYY-MM-DD` spelling: `nextUtcCalendarDay('9999-12-31')` answered the five-digit `'10000-01-01'`, which sorts below `'2026-…'` as text. So on SQLite, where a `datetime` column is ISO text, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered no rows; PostgreSQL parsed the bound as an instant and answered them. The memory and mongo drivers, the analytics strategies and the draft preview built their bound from the same answer, and `formula`'s RLS `check` evaluator compared a `'2026-…'` value against it and denied the write.
  
  Every supported value is at most the last millisecond of `9999-12-31`, so that day's whole-day bound bounds nothing. `nextUtcCalendarDay('9999-12-31')` now answers `UNBOUNDED_ABOVE`, a symbol that is neither `null` ("not a calendar day", which would compile the day's midnight and miss the rest of it) nor a string, and every backend compiles no upper bound for it:
  
  - `$lte` / `<=` on that day asks only that the value is not null: `IS NOT NULL` on the SQL drivers and the analytics echo, `$ne: null` on the memory and mongo drivers.
  - A `$between` / `between` whose maximum is that day, and an explicit analytics `dateRange` ending on it, keep only their minimum.
  - The type-blind `formula` `check` evaluator and the draft preview admit every value that denotes an instant, and compare any other value as written.
  - `$gte`, `$gt`, `$lt` and `$eq` on that day are unchanged: they anchor to its midnight, as on every other day. `9999-12-30` and every earlier day compile the same bound as before.
  
  Measured through `POST /api/v1/data/:object/query`, rows at `2026-07-15T14:00Z`, `9999-12-30T10:00Z`, `9999-12-31T00:00Z`, `T10:00Z` and `T23:59:59.999Z`: on SQLite, `$lte '9999-12-31'` and `$between ['2026-01-01', '9999-12-31']` answered none of them and now answer all five; `$between ['9999-12-31', '9999-12-31']` answered none and now answers the three on that day. PostgreSQL 16 answers the same before and after. `$lte '9999-12-30'` answers the first two rows on both, before and after.
  
  **If your code stops compiling.** `nextUtcCalendarDay` now returns `string | UnboundedAbove | null`, where `UnboundedAbove` is a `symbol` with a structural brand. TypeScript refuses that member in a template literal (TS2731), a relational comparison (TS2469) and a `string` parameter (TS2345), so code that used the answer as a day string no longer compiles until it handles the last day. Test the answer with `isUnboundedAbove(answer)` (or `typeof answer === 'symbol'`) first: on its false branch the answer is `string | null` as before, and on its true branch there is no upper bound to compile. `answer === UNBOUNDED_ABOVE` compares correctly but does not narrow, because the branded type is not a unit type. The type is structural on purpose: `@objectstack/spec` ships `./data` as `index.d.mts` and `index.d.ts`, and a `unique symbol` would be two unrelated types in a program that meets both.
  
  **If your JavaScript code handled the answer as text.** For `'9999-12-31'` it is now a registered symbol (`Symbol.for('objectstack.calendarDay.unboundedAbove')`), not `'10000-01-01'`: a template literal or a relational comparison on it throws a `TypeError`, and better-sqlite3 and `pg` refuse to bind it. Every other input answers exactly as before.
  
  The shared temporal conformance kit (`TEMPORAL_ROWS` / `TEMPORAL_CASES` in `@objectstack/spec/data`) gains the row `z_last` (`9999-12-31T10:00:00.000Z`) and five last-day cases, so every backend it drives is held to this answer; three existing `$gte` / `$gt` cases now also expect `z_last`.
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing an author writes moves — no spec key, no stored row and no accept set changes, so `objectstack migrate meta` has nothing to reach — and what moves is one published function's return type and its answer for one input, whose channel is the caller's compiler and the banner above. -->
- 10c36cc: fix(service-analytics): every dataset answer names its base object as `object` (#20644)
  
  Clause-②: no
  
  **What was wrong.** `queryDataset` set `object`, the dataset's base object, only
  while it built drill-through metadata, which it builds only when a drillable
  dimension is selected and at least one row came back. A dimension-less (KPI)
  answer, a zero-row answer and the degraded answer for an unavailable backing
  object carried no `object`, and neither did a draft preview (`previewDrafts`),
  grouped or not. `POST /api/v1/analytics/dataset/query` relays the service answer
  as it is, so a consumer that refreshes on that object's record changes had
  nothing to subscribe to for those answers.
  
  **What changed.** Every `queryDataset` answer carries `object`, the dataset's
  `object` by machine name, whatever dimensions are selected and whether or not
  rows came back, as `AnalyticsResult.object` in `@objectstack/spec` declares. A
  grouped answer is unchanged: `object` sits beside the same drill-through keys
  as before. A cube `query` answer still carries no `object`.
- 856321f: A date-bucket key spells its year with four digits at every granularity, as the SQL drivers' bucket expressions do, so the in-memory and pushed-down paths key a day in 0001..0999 alike and a drill-down from such a key finds its range.
  
  A `date` value names a year from 0001 to 9999, so these keys are reachable through a `date` field and through a stored `datetime` row. For 0050-06-15, `strftime('%Y-%m')` on SQLite and `to_char(…, 'YYYY-MM')` on PostgreSQL answer `0050-06`, while `bucketDateKey` answered `50-06`: the same `groupBy` keyed the same rows differently depending on which path ran it.
  
  - **`@objectstack/core` `bucketDateKey`** pads the year to four digits: `0050`, `0050-Q2`, `0050-06`, `0050-06-15`, and the ISO week key `0050-W24` (early January 0050 is `0049-W52`, its ISO week-year). The engine's in-memory `groupBy` and the memory cube face delegate to it, so both now answer the drivers' key. A year from 1000 to 9999 is spelled as before.
  - **`@objectstack/core` `bucketKeyToCalendarRange`** reads exactly what `bucketDateKey` writes. Its week arm checked a key against the unpadded label, so a padded key such as `0050-W01` answered `null`; it now answers `{ start: '0050-01-03', end: '0050-01-10' }`. An unpadded key (`50-06`, `49-W52`) is not a bucket key and still answers `null`.
  - **`@objectstack/service-analytics`** mints the `compareTo` alignment key through `bucketDateKey` instead of spelling it locally, so a comparison row in 0001..0999 merges onto its bucket (`0050-06`) instead of being appended under `50-06`.
- 975b248: fix(objectql,spec)!: a `groupBy` on a multi-value field and a `count_distinct` on a JSON-stored field are refused with `INVALID_FIELD` / 400 at the engine's `aggregate`, on every driver, and the aggregate × field-type table stops accepting `count_distinct` over the JSON-stored types
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the one metadata-facing half of this change is a row of AGGREGATE_FIELD_TYPE_COMPATIBILITY narrowing, and that family's hand-migration is already registered under protocol major 18 by this id: "an aggregate the field's type accepts, per AGGREGATE_FIELD_TYPE_COMPATIBILITY", with every refused pair of the table refused at the compile door. The non-temporal sum / avg narrowing rode the same id the same way; this diff amends that entry's surface and acceptance prose to name the count_distinct rider, and corrects the min / max entry's route that called count_distinct valid over every type. The engine-door halves refuse a query shape, not a stored one: no authorable key, export or stored row moves. -->
  
  **BREAKING** (`@objectstack/objectql`): this narrows what `aggregate` accepts, in two positions, on every driver and for every caller that reaches the engine (the REST query door, a flow or hook, and the analytics strategy that lowers a cube query onto `engine.aggregate`). Shipped as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.
  
  - A `groupBy` entry that names a **multi-value** field: an inherently-multi option type (`multiselect`, `checkboxes`, `tags`), or a `select`, `lookup`, `user`, `file` or `image` field declared `multiple: true`. Both entry spellings are judged, the field name and the `{ field }` object.
  - A `count_distinct` aggregation over a **JSON-stored** field: a structured-JSON type (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), an inherently-multi option type, or a multi-capable field declared `multiple: true`.
  
  **BREAKING** (`@objectstack/spec`): `AGGREGATE_FIELD_TYPE_COMPATIBILITY.count_distinct` no longer lists the ten JSON-stored types (the structured-JSON seven and `multiselect`, `checkboxes`, `tags`), so `isAggregateCompatibleWithFieldType('count_distinct', type)` answers `false` for them. Every reader of the table refuses those pairs now: the dataset-measure lint rule (`measure-aggregate-field-type-refused`, run by `os validate` and at a runtime dataset save), the analytics dataset compile leg (`400 DATASET_INVALID`), and the engine door above. The `count` row is unchanged.
  
  **What an author sees now.** `400 INVALID_FIELD`, naming the position (`groupBy[0]`, `groupBy[0].field`, or `aggregations[0].field`), the field and its declaration, saying the query was not run, and naming the route inside the first 500 characters the REST door keeps. For a multi-value field the route is to filter by one member: `where` with `$contains` on the field, one query per member. For a structured-JSON field it is to store the part you count in a field of its own, or to count rows with `count`. The thrown error carries `field`, `fields`, `object` and `param` (`groupBy` or `aggregations`).
  
  **Why a refusal.** Every SQL driver stores these values in a JSON column, and the drivers share no meaning for one as a group key or a distinct key. Measured through `POST /api/v1/data/:object/query` over three rows: grouping by any of the eight multi-value declarations answered one group per array on the in-memory driver, one group per serialized array on SQLite, and 500 `DATABASE_ERROR` on PostgreSQL 16. `count_distinct` over any structured-JSON or multi-value field answered 3 on the in-memory driver (equal values counted apart), 2 on SQLite (serialized text compared), and 500 on PostgreSQL (no equality operator for `json`). No example app and no published stack groups by a multi-value field or counts one distinct, so no meaning is defined for either here.
  
  **What to write instead.** A dataset measure or a query that counted a JSON-stored field distinct: use `count` over it, or store the scalar part you meant to count in a field of its own and `count_distinct` that field. A grouping by a multi-value field: filter by each member with `$contains` and count.
  
  **Who is affected.** A caller that grouped by a multi-value field, or counted a JSON-stored field distinct, on the in-memory driver or on SQLite and read the answer as a real one; on PostgreSQL both were already a 500. A dataset whose measure pairs `count_distinct` with a JSON-stored field is refused by the lint rule and the compile leg.
  
  **Unchanged.** (Two shapes the structured-JSON `groupBy` entry of this same release lists as unchanged are narrowed here: a `multiple: true` select as a group key, and `count_distinct` over a structured-JSON field. This entry is the later word on both.) A `groupBy` or `count_distinct` on a scalar-stored field, a single-value `select` or `lookup` included; `count` over any field; the `having`, filter and sort positions; and an undeclared name, which the REST door answers `INVALID_FIELD` as unknown before the engine is reached.
  
  `@objectstack/lint`: the dataset-measure refusal's hint no longer says `count_distinct` accepts every type.
  
  `@objectstack/service-analytics`: the dataset compile leg's refusal of a `count_distinct` measure over a JSON-stored field says why it diverges (the drivers compare the values for equality three ways) and prescribes `count`, or a scalar field for the part being counted; its other refusals no longer say `count_distinct` accepts every type.
- 525b813: A dataset's date dimension reads the bucket key `@objectstack/core`'s `bucketDateKey` writes, with its year in four digits, and a draft preview keys a row the way the same dataset does once published.
  
  - **Dimension labels (`queryDataset`).** A date dimension's grouped key is labelled as written. The year key `0050` was labelled `1970` (read as epoch seconds, because the year check admitted only 1000..9999), and a month or day key lost its padding (`0050-06` became `50-06`, `0050-06-15` became `50-06-15`). A raw date value is relabelled with the year in four digits too. A year from 1000 to 9999 is labelled as before.
  - **Draft preview (`queryDataset` with `previewDrafts`).** Drafted seed rows are keyed by `bucketDateKey` itself, the key the published path's grouping writes. For 0050-06-15 the preview answered `50`, `50-Q2`, `50-06` and `50-06-15`; it now answers `0050`, `0050-Q2`, `0050-06` and `0050-06-15`. A `week` bucket is now the ISO week label (`2026-W25`), no longer the Monday's date (`2026-06-15`), so a weekly `compareTo` in the preview merges each comparison row onto its week, as the published path does. An epoch-milliseconds value is bucketed by its instant (it was the empty bucket), and a `Date` in 0001..0999 by its own year (a `Date` in 0050 keyed `1950`).
- d1633f3: fix: the analytics native-SQL path answers a measure its response declares `number` as a number on every dialect, presented by the one rule `driver-sql`'s `aggregate()` applies, which `@objectstack/core` now exports as `AGGREGATE_ANSWER_KIND` and `presentAsNumber` (#20889)
  
  Clause-②: yes (widening)
  
  **New exports.** `@objectstack/core` exports two names, moved here unchanged
  from `@objectstack/driver-sql`, which now imports them instead of keeping them
  private:
  
  - `AGGREGATE_ANSWER_KIND`: what each declared aggregate function answers.
    `count`, `count_distinct`, `sum` and `avg` answer `'number'`; `min` and `max`
    answer `'column'`, a value of the aggregated column.
  - `presentAsNumber(value)`: the `'number'` presentation. A string `Number()`
    reads as a number becomes that number. Any other value is returned as given:
    a number, `null`, a boolean, empty or blank text, or text that reads as NaN.
  
  **What changed.** On PostgreSQL, `POST /api/v1/analytics/query` and
  `POST /api/v1/analytics/dataset/query` answered through `NativeSQLStrategy`
  returned count, count_distinct, sum, avg, and min / max over a numeric column
  as strings, such as `count: "2"` and
  `sum: "500.000000000000000000000000000000"`, while `fields[]` declared
  `number`. A dataset's `row_count` did the same, and a measure-scoped count
  mixed `"1"` with the number `0` in one column. SQLite answered numbers. The
  strategy now presents each measure column by its declared aggregate function,
  through the same table and presenter as `SqlDriver.aggregate()`. `min` / `max`
  are presented only when their column is declared numeric, so `max` over a text
  column, every dimension, and expression measures keep the value the database
  returned.
  
  **Precision.** The answer is one JS number, the policy `driver-sql`'s
  `aggregate()` already applies. A total that needs more digits than a double
  holds, such as `9007199254740993`, answers the nearest double
  (`9007199254740992`), which is also what SQLite and the engine path answer.
  
  **What did not move.** `@objectstack/driver-sql`'s behaviour is unchanged: its
  `aggregate()` reads the same table, and its read presenter calls the same
  function. The answers on SQLite are byte-identical. The arithmetic of the
  analytics native statement did not change either. On PostgreSQL its `sum` and
  `avg` still add exact decimals, so `0.1 + 0.2` answers `0.3` where the engine
  path answers `0.30000000000000004`.
- 5d5e679: feat(spec)!: an analytics cube member's `sql` is a column reference — a SQL expression there is refused at parse, and a derived value is declared on an ADR-0021 dataset (#20943)
  
  Clause-②: yes (narrowing)
  
  **BREAKING** — shipped as `minor` under the launch-window convention
  (`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
  this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
  never by the level).
  
  `MetricSchema.sql` and `DimensionSchema.sql` — the `sql` of every member in an
  analytics cube's `measures` and `dimensions` — admit a column reference only: a
  field of the cube's object (`amount`), a relationship path of bare identifiers
  ending in one (`account.amount`, `account.owner.region`), or `'*'` for a count.
  Any other value — a `CASE WHEN …`, an aggregate or a ratio of aggregates, a quoted
  or `$`-prefixed spelling, an empty string — is refused at parse with a
  prescription. This is ADR-0021's "zero raw SQL / zero raw expressions" carried
  from the dataset layer to the cube members it compiles to (maintainer ruling D on
  the card): an expression names no single field, so no platform check can judge
  which fields it reads, and the two analytics strategies never agreed on it — the
  raw-SQL path ran it verbatim and the ObjectQL path refused it. The rule is a
  `pattern` in the published JSON Schema too, so a document validated against
  `json-schema/**` is judged as the parse judges it.
  
  ## FROM → TO
  
  A derived value moves to an ADR-0021 dataset over the same object. A conditional
  count or sum is a dataset measure with its own structured `filter`; a ratio, sum,
  difference or product of measures is `derived: { op, of: [...] }` over measures
  named in the same dataset.
  
  ```
  FROM  defineCube({ name: 'delivery', sql: 'task', measures: {
          done_rate: { label: 'Done Rate (%)', type: 'number',
                       sql: "SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)" },
        } })
        -> parsed; the expression ran verbatim on one strategy and was refused on the other
  TO    -> ZodError at measures.done_rate.sql (invalid_format): `measures.<metric>.sql` is a
           column reference: a field of the cube's object (`amount`), a relationship path ending
           in one (`account.amount`), or `'*'` for a count. A SQL expression there was retired …
  
        defineDataset({ name: 'task_metrics', label: 'Task Metrics', object: 'task',
          dimensions: [/* … */],
          measures: [
            { name: 'task_count', aggregate: 'count' },
            { name: 'done_count', aggregate: 'count', filter: { status: 'done' } },
            { name: 'done_rate', derived: { op: 'ratio', of: ['done_count', 'task_count'] }, format: '0.0%' },
          ] })
  ```
  
  **Mind the scale.** A `derived` ratio is a 0–1 fraction. An expression that
  multiplied by 100 returned percentage points; pair the ratio with a `%` numeral
  pattern (the server marks a ratio column's percent scale as a fraction) and
  re-check any consumer that read the old number raw.
  
  **A dimension that bucketed a column with a CASE expression** has no expression
  form in the cube layer or the dataset layer: group by the column itself, or keep
  the bucket as a field of the object and name that field.
  
  **The one-line fix:** parse each cube; every refusal at `…sql` is one member to
  move — replace it with the column it aggregates, or move the derived value to a
  dataset measure as above, and point the dashboards, reports and queries that named
  `<cube>.<member>` at the dataset measure.
  
  **What an author who still writes it sees.** `CubeSchema`, `defineCube()`,
  `defineStack({ analyticsCubes })` (`STACK_SCHEMA_INVALID` / 422) and the
  `analytics_cube` write door refuse the member at its `sql` path with the
  prescription. `tsc` does not: the key's type is still `string`.
  
  ## The retirement kit
  
  - **Schema.** `MetricSchema.sql` / `DimensionSchema.sql` carry the pattern and
    their prescriptions (`data/analytics.zod.ts`). A column reference parses
    byte-identically to before. The retired metric `filters` guidance and the
    analytics query's `filters` guidance no longer offer "fold the condition into
    the metric's own `sql` expression" as a live channel; the `metric-filters-removed`
    conversion summary and its D3 entry and step-18 rationale fragment say the same.
  - **ADR-0087.** The D3 entry `cube-member-sql-expression-retired`, with its
    step-18 rationale fragment. No D2 conversion — an expression has no mechanical
    rewrite into a dataset — and no `RETIRED_KEYS_BY_MAJOR` row: no key left the
    shape, so the authorable-surface, api-surface and JSON-schema manifest
    ratchets are unchanged.
  - **Liveness.** The `analytics_cube` ledger rows `measures.sql` and
    `dimensions.sql` stay `live`, re-verified, with the narrowing recorded.
  - **Docs.** The `data/analytics` reference page is regenerated.
  - **Example.** The showcase cube's `done_rate` expression member moves to the
    `showcase_task_metrics` dataset as `done_count` (a count filtered on
    `status: 'done'`) and `done_rate` (`ratio` over `done_count` and `task_count`,
    format `0.0%`).
  - **`@objectstack/service-analytics`** (README only): its query-body section no
    longer tells a reader to fold a per-metric condition into the metric's own
    `sql` expression. The runtime is unchanged: its expression branches remain for
    a cube that reaches the service without meeting the parse, and their deletion
    is a separate change.
  
  ## Reach, measured
  
  - This repository: one authored expression member (the showcase `done_rate`),
    moved here. Test fixtures in `@objectstack/service-analytics` that build
    expression members WITHOUT the parse keep exercising the runtime's expression
    branches, unchanged.
  - Out-of-repo authored cubes: NOT MEASURED.
  
  <!-- adr-0087: registered cube-member-sql-expression-retired -->
- ae1e950: fix(service-analytics): the analytics field-level read gate refuses a cube member whose `sql` names no field, instead of letting the query run (#20965)
  
  Clause-②: no
  
  **What changed.** Where the analytics field-level read gate judges a cube's
  object (a security service is registered and gives a field answer for that
  object), a query that names a cube member whose `sql` is neither a column
  reference (a field of the cube's object, or a relationship path ending in one)
  nor `'*'` is now refused `403 PERMISSION_DENIED` on
  `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql`, before either
  strategy runs. Whatever
  the caller may read, the member is refused. That covers an expression member
  of a cube that reached the service without the spec's parse (the cube
  registry never parses: `analyticsCubes` and `AnalyticsServicePlugin({ cubes })`
  arrive as written), a declared member with no `sql` string, and a member the
  query names itself that is not a column reference. The gate used to stand down
  on such a member, because it names no field, and the native-SQL strategy then
  compiled it into its statement as written: a read of fields no permission
  verdict was reached for. The refusal names the member and the object, and
  never the member's `sql`.
  
  **What is not affected.** A member that is a column reference is judged by the
  field it resolves to, as before. A `count` over `'*'` names no field and is
  served. A host that wires no field reader, and an object the security service
  gives no field answer for, apply no field-level check, as before. A deployment
  with no security service is refused outright: the in-repo kernels throw on a
  `security` service nothing ever registered, so its analytics queries are
  refused, fail-closed. The spec's parse already refuses an expression member, so
  a cube that parses is unaffected.
  
  **If a widget stopped answering,** its cube carries an expression member from
  before the parse refused one. Re-author the member as a column reference, or
  declare the derived value on an ADR-0021 dataset: a conditional count or sum
  is a dataset measure with its own `filter`, and a ratio of measures is
  `derived: { op: 'ratio', of: [...] }`.
  
  *Erratum, 2026-10-08 — this entry said "A deployment with no security service, and an object the security service gives no field answer for, apply no field-level check, as before." The sentence was false when published: in the published 17.6.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, and the analytics bridges answer that throw by refusing the query, fail-closed. One passage above is corrected in place; its half about an object the security service gives no field answer for stands, and everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 097ef80: fix: the analytics native-SQL path aggregates with the engine's own aggregate policies, so one query answers one number whichever strategy serves it: `sum` / `avg` accumulate in double, a PostgreSQL boolean aggregand is cast, and an all-NULL `sum` answers `0`. The operand policies move from `@objectstack/driver-sql` to `@objectstack/core` (#21042)
  
  Clause-②: yes (widening)
  
  **New exports.** `@objectstack/core` exports the aggregate operand policies, moved here from `@objectstack/driver-sql`, where they were module-private. The driver now imports them and emits byte-identical statements.
  
  - `AGGREGATE_ACCUMULATION`: what each declared aggregate function accumulates in on PostgreSQL and MySQL. `avg` accumulates in double; `sum` accumulates in double over a fractional column; the counts, `min` and `max` take the column as stored.
  - `aggregandColumnClass(shape)`: the one column-class predicate those policies read, over a column's declared `{ type, multiple }`. It answers `'fractional'`, `'integral'`, `'boolean'`, or `undefined` for every other column, a multi-valued one included. The type `AggregandColumnClass` names the three classes.
  - `POSTGRES_BOOLEAN_AGGREGAND_CAST`: the functions whose boolean aggregand is cast to `int` on PostgreSQL. These are `sum`, `avg`, `min` and `max`; the two counts are never cast.
  - `doubleAccumulationOperand(operand, dialect)`: the column's text, parsed as a double, spelled for `'postgres'` or `'mysql'`.
  - `aggregandOperandSql(func, columnClass, dialect, operand)`: the operand an aggregate wraps, with the cast inside the double operand. The type `AggregandSqlDialect` names its dialects (`'sqlite'`, `'postgres'`, `'mysql'`, `'unknown'`).
  
  **What changed.** `POST /api/v1/analytics/query` and `POST /api/v1/analytics/dataset/query` served by `NativeSQLStrategy` (the default on a SQL driver) skipped three policies `SqlDriver.aggregate()` applies. So the ObjectQL strategy and `engine.aggregate` answered differently for the same query. Measured on SQLite and PostgreSQL 16.13:
  
  - On PostgreSQL, `sum` / `avg` over an exact-decimal column, and `avg` over an integer one, added exact decimals. For example, `0.1 + 0.2` answered `0.3` and `11 / 9` answered `1.222222222222222`, where the engine answers `0.30000000000000004` and `1.2222222222222223`. The native statement now accumulates in double, as the driver does.
  - On PostgreSQL, `sum` / `avg` / `min` / `max` over a boolean field answered `500` (`function sum(boolean) does not exist`). The native statement now casts the boolean aggregand to `int`, as the driver does, and answers the numbers the engine answers.
  - On every dialect, a group whose aggregand is NULL in every row, and a measure-scoped `sum` that admits no row, answered `sum` `null` at the cube door. The strategy now folds a `null` answer to `emptyGroupValueFor` (`@objectstack/spec`) for every measure, so that `sum` answers `0`. `avg`, `min` and `max` over nothing stay `null`. The dataset door already answered `0`.
  
  This is no narrowing: each answer moves to the value the platform already declared for the same query.
  
  **What did not move.** `@objectstack/driver-sql`'s statements and answers are unchanged: a move-proof test compiles each aggregate function over each column class on SQLite, PostgreSQL and MySQL, and the statements equal the ones captured before the move. SQLite's native statement is unchanged, because neither operand policy applies there. A host that relays no field declarations to the analytics service, or names no SQL dialect, gets today's native arithmetic.
- 0b12b9e: Clause-②: no
  
  Security: refuse a caller-named analytics member that is neither a declared cube member nor a column reference at the query door, in every tier — including a deployment with no security service and an object the field-level read gate does not judge — so caller-supplied member text can no longer reach a native statement unjudged. The refusal reuses the existing field-read gate's envelope (`PERMISSION_DENIED` / 403); no new error code, and the declared-cube paths are unchanged.
- 2791138: fix(service-analytics): on the native-SQL strategy, a base-table column is qualified with its table whenever the statement joins a related object, not only when the cube declares a join
  
  Clause-②: no
  
  A cube that declares no join still joins a lookup's declared `reference` when a query names a relationship path through it (`owner.email`). The native-SQL strategy qualified base-table columns only for a cube that declares a join, so it wrote them bare beside the joined object. When that object declares a column of the same name, the database refused the statement as ambiguous, and `POST /api/v1/analytics/query` answered `500 DATABASE_ERROR` on SQLite and on PostgreSQL. The ObjectQL strategy answered `200` for the same query.
  
  **Before and after**, measured on a configured cube over a `deal` object that declares no join, whose lookup `owner` points at a person object that also declares `note`, `amount`, `closed_on` and `id`:
  
  - Dimensions `note` and `owner.email`, with or without a `where` on `note` and an `order` by it: `500` → `200`, one group per (deal note, owner email).
  - A `sum` over `amount`, a `timeDimensions` window on `closed_on`, or a `where` on `id`, each grouped by `owner.email`: `500` → `200`.
  - An ad-hoc query over the object, whose inferred cube never declares a join: the same.
  
  The strategy now reads what the statement actually joins, from the one relationship-path resolver, and qualifies every base column in the select list, the grouping, the filters, the measures and the time windows. A statement that joins nothing keeps bare columns. That is now also true on a cube that declares a join when the query uses none of it: the statement it shows on `POST /api/v1/analytics/sql` reads `note` where it read `"deal"."note"`, and the answer is the same.
  
  **Unchanged.** The ObjectQL strategy; every query on a cube that declares the join it uses; every statement that joins nothing on a cube that declares no join; the refusals.
- Updated dependencies [e5c7d07]
- Updated dependencies [addbbf0]
- Updated dependencies [93d4e0e]
- Updated dependencies [88b484e]
- Updated dependencies [9905e61]
- Updated dependencies [f11b5f2]
- Updated dependencies [0cb72cf]
- Updated dependencies [c1d8051]
- Updated dependencies [a918fe7]
- Updated dependencies [41dcf11]
- Updated dependencies [c46279f]
- Updated dependencies [688ddef]
- Updated dependencies [b1aab1e]
- Updated dependencies [274e162]
- Updated dependencies [05a7547]
- Updated dependencies [0efbdc3]
- Updated dependencies [c8dd8dd]
- Updated dependencies [03cdb9a]
- Updated dependencies [15b586d]
- Updated dependencies [542670d]
- Updated dependencies [e73ee2d]
- Updated dependencies [92fe081]
- Updated dependencies [c4c68ca]
- Updated dependencies [d78a0bd]
- Updated dependencies [5363e2d]
- Updated dependencies [c876a74]
- Updated dependencies [f1e921a]
- Updated dependencies [7a1faf1]
- Updated dependencies [c9d234c]
- Updated dependencies [3fbf3ca]
- Updated dependencies [24d521e]
- Updated dependencies [b785c3b]
- Updated dependencies [2473e26]
- Updated dependencies [3a89d45]
- Updated dependencies [f379f57]
- Updated dependencies [889139c]
- Updated dependencies [05cb2bc]
- Updated dependencies [7510663]
- Updated dependencies [a6866da]
- Updated dependencies [1a75e39]
- Updated dependencies [cd901d7]
- Updated dependencies [d7631d5]
- Updated dependencies [d830d71]
- Updated dependencies [89801cd]
- Updated dependencies [1ab9892]
- Updated dependencies [fbec216]
- Updated dependencies [35587f7]
- Updated dependencies [ace770d]
- Updated dependencies [ed54768]
- Updated dependencies [99786f9]
- Updated dependencies [63bfe69]
- Updated dependencies [1940afd]
- Updated dependencies [4f83db5]
- Updated dependencies [f5c7b2c]
- Updated dependencies [6afccda]
- Updated dependencies [671d4c1]
- Updated dependencies [bbcd20c]
- Updated dependencies [c8111a5]
- Updated dependencies [9ad6544]
- Updated dependencies [c9c182e]
- Updated dependencies [4b4ee88]
- Updated dependencies [b9087d7]
- Updated dependencies [f10d802]
- Updated dependencies [856321f]
- Updated dependencies [6b004c0]
- Updated dependencies [93e9e42]
- Updated dependencies [ca5408c]
- Updated dependencies [b280546]
- Updated dependencies [975b248]
- Updated dependencies [ebb66aa]
- Updated dependencies [ceee88f]
- Updated dependencies [e18fea6]
- Updated dependencies [f750119]
- Updated dependencies [660a9b2]
- Updated dependencies [dcd3309]
- Updated dependencies [f6ccca4]
- Updated dependencies [26437ae]
- Updated dependencies [d1633f3]
- Updated dependencies [32d3b3c]
- Updated dependencies [c6b3a01]
- Updated dependencies [bee75ce]
- Updated dependencies [2742e53]
- Updated dependencies [a75311d]
- Updated dependencies [d98bf24]
- Updated dependencies [8368f1c]
- Updated dependencies [8368f1c]
- Updated dependencies [8368f1c]
- Updated dependencies [31c3996]
- Updated dependencies [95555e7]
- Updated dependencies [a29a0ea]
- Updated dependencies [83480c6]
- Updated dependencies [013f97d]
- Updated dependencies [5d5e679]
- Updated dependencies [e07566b]
- Updated dependencies [11d28c1]
- Updated dependencies [399e3aa]
- Updated dependencies [ba03198]
- Updated dependencies [94608a7]
- Updated dependencies [58a77db]
- Updated dependencies [b3d7a70]
- Updated dependencies [b3917d9]
- Updated dependencies [c27404f]
- Updated dependencies [a11faee]
- Updated dependencies [2c1cef3]
- Updated dependencies [27c0cf3]
- Updated dependencies [097ef80]
- Updated dependencies [70dae53]
- Updated dependencies [665cab3]
- Updated dependencies [682873d]
- Updated dependencies [1bd14c9]
- Updated dependencies [62b90d7]
- Updated dependencies [cb45469]
- Updated dependencies [f3b16fc]
- Updated dependencies [d6d6e87]
- Updated dependencies [df1feae]
- Updated dependencies [336e191]
- Updated dependencies [9bdc6d3]
- Updated dependencies [24c554d]
- Updated dependencies [3dc33b2]
- Updated dependencies [9969228]
- Updated dependencies [95e24b0]
- Updated dependencies [1a4c7f8]
- Updated dependencies [c7396f1]
- Updated dependencies [434c6c7]
- Updated dependencies [4b59a38]
- Updated dependencies [d2bc644]
- Updated dependencies [cfa9315]
- Updated dependencies [0803a8b]
- Updated dependencies [0d42104]
- Updated dependencies [a3d7588]
- Updated dependencies [b8191f7]
- Updated dependencies [315888d]
- Updated dependencies [1741c5d]
- Updated dependencies [3711e0b]
- Updated dependencies [a8acee2]
- Updated dependencies [a51920f]
- Updated dependencies [0f6dcac]
- Updated dependencies [682873f]
- Updated dependencies [2123fcc]
- Updated dependencies [00f045d]
  - @objectstack/spec@17.6.0
  - @objectstack/core@17.6.0
  - @objectstack/types@17.6.0

## 17.5.0

### Minor Changes

- e526556: fix(service-analytics): a `min`/`max` over a `formula` field is typed from the formula's declared `returnType`, not described as `number` (#16236)
  
  > ⚠️ **Superseded within the same release window — ⛔ do not act on this entry.**
  > Everything below was accurate when it was written and is kept as the record of what
  > #16236 measured and built. It never reached a published version: **#17560** (director
  > ruling, decision batch #127, 2026-09-13) refuses `min` / `max` over a `formula` field
  > outright, on the compatibility table's own storage ground — a formula is VIRTUAL in SQL
  > storage, no column is emitted, so no aggregate can be lowered to it whatever
  > `returnType` says. At the version that compiles this entry such a measure answers
  > `DATASET_INVALID` / **400** at compile time instead of carrying any `fields[].type`, and
  > the `returnType?: string` member described at the foot of this entry is **not** on
  > `AnalyticsServiceConfig.sourceFieldMeta` — it was added and removed inside one release
  > window, so no published version ever carried it. ⇒ Read #17560's entry instead; the
  > FROM → TO below never became a shipped behaviour.
  
  **Behaviour change — read this if any dataset measure aggregates a `formula`
  field.** `AnalyticsResult.fields[].type` for such a measure column was always
  `number`, whatever the formula computes. It is now translated from the field's
  declared `FieldSchema.returnType`:
  
  ```
  FROM  {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
         "fields":[{"name":"first_label","type":"number"},
                   {"name":"latest_due","type":"number"}]}
  
  TO    {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
         "fields":[{"name":"first_label","type":"string"},
                   {"name":"latest_due","type":"time"}]}
  ```
  
  Both values were strings; both descriptors said `number`, so a renderer that
  branches on the declared type never reached its textual or temporal branch.
  
  **The mapping is a TRANSLATION, not a pass-through.** `returnType` speaks the
  authoring vocabulary (`number` / `text` / `boolean` / `date`);
  `fields[].type` speaks `DimensionType` (`string` / `number` / `boolean` /
  `time` / `geo`). Two of the four words do not exist on the wire at all:
  
  | declared `returnType` | `fields[].type` |
  |:---|:---|
  | `text` | `string` |
  | `date` | `time` |
  | `number` | unchanged — the producer's `number` is already correct |
  | `boolean` | unchanged — three readings disagree on what `min`/`max` over a boolean returns |
  
  **A formula with no `returnType` is unchanged.** The key is optional — "absent
  when the type can't be proven (an ambiguous/`dyn` expression)" — and an
  unproven formula's measure column keeps the `number` it had. The absence is not
  read as an answer. That tier is written down as a row in `measureResultType`'s
  own table rather than left as an implied code path, and so is the treatment of
  a word outside the declared four: left alone, never guessed at.
  
  **For hosts wiring `AnalyticsService` directly.** `AnalyticsServiceConfig`'s
  `sourceFieldMeta` hook gains an optional fourth member on its return —
  `returnType?: string` beside `type` / `defaultCurrency` / `max`. Additive: a
  host that returns the three-member shape still satisfies the contract and gets
  exactly today's behaviour for every column. `AnalyticsServicePlugin` relays the
  key automatically, so a host on the plugin needs no change at all.
  
  ⚠️ **Superseded — see the banner at the top.** #17560 removed that member again in
  the same release window, so the shape a host writes against is the three-member one
  this paragraph calls today's. Nothing to do either way: a host that returns the
  fourth key is ignored, not refused.
- 0252320: feat(service-analytics)!: `min` and `max` are judged by the aggregate × field-type table too — all 74 refused pairs answer `400 DATASET_INVALID` through one compile door (#17560)
  
  <!-- adr-0087: registered dataset-measure-selecting-aggregate-field-type-refused -->
  
  **BREAKING** — an accept-set narrowing on a published authoring surface, and the last
  one this table owed. A dataset measure pairing `aggregate: 'min'` (or `'max'`) with any
  of the **37** field types outside the numeric, temporal and boolean classes — for example
  `text`, `select`, `lookup`, `autonumber`, `json`, `multiselect`, `file`, `location`,
  `vector` or `formula`; the ADR-0087 entry registered below carries the full list — used to
  compile and reach the backend; it is now refused by
  `compileDataset` with `DATASET_INVALID` / **400** before any query is built. Shipped as
  `minor` under the repo's launch-window convention for accept-set narrowings.
  
  ⛔ This changeset adds no rows to any table and restates none. The verdict is
  `AGGREGATE_FIELD_TYPE_COMPATIBILITY`'s — the one table `@objectstack/spec` declared in
  #16353 under the director ruling of decision batch #59 ("both legs, table in spec") —
  read through `isAggregateCompatibleWithFieldType`.
  
  ## What was wrong
  
  The table refused these 74 pairs from the day it was declared, and **four declarations
  gave three different answers about them**:
  
  | declaration | what it said about `min` × `text` |
  |---|---|
  | `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (spec) | refused |
  | `dataset-compiler`'s compile leg | never judged — `if (!DERIVING_AGGREGATES.has(aggregate)) return;` |
  | `measureResultType` (service-analytics, #15768) | a supported `'string'` result |
  | two shipped test files, in prose | "ruled C — the table is to be AMENDED to accept it" |
  
  Driven through the real service door before anything was written, `min` / `max` over 13
  sampled refused pairs all compiled and emitted SQL, with `avg` × `datetime` as the
  firing control (refused, `DATASET_INVALID` / 400, no SQL) — so the zero was a reading of
  the tree rather than of a blind harness.
  
  The fourth row had nothing behind it. The card it cited (#17513) is closed as a
  duplicate carrying zero rulings, and the one recorded ruling on this table says the
  opposite. ⇒ The director ruling of decision batch #127 (2026-09-13) settled all three
  sub-questions in one pass, because one shared fixture drove members of both halves:
  
  1. **the string classes** (42 pairs) stay refused, as batch #59 ruled — ⛔ the table is
     not amended;
  2. **the non-string classes** (32 pairs) are refused **and enforced**;
  3. **`formula`** is refused on the table's own storage ground — it is VIRTUAL in SQL
     storage, no column is emitted, so no aggregate can be lowered to it whatever
     `returnType` says.
  
  The divergence is real, and for these two aggregates it is the **ORDER** rather than the
  arithmetic: string order is collation-dependent, so two backends answer two different
  "smallest" values for one metadata document, and `min(jsonb)` does not exist on
  PostgreSQL at all.
  
  ## What changed
  
  - **`dataset-compiler`**: the scope condition is gone. `assertAggregateFieldTypeCompatible`
    judges all six `AggregationFunction` members against the table, through the same
    `DATASET_INVALID` / 400 door. The refusal message names the divergence its own
    aggregate class really has (`min` / `max` SELECT a stored value and diverge on order;
    `sum` / `avg` DERIVE a number and diverge on arithmetic) and prescribes accordingly.
  - **`measureResultType`** asks `isAggregateCompatibleWithFieldType` before it answers, so
    the rule and the table agree **by construction**. Its `STRING_SOURCE_FIELD_TYPES`
    branch and its `formula` branch are retired with them; `min` / `max` over the temporal
    class still answers `'time'`, unchanged.
  - **`AnalyticsServiceConfig.sourceFieldMeta`** no longer declares `returnType`. It was
    carried (#16236) for one reader — the retired `formula` branch — and a declared input
    nobody consumes is the declared-not-enforced shape Prime Directive #10 refuses.
  
    ⚠️ **That key was never released, so against every published version this removal is a
    no-op.** #16236 is still a pending changeset in the same release window as this one;
    the last published entry (17.4.0) says in as many words that `FieldSchema.returnType`
    "is not on `AnalyticsServiceConfig.sourceFieldMeta`'s return shape". The key was
    therefore added and removed inside one window and no published tarball ever carried it.
  
    **Host fix, one line:** drop `returnType` from whatever your `sourceFieldMeta` returns.
    You do not have to — the hook is a function RETURN position, so an extra key is not an
    excess-property error and is simply ignored at runtime — but keeping it declares an
    input nothing reads. Hosts on `AnalyticsServicePlugin` need no change at all: the plugin
    stopped relaying the key in this same change.
  
  ## FROM → TO, and the one-line fix
  
  | you wrote | write instead |
  |---|---|
  | `{ aggregate: 'min' \| 'max', field: <a text/select/lookup/autonumber field> }` | `count` / `count_distinct` if you were counting; a **sort** on the list/report if you wanted the first or last RECORD |
  | `{ aggregate: 'min' \| 'max', field: <a json/multiselect/file/location/vector field> }` | store the quantity you meant as a numeric or temporal field and aggregate that |
  | `{ aggregate: 'min' \| 'max', field: <a formula field> }` | a formula emits no column; aggregate the stored field the formula reads, or persist the computed value |
  
  ⚠️ **Untouched:** those field types used as a **DIMENSION** (grouping, labelling,
  bucketing, filtering), `count` / `count_distinct` over any type, `min` / `max` over the
  numeric, temporal and boolean classes, and every `sum` / `avg` row #16778 and #16099
  already settled. The refusal also still stands down rather than guessing wherever the
  declared type cannot be resolved: no `sourceFieldMeta` wired, an unknown field, or a
  `relationship.field` path whose column lives on a joined object.
  
  ⚠️ The hand-migration prescription ships as the ADR-0087 semantic TODO registered above,
  which names the measure and the field type per affected pair — no lossless conversion
  exists, because nothing can compute "the smallest text value" in a way every backend
  agrees on.
- 14add48: fix(service-analytics)!: the analytics `where` door refuses a list in the equality slot instead of reading it as `IN` (#19888)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered filter-equality-array-comparand-refused) the transition from a list in the equality slot to the operator it stood in for was registered by #19757 for the FilterCondition equality slot at the runtime filter doors; this change adds no new transition, it brings the analytics object-form `where` and the draft-data preview under the one already on the ledger, and the entry's own prescription and acceptance criteria apply verbatim -->
  
  **BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` that carries a list in the equality slot, `{ field: [...] }` (the empty list included) or `{ field: { $eq: [...] } }`, at any depth under `$and` / `$or` / `$not` or inside a nested relation, compiled before this change. It is now refused with `INVALID_FILTER` / 400. It ships as `minor` under the launch-window convention for accept-set narrowings. The remedy is `$in`:
  
  | you wrote | write instead |
  |:--|:--|
  | `{ stage: ['won', 'lost'] }` or `{ stage: { $eq: ['won', 'lost'] } }`, meaning "one of these values" | `{ stage: { $in: ['won', 'lost'] } }` |
  | `{ stage: ['won'] }`, meaning one value | `{ stage: 'won' }` |
  | `{ stage: [] }` | `{ stage: { $in: [] } }`, which matches no row, as the bare list did |
  
  `$in` charts the rows the implicit list charted before. The refusal also names `{ "$contains": "…" }` for "the stored list holds a value" on a multi-value field.
  
  Ruling 乙 of #19757 refuses a list in the equality slot at the shared comparand-shape face in `@objectstack/spec`, for every driver at once. The analytics `where` door met that face only for the `FilterArray` spelling (`['stage', '=', ['won', 'lost']]`), which was already refused. The object spelling was compiled by the analytics filter normalizer, which read one condition four ways:
  
  - `{ stage: ['won', 'lost'] }` compiled to `stage IN (...)`. On the ObjectQL path the engine received `{ stage: { $in: [...] } }`, so the engine's own shared-face check never saw the list.
  - `{ stage: { $eq: ['won', 'lost'] } }` compiled to `stage = 'won'`, and `'lost'` was dropped without a word.
  - `{ stage: { $eq: [] } }` compiled to no predicate at all, so the chart was drawn over every row.
  - `{ stage: [] }` compiled to the FALSE constant.
  
  Each list is now handed to the shared face's equality arm before any node is built. Both spellings of one condition therefore get the same refusal, with the same wording, path and `$in` prescription. The draft-data preview runs the same gate, so a drafted chart refuses what the published chart refuses. Before, it compared each row against the list's string form.
  
  Who is affected: nothing in this repository's examples, seeds or docs authors the shape (measured over `examples/**`, `packages/**` and the fenced code in the docs). Stored datasets, dashboard widget filters, report runtime filters and measure filters in a deployment were NOT measured. In this release the authoring schema refuses the shape too, when such a document is saved (a separate change in `@objectstack/spec`, ADR-0087 entry `filter-equality-array-comparand-refused-at-save`). One position is judged here and not by the shared authoring schema: a list inside a nested relation, which this door flattens to a dotted member. A dataset `filter` or measure `filter` carrying one is refused when it is saved, in the same words (a separate change in `@objectstack/spec`, ADR-0087 entry `dataset-filter-nested-relation-equality-array-refused-at-save`). Any other `where` that reaches this door with one, such as a caller `where` or a dataset selection's `runtimeFilter`, is refused only when it is charted. The refusal names the field and the path. `$ne` with a list is not part of the ruling and is not judged here. The list operators (`$in`, `$nin`, `$between`) keep their lists, and every scalar, `null` included, compiles as before.
- e8f163f: fix(service-analytics)!: the read-scope compiler refuses a list under `$eq` instead of binding it (#19975)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) a compile-time refusal in the read-scope compiler: no authorable key, spelling or stored shape moves, and an authored policy never emits this spelling (the CEL lowering writes `$eq` only around a `{ $field }` reference), so a stored `sys_metadata` row needs no conversion. The remedy for a host-supplied read scope is to write the list under `$in`. -->
  
  **BREAKING**: this narrows what `compileScopedFilterToSql`, exported from `@objectstack/service-analytics`, accepts. A read scope carrying `{ field: { $eq: [...] } }` compiled before this change and is refused after it. It ships as `minor` under the launch-window convention for accept-set narrowings. The remedy is `{ field: { $in: [...] } }` for "one of these values".
  
  `compileScopedFilterToSql` compiles a row-level read scope into the SQL the analytics NativeSQL path and the `/analytics/sql` echo run. It already refused a list in the implicit equality slot (`{ field: [...] }`). The explicit spelling, `{ field: { $eq: [...] } }`, was compiled to an equality with the whole list bound as one parameter, so what the scope selected depended on how the executing database read a list, not on what the scope said.
  
  It is now refused, at any depth under `$and` / `$or` / `$not`, with the envelope every other refusal of this compiler carries: `READ_SCOPE_COMPILE_FAILED` / 500, with the message kept for the server log. This applies ruling 乙 of #19757, which the shared comparand-shape face in `@objectstack/spec` already enforces, to a compiler that face never sees. `$ne` with a list is not part of that ruling and is not judged here.
  
  No policy authored as metadata produces this shape. The refusal therefore reaches only a host-supplied `getReadScope` or a direct caller of `compileScopedFilterToSql`. A scalar, `null` or a `Date` under `$eq` compiles exactly as before, and a `{ $field }` reference there keeps its existing answer.
- 246314d: fix(service-analytics)!: the analytics `where` door runs every arm of the shared comparand-shape face on the object spelling, not only the equality arm (#20010)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered filter-between-blank-endpoint-refused) this change adds no new transition. It brings the analytics object-form `where`, its dataset and measure filters, and the draft-data preview under refusals the shared comparand-shape face already makes at every other door. The one arm whose transition is on the ledger is the blank `$between` endpoint (named). The null list member, the null `$between` endpoint and the null ordering comparand were ruled at the face with no ledger entry (their changesets declared no-migration-prescription: which explicit spelling matches the author's intent is an authoring decision no migration entry can perform). The non-list `$in` / `$nin` / `$between` refusal is the face's original rule. The `{ $field }` and one-bound `$between` endpoints were already refused on this door and change wording only. The table below is the author-facing remedy for each arm, not a mechanical rewrite. -->
  
  **BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` that carries one of the shapes below compiled before this change, at any depth under `$and` / `$or` / `$not` or inside a nested relation. It is now refused with `INVALID_FILTER` / 400, carrying the shared face's own message, path and prescription. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  | you wrote | what it did before | write instead |
  |:--|:--|:--|
  | `{ stage: { $in: ['won', null] } }`, meaning "one of these, or empty" | `stage IN ('won', NULL)`: the empty rows were never matched | `{ $or: [{ stage: { $in: ['won'] } }, { stage: { $null: true } }] }` |
  | `{ stage: { $nin: ['won', null] } }`, meaning "has a value, and not one of these" | `stage IS NULL OR stage NOT IN ('won', NULL)`: only the empty rows | `{ $and: [{ stage: { $nin: ['won'] } }, { stage: { $null: false } }] }` |
  | `{ amount: { $gt: null } }` (or `$gte` / `$lt` / `$lte`) | `amount > NULL`: no row, while for `$lt` / `$lte` the draft preview charted every non-empty row | `{ amount: { $eq: null } }` for "has no value", `{ amount: { $ne: null } }` for "has a value" |
  | `{ amount: { $between: [null, 100] } }` | `amount >= NULL AND amount <= 100`: no row | `{ amount: { $lte: 100 } }` for a one-sided range; `$or` with `{ amount: { $null: true } }` to include the empty rows |
  | `{ amount: { $between: ['', 100] } }` | `amount >= '' AND amount <= 100`: the blank compared as a value, and the ObjectQL engine path accepted it | the bound you meant, or `{ amount: { $lte: 100 } }` for a one-sided range |
  | `{ stage: { $in: 'won' } }` or `{ stage: { $nin: 'won' } }` | laundered into a one-member list | `{ stage: 'won' }` / `{ stage: { $ne: 'won' } }`, or `{ stage: { $in: ['won'] } }` |
  
  The shared comparand-shape face in `@objectstack/spec` (`assertListComparandShapes`) is the one place that decides whether `$in` / `$nin` / `$between` received a list at all, for every driver. Three rulings put the null and blank positions on that same door: a null list member and a null `$between` endpoint (2026-08-31), a null ordering comparand (2026-09-01), and a blank `$between` endpoint (2026-09-20). The analytics `where` door met that face only for the `FilterArray` spelling (`['stage', 'in', ['won', null]]`), which was already refused. PR #20008 carried the face's equality arm to the object spelling. Every other arm now follows it: each field entry of the object-form `where` is handed to the face after the equality pass, so both spellings of one condition get the same refusal, byte for byte. This holds on the native SQL execute path, the `/analytics/sql` echo and the ObjectQL engine path. The draft-data preview runs the same gate, so a drafted chart refuses what the published chart refuses. Before, the preview charted rows for several of these shapes: `{ amount: { $lt: null } }` charted every non-empty row.
  
  Three shapes this door already refused now carry the face's wording instead of this package's own, the same wording the `FilterArray` spelling gets: a `$between` that is not a two-element list, a `$between` endpoint that is a `{ $field }` reference, and an `undefined` `$between` endpoint. Their verdict, code and status are unchanged.
  
  Who is affected: nothing in this repository's examples, seeds, docs or package sources authors any of the shapes. This was measured by a text scan over 4013 non-test files with positive controls. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured. The authoring schema still admits the shapes, so such a document still publishes, and it is refused when it is charted.
  
  Not changed: `$ne` with a list is not judged by the face yet, so it compiles as before. `$in: []` / `$nin: []`, falsy list members (`0`, `''`, `false`), every non-null ordering comparand, a `{ $field }` in an ordering slot, and `null` in the equality slot (the has-no-value predicate) all compile as before. The comparand-TYPE face is not run on this door. An `undefined` comparand outside a `$between` endpoint keeps this package's own refusal.
- 980bc05: fix(service-analytics)!: the NativeSQL execute face and the `/analytics/sql` echo refuse a read scope the shared comparand faces refuse, as the ObjectQL execute face already does (#20018)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `packages/spec` is untouched, and the shapes refused here are ones the spec's shared comparand faces (`assertListComparandShapes`, `normalizeFilterComparandTypes`) already refuse on every object-form `where` and, since #19995, on the ObjectQL analytics face. What changes is which runtime face refuses a read scope, so `objectstack migrate meta` has nothing to act on and the ledger has no row to gain. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a read-scope comparand shape (not `registered` / `already-registered`); and the change is runtime behaviour of a function, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING** — an accept-set narrowing on the read-scope lowering, shipped as
  `minor` under the launch-window convention (`check-changeset-no-major` refuses
  `major` until GA; breaking-ness is carried by this banner and the ADR-0087
  disposition above, not by the level).
  
  **What changed.** `compileScopedFilterToSql` is the read-scope lowering behind the
  NativeSQL execute face (`NativeSQLStrategy.applyReadScope`, base table and every
  joined hop) and the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`), and a
  public export of this package. Once its own lowering succeeds, it now runs the two
  shared comparand faces of `@objectstack/spec/data` on the scope. A scope they
  refuse is refused as `READ_SCOPE_COMPILE_FAILED` / 500 with the message withheld
  (the #5367 envelope), before any statement is built or executed. That is the
  answer the ObjectQL execute face has given the same scope since #19995, so one read
  scope now gets one verdict on every analytics face.
  
  **Which read scopes stop being served.** Each was lowered and executed before, and
  each is refused by a standing ruling the shared faces carry. Measured on SQLite:
  
  | read-scope shape | what the native face and the echo served |
  | --- | --- |
  | a `null` member of `$in` | only the named non-null values; the NULL matched nothing |
  | a `null` member of `$in` under `$not`, or of `$nin` | only the rows whose column is NULL, which the scope excludes |
  | a `null` comparand under `$gt` / `$gte` / `$lt` / `$lte`, or a `null` `$between` bound | zero rows |
  | a blank (`''`) `$between` bound | the rows inside the half-blank range |
  | a bigint beyond ±2^53, or a binary comparand | zero rows |
  | a plain-object or other non-plain-object comparand in a scalar position | the database refused the statement (`DATABASE_ERROR` / 500) |
  
  **Who is affected.** A host `getReadScope` provider, or a direct caller of
  `compileScopedFilterToSql`, that produces one of these shapes. The ObjectQL
  analytics face already refused all of them. No in-repo read-scope producer emits
  them for a policy in this repository. An RLS `using` predicate can still be
  written so that it lowers into the null shapes (a literal `null` inside an `in`
  list, or an ordering comparison against `null`), but the RLS compiler drops such a
  policy (#20212), so the analytics faces receive the deny sentinel and answer zero rows.
  
  **Fix.** State absence with the null predicate. "One of these values, or no
  value" is `{ "$or": [{ "f": { "$in": ["a"] } }, { "f": { "$null": true } }] }`,
  which in an RLS predicate is `f in ['a'] || f == null`. A one-sided range is `$gte`
  or `$lte`. A comparand is a string, number, bigint within ±2^53, boolean, `null` or
  `Date`.
  
  **Unchanged.**
  
  - Well-formed scopes compile to the same SQL and admit the same rows. That includes
    the null predicates, an emptied `$in` beside an own-rows grant, and the spelling
    above.
  - A shape the lowering already refused keeps its own log sentence.
  - The caller's own `where` never reaches this lowering, and it is untouched.
- 7ddf396: fix(service-analytics)!: the analytics `where` door runs the shared comparand-TYPE face on the object spelling, so a plain-object, binary, `Map`, class-instance, oversized-bigint or `undefined` comparand is refused like the `FilterArray` spelling and the engine refuse it (#20035)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) the #7872 comparand-type transition is not on the ADR-0087 ledger: no entry names normalizeFilterComparandTypes or its accepted set, and #7872's own changeset declared no breaking change. This change adds no new transition either; it brings the analytics object-form `where`, its dataset and measure filters and the draft-data preview under the refusal that face already makes at every other door. No ledger entry could carry it: a plain object in a comparand slot has no accepted comparand it can be mechanically rewritten to, and a binary, a Map, a class instance, a bigint beyond 2^53 and undefined cannot be stored as JSON metadata at all. Which accepted comparand the author meant is an authoring decision. A bigint within 2^53 is narrowed to its number and answers the same rows. The table below records the verdict each cell had and has; it prescribes no rewrite. -->
  
  **BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` in the object spelling that carries one of the comparands below compiled before this change, at any depth under `$and` / `$or` / `$not` or inside a nested relation. It is now refused with `INVALID_FILTER` / 400, in the shared face's own message, path and prescription, before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  | comparand in an object-form `where` | before (native SQL execute) | now, on every face |
  |:--|:--|:--|
  | a plain object under a scalar operator: `{ stage: { $ne: { a: 1 } } }`, `$gt`, `$eq`, the LIKE family | bound as the JSON text `'{"a":1}'`; `$ne` served EVERY row, the others matched nothing; the `/analytics/sql` echo answered `DATABASE_ERROR` / 500 | refused 400: "Filter comparand at where.stage.$ne is a plain object …" |
  | a plain object as a `$between` endpoint or an `$in` / `$nin` member | the endpoint was compared as JSON text; the member was refused in this package's own sentence | refused 400, in the face's sentence |
  | a `{ $field: 5 }` object (a non-string `$field`) under an ordering operator | bound as JSON text (it is not a field reference) | refused 400 as a plain object |
  | a binary (`Uint8Array` / `Buffer`) under `$eq` / `$ne` or as an `$in` member | bound as the JSON text `'{"0":1,…}'`, never as a blob; `$ne` served every row | refused 400 |
  | a binary, a `Map` or a class instance as the implicit comparand `{ stage: VALUE }` | read as a NESTED RELATION (`stage.0 = 1 AND …`, a 500 on the native path) or refused as a zero-operator wrapper | refused 400 as the value it is |
  | a `bigint` beyond ±2^53 | bound as-is, answering no row | refused 400 |
  | `undefined`, implicit or under any operator, including `$null` / `$exists` | refused 400 in this package's own sentence, except `{ $null: undefined }`, which compiled to IS NOT NULL; the draft preview answered no row | refused 400, in the face's sentence |
  
  The shared comparand-type face in `@objectstack/spec` (`normalizeFilterComparandTypes`) is the #7872 door: its accepted comparand types are `string | number | bigint | boolean | null | Date`, and it refuses everything else loudly at the compile face (maintainer ruling, 2026-08-12). `parseFilterAST` runs it on everything it returns and the ObjectQL engine's seam on every object-form `where`, so the `FilterArray` spelling of this door and the engine path already refused each row above. The object spelling now meets it too, after the comparand-shape face and before any node is built, the order `parseFilterAST` uses. Both spellings of one condition get the same refusal, byte for byte, on the native SQL execute path, the `/analytics/sql` echo, the ObjectQL engine path and the draft-data preview.
  
  A `bigint` within ±2^53 is not refused: the face narrows it to its number, and the condition every face lowers is the narrowed one. The rows do not change on the published faces. The draft-data preview used to order a bigint as text (`{ amt: { $gt: 2n } }` lost the row holding 10); it now evaluates the narrowed number and charts the published rows.
  
  Binary comparands are reconciled with the face rather than kept as a declared local extra of this package. Measured before this change, the `where` door never compared a binary as a blob on any face: the native path bound it as JSON text, the engine path and the `FilterArray` spelling refused it, and no producer can send one over JSON. This change does not touch the read-scope door, which refuses a binary comparand too since the read-scope lowering began running the same face (#20018), so a binary is now refused at both analytics doors.
  
  Refusals this door already gave in its own words now read in the face's words, the same words the `FilterArray` spelling gets: an `undefined` comparand, and a plain-object `$in` / `$nin` member or LIKE-family comparand. Their verdict, code and status are unchanged. The positions the face does not judge keep this package's sentences: an array or a `{ $field }` reference as a list member or a LIKE comparand, and an `undefined` inside an array comparand or under an operator outside the vocabulary.
  
  Who is affected: nothing in this repository's examples, seeds, docs or package sources authors any of the refused comparands. A text scan over 4013 non-test files found none, and it did find the shape in a code comment written for this change. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured. Of the refused values, only the plain object can be stored as JSON.
  
  The refusal both analytics doors give for an unbindable `$in` / `$nin` / `$between` member no longer offers "(or a binary value)" as a repair, because neither door accepts a binary any more. It now names only the accepted set; its code, status and verdict are unchanged.
  
  Not changed: every string, number, boolean, `null` and `Date` comparand; a `{ $field }` reference in an ordering slot (served on the engine path); nested relations and dotted members; `$ne` with a list, which the shared face does not judge yet.
- 226e00c: fix(service-analytics)!: the analytics `where` door refuses a non-boolean `$null` / `$exists` flag, which it used to read as IS NOT NULL, the way every backend and the read-scope compiler already refuse it (#20040)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) no ADR-0087 ledger entry names the $null / $exists boolean domain: the refusals driver-sql makes (#5347, #5369) and the read-scope compiler makes (#6387) were never registered, and this change adds no new transition. It brings the analytics object-form `where`, its dataset and measure filters and the draft-data preview under the refusal every other face already makes. No ledger entry could carry it: a non-boolean flag has no boolean it can be mechanically rewritten to, because the backends disagreed on which one it meant and the string "false" is truthy. Which boolean the author meant is an authoring decision. The table below records the verdict each cell had and has; it prescribes no rewrite. -->
  
  **BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A `$null` or `$exists` flag whose value is not a boolean used to compile, in a caller `where`, a dataset `filter` or a measure `filter`, at any depth under `$and` / `$or` / `$not` or inside a nested relation. That covers a string such as `"false"`, a number, `null`, an array, a `Date` and a `{ $field }` reference. It is now refused with `INVALID_FILTER` / 400, in a message that names the operator, the field and the path, before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  | flag in an object-form `where` | before | now |
  |:--|:--|:--|
  | `$null` or `$exists` with a string, a number, `null`, an array, a `Date` or a `{ $field }` reference | read as IS NOT NULL on the native SQL path, the `/analytics/sql` echo and the ObjectQL engine path (the engine received `{ "$ne": null }`); `POST /api/v1/analytics/query` and `/analytics/dataset/query` answered 200 | refused 400: `Operator "$null" on field "stage" requires a boolean comparand (true or false). Received …` |
  | the same, under `$not` | the negation of IS NOT NULL: the rows with no value | refused 400 |
  | the same, in the draft-data preview | refused 400 as an operator the preview does not evaluate | refused 400, in the published door's words |
  | `true` or `false` | IS NULL or IS NOT NULL, per the contract | unchanged: the compiled tree, the SQL and the engine `where` are byte-identical |
  | `undefined`, or a plain object | refused 400 by the shared comparand-type face | unchanged, in that face's words |
  
  `FieldOperatorsSchema` in `@objectstack/spec` declares both flags as booleans. The #5347 and #5369 rulings refuse a non-boolean one in every position and on every backend, because the backends read one in opposite directions: `driver-sql` compiled IS NULL for anything but `false`, and the JavaScript drivers compiled IS NOT NULL for anything but `true`. `driver-sql` refuses it, and so does this package's read-scope compiler. This door read every non-boolean as IS NOT NULL, so `"true"` and `"false"` asked for the same rows, and `{ "$null": "true" }` asked for the rows it excludes.
  
  The repair is to write the boolean the filter means. `"$null": true` matches rows with no value and `"$null": false` rows with one; `$exists` is the exact inverse.
  
  Over HTTP, both routes type the `where`, the `runtimeFilter` and the inline `dataset.filter` as `FilterConditionSchema`, whose field entries are open, so the body parse admitted the flag and the service served it. Both routes now answer 400 `INVALID_FILTER` from the service, with no statement run.
  
  A `where` that carries a non-boolean flag and also a defect this compiler finds only while lowering (a field constraint mixing `$` and non-`$` keys, an operator outside the vocabulary, a zero-operator constraint) is now answered with the flag refusal. The code and status are the same 400 `INVALID_FILTER`. A shape or type defect elsewhere in the same `where` is still answered first.
  
  Who is affected: nothing in this repository's examples, seeds, docs or package sources authors a non-boolean flag. A text scan over 4598 tracked non-test files found 22 matches: 21 are code comments, and one is an operator-name lookup table in `driver-memory`, not a filter. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured.
  
  Not changed: a `true` or `false` flag; the `FilterArray` spelling, whose `is_null` and `is_not_null` take their boolean from the operator name; the read-scope door, which already refused a non-boolean flag in its own withheld envelope.
- a8bcce6: fix(service-analytics)!: both analytics doors refuse the two `$icontains` comparands `FILTER_TEXT_CASES` declares refused, an empty one and a non-string one, each door in its own envelope (#20068)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (already-registered filter-icontains-comparand-refused-at-parse) this is the transition that entry already records: its surface names the $icontains comparand in FilterConditionSchema, read-scope rules and analytics filters included, empty or not a string, and its replacement is a non-empty string or no condition. This change adds no new transition; it brings the analytics compile faces under the refusal the entry declares, which the parse door and the drivers already make. -->
  
  **BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. An `$icontains` condition whose comparand is the empty string, or is not a string at all (a number, a boolean, `null`, a `Date`), used to compile on the analytics compilers. It is now refused before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.
  
  `@objectstack/spec` declares both refusals as data: `FILTER_TEXT_CASES` carries a REJECTION row for an empty `$icontains` comparand and one for a non-string comparand, each `INVALID_FILTER` naming `$icontains`. It publishes the discrimination as `isRefusedTextComparand` and the reason as `textComparandRefusalReason`. The spec's parse door (`FilterConditionSchema`) and `driver-sql` already refused both. This package never asked, so one filter got two answers. Both analytics doors now call the published predicate and seat the published reason in their own envelope.
  
  | where the condition sits | before | now |
  |:--|:--|:--|
  | a caller's `where`, a dataset `filter` or a measure `filter`, either spelling, at any depth | `''` matched every row whose column has a value; a non-string was bound as its text and matched nothing. Native SQL, the `/analytics/sql` echo and `AnalyticsService.query` all served it | `INVALID_FILTER` / 400, with the spec's reason, naming `$icontains` |
  | a row-level read scope, on the native SQL face and the echo | the same predicate: `''` admitted every row that has a value | `READ_SCOPE_COMPILE_FAILED` / 500, with the message withheld |
  | a row-level read scope, on the ObjectQL face | the driver refused it as `INVALID_FILTER` / 400, and the message named the policy's field and comparand | `READ_SCOPE_COMPILE_FAILED` / 500, with the message withheld |
  
  The migration is the ledger entry named above: write a non-empty string, or drop the condition. An empty comparand was a predicate that constrained nothing, so the repair is to delete the condition. A number, boolean or `null` comparand is written as the string it was meant to match, or the operator was the wrong one.
  
  Over HTTP, `POST /api/v1/analytics/query`, `/analytics/sql` and `/analytics/dataset/query` already refused a caller-authored condition carrying either comparand, at their body parse (`400 VALIDATION_FAILED`). What this changes for an HTTP caller is the read scope. A row-level read scope supplied by the host (`getReadScope`) is refused in the withheld envelope on every analytics face. It is no longer served on the native SQL face, and it is no longer answered with a 4xx that carries policy content on the ObjectQL face. The CEL policy lowering never emits `$icontains`, and a filter placeholder never resolves to an empty string.
  
  Who is affected: nothing in this repository's examples, seeds, docs or package sources authors either comparand; every hit outside tests is a code comment. Stored datasets, dashboard filters and host-supplied read scopes in a deployment were NOT measured. A stored row saved before the parse-door refusal can still carry an empty comparand, and it is now refused at query time, where it used to answer every row that has a value.
  
  Not changed: a non-empty string comparand, whatever its case or content; an object or array comparand, still refused in its existing sentence; the non-text-column constant for an accepted comparand. `$contains`, `$notContains`, `$startsWith` and `$endsWith` keep their answer to an empty comparand: the table has no REJECTION row for them, and widening by analogy is the table's decision.
- 7c1039b: fix(service-analytics)!: the NativeSQL execute face and the `/analytics/sql` echo resolve a read-scope filter placeholder with the caller's context, and refuse one they cannot resolve, as the ObjectQL execute face already does (#20075)
  
  Clause-②: no (narrowing)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves: `packages/spec` is untouched and no metadata key or value changes meaning. What changes is which runtime faces resolve a read-scope placeholder and refuse one they cannot resolve; the engine behind the ObjectQL face already did both, with the same `@objectstack/core` resolver. `objectstack migrate meta` has nothing to act on and the ledger has no row to gain. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a read-scope placeholder (not `registered` / `already-registered`); and the change is runtime behaviour of a function, not a TypeScript declaration removed or narrowed (not `runtime-interface-only` / `type-surface-only`). -->
  
  **BREAKING**: an accept-set narrowing on the read-scope lowering, shipped as `minor` under the launch-window convention. `minor` is also the level a new accepted option key takes.
  
  `compileScopedFilterToSql` is the read-scope lowering behind the NativeSQL execute face (`NativeSQLStrategy.applyReadScope`, the base table and every joined hop) and the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`), and a public export of this package. It never resolved a filter placeholder, so both faces bound `{current_user_id}`, `{current_org_id}` or a date macro as its literal text. The ObjectQL execute face hands the same scope to the engine, which resolves it with the caller's context. One read scope, two row sets.
  
  It now takes an optional `context` (`ReadScopeCompileOptions.context`) and resolves the scope with `resolveFilterTokens(scope, filterTokenContextFrom(context))` from `@objectstack/core`, the resolver the engine calls, before lowering it. Both strategies pass the request's context.
  
  | a read scope carrying | before, on the NativeSQL face and the echo | now |
  |:--|:--|:--|
  | a placeholder the caller's context resolves | its literal text was bound: an equality matched no row, and a `$ne` exclusion admitted every row, the caller's own included | the resolved value is bound and the echo prints it; the same rows as the ObjectQL face |
  | an unknown placeholder, or a context token the request has no value for | served, with the literal bound | `READ_SCOPE_COMPILE_FAILED` / 500, message withheld, as on the ObjectQL face |
  
  Without a context the answer is the engine's for a context-less operation: a date macro resolves against UTC now, and a context token is refused. A placeholder is never bound as its literal text.
  
  Who is affected: a host whose own `getReadScope` returns scopes carrying placeholders, and a direct caller of `compileScopedFilterToSql`. The security service's read filter, the auto-bridged default, composes concrete values and is not affected.
  
  Not changed: a scope with no placeholder compiles to the same SQL and parameters as before. The caller's own `where` is untouched: `AnalyticsService` already resolves its placeholders and answers an unresolvable one `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` / 400 with its message. The ObjectQL execute face is untouched.
- f2c7eef: An analytics cube's `public` now takes effect, and it defaults to visible: `CubeSchema.public` defaults to `true` (it was `false`), and the analytics service hides a cube that declares `public: false` from discovery and refuses every query against it (#20282).
  
  Clause-②: yes (narrowing)
  
  <!-- adr-0087: registered analytics-cube-public-default-visible-enforced -->
  
  **BREAKING**: this narrows what the analytics API answers. A query or SQL dry run against a cube declared `public: false` (`POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`) was answered before this change and is now refused with `404 CUBE_NOT_FOUND`, and `GET /api/v1/analytics/meta` no longer lists that cube. The same happens to every cube in an artifact built by `os compile` before this release, which carries a materialized `public: false` from the old default. The remedy: delete `public: false` from any cube that is meant to be queried (cubes are visible by default), and recompile pre-release artifacts. It ships as `minor` under the launch-window convention; the widening half is the default moving to visible.
  
  Until this change nothing read `public`. `GET /api/v1/analytics/meta` listed a `public: false` cube and every query door answered it, so the flag withheld nothing. Its declared default, `false`, could not simply be switched on: enforcing it as declared would have hidden every cube that omits the key. The default is now the Cube.dev default (visible), and an explicit `false` is enforced:
  
  - `GET /api/v1/analytics/meta` omits a cube declared `public: false`, and `?cube=` naming one answers `[]`, the same as a name no cube has.
  - `POST /api/v1/analytics/query` and `POST /api/v1/analytics/sql` refuse it with `404 CUBE_NOT_FOUND` — the same refusal, byte for byte, that an unknown cube name gets, so a caller cannot use it to learn that a hidden cube exists. The one shared message names both possibilities, so it still tells an author how to expose a hidden cube. The refusal comes before any SQL is built, and it is never an empty result.
  
  `public` is visibility on the analytics API, not row security. An object's records stay governed by its permissions and row-level security on every door, whether or not a cube over it is hidden. What `public: false` does is exactly the two points above: the cube is left out of `/analytics/meta`, and queries and SQL generation against it are refused. The cube's definition stays readable on the metadata door, like any other authored schema.
  
  What to expect after upgrading:
  
  - **A cube that omits `public`** stays visible and queryable. It was visible before too, because nothing read the key. A client that parses cube metadata through the published JSON Schema now materializes `public: true` where it materialized `false`.
  - **A cube that writes `public: false`** is now hidden and refused. If you wrote it only because it was the old default, delete the line (cubes are visible by default). A dashboard or report that queries such a cube starts answering `404 CUBE_NOT_FOUND` until you do.
  - **A compiled artifact built before this release** carries a materialized `public: false` on every cube, because `os compile` writes the parsed stack with its defaults applied. Recompile it with this release before serving cubes from it.
  - **Cubes the platform mints itself** stay visible: the cube inferred for an ad-hoc query on an object (the KPI path), a compiled dataset's cube (`POST /api/v1/analytics/dataset/query`), and `CubeRegistry.inferFromObject`. Each wrote a literal `false`, the old default, and now writes `true`.
  
  The showcase example's `showcase_delivery` cube, which is the app's demonstration of `/api/v1/analytics/*`, drops its `public: false`.
- 2b53993: fix(service-analytics): both analytics filter faces answer `$empty` by the field's declared type (#20445)
  
  Clause-②: yes (widening)
  
  `$empty: true | false` is declared by `@objectstack/spec` (`FieldOperatorsSchema`) with a per-type meaning: a text-like field is empty when it is null or `''`, a multi-value field (multiselect, checkboxes, tags, or a select / radio / lookup / user / file / image with `multiple: true`) when it is null or `[]`, and every other type only when it is null. `$empty: false` is the exact complement. Both of this package's filter faces now answer it by that table, through the spec's one expansion (`expandEmptyOperator`), instead of refusing it:
  
  - **The analytics `where`** (`/analytics/query`, `/analytics/sql`, dataset filters): `NativeSQLStrategy` and the `ObjectQLStrategy` SQL echo compile the field's declared row; the ObjectQL execute path hands `{ $empty }` to the data engine, which answers it once the engine's own arm lands (until then the engine refuses it, `INVALID_FILTER` / 400, as it does today).
  - **Row-level read scopes** compiled to SQL (`compileScopedFilterToSql`): same rows, in the read-scope envelope.
  
  A multi-value field's empty list is tested with a JSON function per SQL dialect (`json_array_length` on SQLite, a `jsonb` comparison on Postgres, `JSON_LENGTH` on MySQL).
  
  **Refused, never guessed** — `INVALID_FILTER` / 400 on the `where` face, `READ_SCOPE_COMPILE_FAILED` / 500 on a read scope — when the host cannot name the field's declared type (no `sourceFieldMeta` wired, or no such field), when a multi-value field's datasource dialect is unknown, and when the flag is not a boolean (`$empty: 'true'` is refused like a non-boolean `$null`).
  
  Host API (two new optional members, hence `minor`): `AnalyticsServiceConfig.sourceFieldMeta` may now answer `multiple` beside `type`, and `AnalyticsServicePlugin` relays it from the field definition; `compileScopedFilterToSql` takes an optional `declaredValueShape` option. A host whose `sourceFieldMeta` answers `type` but not `multiple` has every multi-capable field it declared `multiple: true` (select / radio / lookup / user / file / image) read as single-valued, which is the null-only row. On such a field a read scope's `$empty: false` then admits rows holding `[]`, and `$empty: true` misses them. Relay the field's `multiple` from its definition to get the list row.
  
  `$empty` stays staged: it is not in `FILTER_OPERATORS`, and the view operators `is_empty` / `is_not_empty` still lower to `$null`.
- 0da638c: fix(analytics)!: every analytics face lowers the closed `dateRange` preset vocabulary to one window and refuses the rest with `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` (#16322)
  
  <!-- adr-0087: not-required (already-registered analytics-time-dimension-date-range-vocabulary-closed) the driver half of #16041 implements the migration that card registered; the accept set narrowed at the contract there, and the prescription an author needs is that entry's, unchanged -->
  
  **BREAKING** for an in-process caller that reaches an analytics face PAST the
  schema door with a string the closed vocabulary does not contain: it used to be
  answered, and is now refused. Shipped as `minor` under the repo's launch-window
  convention. The driver half of #16041, whose spec change closed
  `AnalyticsQuery.timeDimensions[].dateRange`'s string arm to the thirteen
  dashboard preset names; every value affected here was already refused at
  `POST /analytics/query` and `/analytics/sql` when that landed.
  
  ## What was wrong
  
  #16041 closed the contract; the faces behind it never aligned, so the defect it
  abolished simply moved onto the newly-blessed vocabulary. Measured on the built
  `driver-memory` dist over five probe rows (2020, 2026-08-31, 2026-09-05, now,
  2099):
  
  | input | before | after |
  |:--|--:|--:|
  | `today` | 1/5 | 1/5 |
  | the other twelve declared presets | **5/5 — 2020 and 2099 included** | a real window each |
  | `'not a range at all'`, `'Last 7 Days'` | 5/5 | `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` |
  
  `driver-memory` recognised exactly `today`: every snake_case preset missed its
  `startsWith('last ')` branch and fell to a `[range, range]` pseudo-window whose
  two bounds were the preset's own NAME, which matched every `Date`-typed row
  under BSON cross-type ordering. Both `service-analytics` SQL strategies lowered
  the same names — and unrecognised strings, and `today` — to the point window
  `created_at >= 'last_30_days' AND created_at <= 'last_30_days'`, whose answer is
  whatever the dialect decides a vocabulary word compares as. So a dashboard
  asking for one month got all of history on one backend and a nonsense
  comparison on the other, at HTTP 200 on both.
  
  ## What it does now
  
  - **One lowering, in `@objectstack/core`.** `resolveAnalyticsDateRangePreset` /
    `resolveAnalyticsDateRangeString` resolve every declared preset to
    `{ start, end, endExclusive }`. The window is a pair of `{date-macro}` tokens
    handed to the existing macro resolver, so `dateRange: 'this_month'` and a
    `{month_start}` filter token cannot answer differently, and the anchoring on
    `AnalyticsQuery.timezone` (#16042) plus the one-calendar arithmetic (#15825)
    come from that resolver rather than from each face.
  - **One refusal.** `analyticsDateRangeUnrecognizedError` stamps the ADR-0112
    envelope `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED` with the spec's own
    `analyticsDateRangeRefusalMessage` wording — the same sentence the schema door
    answers with. `driver-memory`, both SQL strategies and the draft-preview evaluator call
    it, so "memory and SQL refuse identically" is one function rather than an
    agreement.
  - **The upper bound keeps #16179's separation.** A window a face RESOLVED is
    compared exclusively (`$lt` / `<`) for the ten calendar presets and
    inclusively for the three rolling `last_N_days`, whose bound is NOW; an
    explicit `[a, b]` a CALLER wrote is untouched and keeps `$lte`.
  - The fifteen `driver-memory` date-range pins #16041 retired are reinstated in
    preset form (DST cells re-measured under calendar semantics, not re-spelled),
    and one cross-face conformance fixture holds all FOUR faces to the same
    windows and the same refusal.
  - **The draft-preview evaluator is the fourth face**, and it is in that fixture
    for the same reason the other three are. `preview-evaluator.ts` (ADR-0037 P3 —
    the Live Canvas preview over a pending seed draft) carried the identical
    `[range, range]` fallback, so a valid `last_30_days` selected NOTHING there,
    silently, while the published chart beside it answered a real window — across
    a publish boundary the preview exists to make continuous, since publish
    materialises the same seed.
  
  ## FROM → TO
  
  Unchanged from #16041's — the spelling that is refused here is the spelling that
  was already refused at the door.
  
  | you wrote | write instead |
  |:--|:--|
  | `dateRange: 'Last 7 days'` / `'last 7 days'` | `dateRange: 'last_7_days'` |
  | `dateRange: 'last 3 months'` | `dateRange: 'last_90_days'`, or an explicit `['{90_days_ago}', '{today}']` |
  | `dateRange: '2026-01-20'` (the SQL single-day dialect) | `dateRange: ['2026-01-20', '2026-01-20']` |
  | `dateRange: ['2026-01-01', '2026-01-31']` | unchanged |
  
  The `@objectstack/spec` entry is a `PROVENANCE_WAIVERS` row only: the refusal's
  code stays registered under `@objectstack/runtime` (the door that names the wire
  vocabulary), and the waiver records that the shared constructor spelling it
  lives one package over.
- 041d9fd: fix(service-analytics)!: `POST /analytics/dataset/query` asks the OBJECT-level read grant before it serves an inline dataset (#16645)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: no `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every dataset, dashboard and analytics request body parses byte-identically to before — so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. What narrows is the ACCEPT SET of a published route at REQUEST time: `POST /analytics/dataset/query` (and the `/analytics/query` and `/analytics/sql` doors) now refuse a caller who holds no object-level read grant on an object the request reads, which is the same verdict `GET /data/<object>` already returns for that caller on that deployment. The remedy for a caller who is refused is a GRANT, held in permission-set data rather than in an authored file: the deployment gives the principal read on the object, exactly as it must today to use `/data`. There is no authored artifact and no stored representation for a migration to act on, and the additions to the contract are additive (a new OPTIONAL `ISecurityService.canReadObject`, new optional keys on three option payloads), which is a widening rather than a retirement. -->
  
  **BREAKING** in the accept-set sense — an accept-set narrowing on a published
  route — landing in the launch window as `minor` on all four packages (the
  lockstep convention: during the window the bump level is not the carrier, this
  banner and the disposition above are). Nothing that was already admitted
  becomes refused **except** the requests `GET /data/<object>` refuses today for
  the same principal, which is the defect, and every analytics read on a
  deployment that registers no `security` service (below). Nothing that was
  refused becomes admitted.
  
  `POST /analytics/dataset/query` now asks the OBJECT-level read grant before it serves an inline dataset, so the analytics door and `GET /data/<object>` reach one admission verdict on every driver.
  
  The route accepts an inline dataset definition (`body.dataset`) from any authenticated caller. On a SQL driver the compiled statement ran through the driver's raw `execute()`, which is documented as a tenant-isolation bypass and which no middleware sits in front of — so the request reached the database having passed exactly ONE of the three read layers (the row scope, threaded since ADR-0021 D-C). A caller with **no grant of any kind** on an object received its row count, and with `dimensions` its grouped counts by any column, where the `/data` door answered `403 PERMISSION_DENIED` for the same principal on the same deployment. On the memory driver the identical request fell through to the ObjectQL engine, which applies all three layers in one place, and was refused. The exposure is not opt-in and an application cannot decline it: a deployment shipping 0 datasets and 0 dashboards has the identical surface, because the reachable slot is the inline definition rather than a declared one.
  
  **This change NARROWS what the analytics doors accept.** Requests that were already refused by `/data` are now refused by analytics too; nothing that was refused becomes admitted. A deployment with no `security` service registered is refused too, fail-closed: `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, so the bridge below gets no verdict and denies, naming the object. `/data` carries no object-level gate on that deployment, so there analytics refuses reads that `/data` serves. A composition that wants analytics to answer registers a security service, or its host supplies its own `admitObjectRead`.
  
  - **`ISecurityService.canReadObject(object, context)`** (`@objectstack/spec`, optional) — the object-level half of a read, the sibling of `getReadFilter`'s row-level half. It exists because the two are not interchangeable: `getReadFilter` answers "which rows" and answers `undefined` — "no row restriction" — for a caller who may not read the object at all, so a door holding only the filter reads a caller with NO grant as a caller with NO restriction. Fails CLOSED. Absence is a defined state and its fallback is **not** "admit": a consumer composes the same verdict from `explain`, which is not optional.
  - **`@objectstack/plugin-security` implements it** as the middleware's own read gate, arm for arm and in its order — the `isSystem` bypass, the "no permission sets resolved" skip, the #3545 fail-closed refusal on an unresolvable object posture, the ADR-0066 D3 `requiredPermissions` capability AND-gate, the `allowRead` CRUD grant, and the ADR-0090 D10 delegator intersection — from the same primitives the middleware calls, and it is exposed on the registered `security` service.
  - **`@objectstack/service-analytics` asks it once at the door**, for the base object and every joined object, **ahead of strategy selection**. Placement is the fix: two strategies each enforcing their own copy of three layers is the CAUSE of the divergence, not its remedy, so both strategies — and any strategy added later — inherit one verdict by construction. `AnalyticsServicePlugin` auto-bridges the new `admitObjectRead` hook to the `security` service (`canReadObject`, falling back to `explain`), the same way it already bridges `getReadScope`, and warns loudly at init when no security service is registered. The bridge tells three resolutions apart: a context that answers the `security` lookup with nothing (ABSENT) admits, and no in-repo kernel answers that way; a service that cannot be USED — resolving it throws, or it exposes neither `canReadObject` nor `explain` — DENIES and reports at `error`. Resolving it throws on `ObjectKernel` and `LiteKernel` when no `security` service was ever registered, so a deployment that ships no `plugin-security` (or any other security service) is refused here, although `/data` carries no object-level gate on it; for a wired service that cannot be used, `/data`'s middleware does not fall open either.
  - **`@objectstack/verify`** gains `bootStack(app, { databaseDriver: 'sqlite-wasm' | 'memory' })`, because a two-driver equivalence property cannot be measured on one driver — which is how the strategies were allowed to disagree.
  
  The refusal is `PERMISSION_DENIED` / 403, the same code and status the engine path already answers, and it names only the object the caller themselves named.
  
  *Erratum, 2026-10-08 — this entry said that a deployment with no `security` service registered "keeps its previous analytics behaviour by design", that "an ABSENT `security` service admits", and that this "keeps a deployment shipping no `plugin-security` working as before". The sentences were false when published: in the published 17.5.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, so the bridge took its cannot-be-USED branch and refused the query, fail-closed. ABSENT is reached only by a context that answers the lookup with nothing, and no in-repo kernel does. Two passages above are corrected in place and the BREAKING banner now names that deployment among the requests that become refused; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 5d12b16: fix(service-analytics): the ROW-SCOPE bridge to the `security` service tells the same three resolutions apart as the object-level one — a broken security service refuses the query instead of running it with no row policy (#16918)
  
  `AnalyticsServicePlugin` bridges to the `security` service twice: once for the OBJECT-level read grant (`admitObjectRead` → `canReadObject`, #16645) and once for the ROW-level read scope (`getReadScope` → `getReadFilter`, ADR-0021 D-C). The object-level bridge tells three resolutions apart — ABSENT (the context answers the lookup with nothing; no in-repo kernel does) admits, THROWING (on the in-repo kernels that includes a `security` service nothing ever registered) and METHOD-LESS deny at `error`. The row-scope bridge collapsed all three into one:
  
  ```ts
  const trySecurity = () => {
    try {
      const svc = ctx.getService<SecurityReadFilter>('security');
      return svc && typeof svc.getReadFilter === 'function' ? svc : undefined;
    } catch { return undefined; }
  };
  getReadScope = (object, context) => trySecurity()?.getReadFilter(object, context);
  ```
  
  A throwing resolver and a registered service without `getReadFilter` both produced `undefined` — the same value an absent security service produces, and the value `ISecurityService.getReadFilter` reserves for one meaning only: *"this caller has no row restriction on this object"*. So on a deployment whose security service was wired but broken (a boot-order fault, a mis-registered plugin, a failing dependency, a provider that is not the contract it claims to be) analytics queries ran with **no row-level policy at all**, and nothing said so. One door of the file failed closed on a throwing resolver and its neighbour failed open — and the neighbour is the one carrying row-level policy.
  
  **What changes.** The bridge now resolves the same explicit three-way, at the same reporting level:
  
  - **ABSENT** — the context answers the `security` lookup with nothing: **unchanged**, no row-scope provider. No in-repo kernel reaches this row: `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, so a kernel that ships no `plugin-security` takes the THROWING row below and is refused; the object-level gate of the same release refuses its query first.
  - **THROWING** resolver, or a registered service with **no `getReadFilter`** — the query is **REFUSED**, and the reason is reported at `error` naming the object and which of the two states it was. The refusal is a throw, which `AnalyticsService.resolveReadScopes` — fail-closed since ADR-0021 D-C — already turns into "deny the whole query rather than emit SQL with that object unscoped". A log over an `undefined` would not have been a refusal.
  
  **This change only NARROWS what analytics serves, and only in a state where the security service is broken.** No deployment with a working `security` service changes behaviour by so much as a byte. A deployment with none counts as broken here on the in-repo kernels, whose lookup throws on a never-registered name, so it is refused too — though the object-level gate of the same release refuses its queries first. Nothing that was refused becomes admitted.
  
  **No published-surface delta.** No new error code (the refusal rides the seam's existing fail-closed error), no exported symbol, no key on `AnalyticsServicePluginOptions` or any payload, and no documented envelope changes shape. Graded `minor` rather than `patch` because it is a behaviour narrowing on a published package's read path, matching how its object-level sibling was graded in the same lockstep window.
  
  ⚠️ Deliberately **not** answered here: which tenant wall the platform's is (plugin-security's posture-gated Layer 0, or driver-sql's posture-independent auto-scope) — the escalated maintainer decision of triage condition 5. Refusing to serve is neutral between them: it answers *"should we serve at all"*, never *"what shape is the wall"*.
  
  *Erratum, 2026-10-08 — this entry described an ABSENT `security` resolution as "a legitimate configuration (a single-tenant kernel that ships no `plugin-security`, …)" that stays **unchanged** and is "Deliberately not tightened", and said "no deployment with none, changes behaviour by so much as a byte". The sentences were false when published: in the published 17.5.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, so such a kernel took the THROWING row and was refused. Three passages above are corrected in place; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- 634f23d: fix(analytics)!: `AnalyticsServiceConfig.sqlDialect` declares its three-name accept set, and a host that answers outside it is told once (#16206)
  
  <!-- adr-0087: not-required (runtime-interface-only packages/services/service-analytics/src/analytics-service.ts#AnalyticsServiceConfig) The narrowed member is one hook on a service CONSTRUCTOR CONFIG — a published runtime TypeScript interface with no metadata surface. It has no Zod schema, no `packages/spec` declaration and no stored representation, so `objectstack migrate meta`, `spec-changes.json` and the generated upgrade guide have nothing to rewrite; the affected party is a TypeScript host and the channel that reaches every one of them is the compiler at their own composition site. No metadata key is added, removed, renamed or re-shaped, and `packages/spec` is untouched by this diff. -->
  
  **BREAKING** for a TypeScript host that declares its `sqlDialect` hook as returning
  `string`: the hook's declared return is now the three canonical dialect names or
  `undefined`, so such a composition stops compiling until the host's own annotation
  says which names it can answer. Shipped as `minor` under the repo's launch-window
  convention, in which breaking-ness is carried by this banner and the disposition
  above rather than by the bump level. Runtime behaviour for every host is unchanged:
  the same three names were the only ones that ever did anything.
  
  ## What was wrong
  
  `AnalyticsServiceConfig.sqlDialect` — the hook a host answers to say which SQL
  dialect backs an object — was typed as free `string`, while `normalizeSqlDialect`
  has only ever recognised `sqlite`, `postgres` and `mysql`. Nothing said so, and
  nothing told a host that answered otherwise.
  
  So a host that owns a SQLite datasource and answers the spelling its own stack uses
  — knex's canonical `sqlite3`, or `better-sqlite3`, both of which `driver-sql` itself
  lists in `SQLITE_EMIT_CLIENTS` — was read as `unknown`. And because `sqlDialectFor`
  is tiered "cannot answer, do not block", **a wrong answer and no answer were the
  same answer**: the host that tried hardest to help got the residue arm, silently.
  
  ## What it does now
  
  - **The vocabulary is declared**, on the type and in the docblock, as
    `AcceptedSqlDialect` — `sqlite` | `postgres` | `mysql` — so a host reading the
    config learns the accept set without running anything. The type and the runtime
    membership set are generated from one `const` tuple, so a future widening cannot
    land in one and miss the other.
  - **A non-empty answer outside the set is diagnosed**: one `warn` naming the object,
    the answer and the accepted set. It is emitted **once per distinct unrecognised
    spelling** — the failure's identity — so the line count is bounded by the host's
    own hook and never grows with query volume.
  - **`undefined` stays silent and legal.** The hook is optional and "cannot answer,
    do not block" is a supported composition, not a misconfiguration. A pin holds both
    halves, because a diagnostic that also shouted at hosts who wired nothing would be
    a worse defect than the one being fixed.
  - **The accept set is NOT widened.** Teaching this package `driver-sql`'s knex
    aliases would be a second copy of that driver's table, and an unrecognised
    spelling is sometimes deliberate (`mariadb`, #11756). The answer is still read as
    `unknown`; only the silence changed.
  - **The plugin bridge translates the driver's own residue.** `SqlDriver.dialectName`
    carries a fourth name, `unknown`, meaning "I cannot say"; handed on verbatim it
    would have presented a correctly-behaving driver as a host answering out of
    contract. It now arrives as `undefined`, this hook's own spelling for the same
    thing. The dialect the compilers end up with is unchanged either way.
  
  ## Measured, and worth reading before relying on the residue arm
  
  Driven on sql.js through a host answering `sqlite3`, against the shared
  `FILTER_TEXT_CASES` fixture, with a host answering `sqlite` as the control: **five of
  the six case-EXACT cases come back with the wrong rows** — every case that
  discriminates on ASCII case. `{ name: { $contains: 'acme' } }` answers `['1','2']`
  where the table says `['2']`, and the negated form DROPS a row that belongs in the
  result. That is #15684's fold, live on the arm this population lands on, and it is
  reported rather than fixed here: closing it is that card's business, not this one's.
- 357f499: feat(service-analytics)!: a dataset measure whose `aggregate` its `field`'s declared type cannot carry is refused at compile time with `400 DATASET_INVALID` (#16737, compile leg of #16099)
  
  <!-- adr-0087: registered dataset-measure-aggregate-field-type-refused -->
  
  **BREAKING** — an accept-set narrowing on a published authoring surface. A dataset
  measure pairing `aggregate: 'avg'` with a `Field.datetime` used to compile to
  `AVG(col)` and reach the backend; it is now refused by `compileDataset` before any
  query is built. Shipped as `minor` under the repo's launch-window convention for
  accept-set narrowings; the hand-migration prescription is registered under protocol
  major 18 as `dataset-measure-aggregate-field-type-refused`.
  
  The pair is judged against `AGGREGATE_FIELD_TYPE_COMPATIBILITY` — the one table
  `@objectstack/spec` declared in #16353 under the director ruling of decision batch
  #59 (2026-09-06, "both legs, table in spec"). ⛔ This changeset adds no rows and
  restates none: the refusal reads the shipped predicate, so the contract has exactly
  one statement.
  
  ## What was wrong
  
  The answer to `AVG` over a temporal column was decided by the SQL dialect rather
  than by the data. Both halves measured on this card:
  
  ```
  -- SQLite (better-sqlite3), the canonical UTC-text storage form (#3912)
  select typeof(submitted_at), submitted_at from clm_contract limit 1;
    text|2026-05-19T00:00:00.000Z
  select avg(submitted_at) from clm_contract;
    2025.5                    <- text->numeric coercion: the average YEAR
  
  -- PostgreSQL 16.13
  select avg(submitted_at) from t;
    ERROR:  function avg(timestamp with time zone) does not exist   -- SQLSTATE 42883
  ```
  
  The silent half is the dangerous one, and SQLite is the default dev datasource:
  `derived: { op: 'difference', of: [avg_a, avg_b] }` over two such averages returned
  `-0.85` and rendered on a tile labelled "average cycle time delta" — a number
  indistinguishable from a correct one. Nothing refused it at any layer: not the
  schema, not `os validate` / `os lint`, not the analytics service, not the renderer.
  
  ## What it does now
  
  - `compileDataset` refuses an incompatible `aggregate` × `field` pair with
    `DATASET_INVALID` / **400**, naming the measure, the field, its declared type and
    the accepted set (read off the table, never restated). Nothing reaches the driver.
  - It reads the declared type from the `sourceFieldMeta` a host already wires, via a
    new optional `DatasetCompileOptions.declaredFieldType` probe.
  - **`derived` is covered by construction.** A derived measure's `of` operands are
    base measures of the same dataset, so a dataset carrying a refused base measure
    never finishes compiling and no `derived` op can be handed its output — including
    when the selection names only the derived measure.
  - Tiered "cannot answer, do not block" like every sibling probe: no
    `sourceFieldMeta`, an unresolvable field, or a `relationship.field` path (whose
    column lives on a joined object) leaves the pair unjudged.
  
  ## ⚠️ Scope: the compile leg executes the TEMPORAL rows only
  
  > ⚠️ **Superseded within the same release window.** This section was accurate when it was
  > written and is kept as the record of where the compile leg stopped. Two later cards
  > widened it before any of the three entries shipped, so at the version that compiles this
  > entry the scope below is no longer the platform's: **#16099** judged `sum` / `avg` over
  > every remaining field class (including `sum` over a `percent`), and **#17560** (director
  > ruling, decision batch #127, 2026-09-13) judged `min` / `max` over every class the table
  > refuses. ⇒ Three sentences in this section are false at that version and are corrected
  > where they stand: the string rows are **not** awaiting a table amendment, `sum` over a
  > `percent` does **not** compile as it did before, and `avg` / `sum` over a temporal field
  > are **not** the only pairs whose behaviour changes. Read all three entries together.
  
  The gate judges only a measure whose field is declared `date` / `datetime` /
  `time`; a field of any other class is never handed to the predicate. The
  verdict for the pairs it does judge is the table's — no row is restated — but
  which FIELDS are judged is narrower than the table, on purpose:
  
  - **String rows** (`min` / `max` over `text`, `select`, `lookup`,
    `autonumber`, …) are **not enforced here**. ⚠️ This card recorded them as
    「under #16785, **ruled C** — the table itself is to be amended to accept
    them」, because `measureResultType` (#15768) already typed those results as
    `'string'` and pinned them end to end, so enforcing them from here would
    pre-empt that ruling. **Both halves of that sentence turned out to be
    wrong.** `16785` resolves to no issue, and decision batch #127 (#17560,
    2026-09-13) found no ruling C anywhere behind the citation — the one recorded
    ruling on this table, decision batch #59, refuses the string rows. ⛔ The
    table is **not** amended; #17560 enforces those rows and retires the
    `measureResultType` opinion that disagreed with them.
  - **Boolean rows** are not a refusal at all any more: #16685 was ruled A and
    #16750 added `boolean` / `toggle` to `sum` / `avg` / `min` / `max`, so the
    table ACCEPTS them and this gate never judged them.
  - The table's `sum` × `percent` row is likewise **not** executed by this leg;
    `sum` over a `percent` compiles exactly as it did before. ⚠️ True of this
    card only — #16099 executes that row in the same release.
  
  ⇒ The only pairs whose behaviour changes **because of this card** are `avg` /
  `sum` over a `date` / `datetime` / `time` field. ⚠️ ⛔ Not a statement about the
  release: the full-table leg is #16099's and landed, and the `min` / `max` leg is
  #17560's and landed, so at the shipping version every pair the table refuses is
  refused at the compile door.
  
  ## FROM → TO
  
  | you wrote | write instead |
  |:--|:--|
  | `{ aggregate: 'avg', field: <a date/datetime/time field> }` | `{ aggregate: 'min' \| 'max', field: <same> }` — a real instant of the field's own type |
  | `{ aggregate: 'sum', field: <a date/datetime/time field> }` | store the duration as a number (a computed "days open" field) and `sum`/`avg` that |
  | `derived: { op: 'difference', of: ['avg_a', 'avg_b'] }` over temporal averages | fix the two operand measures; the `derived` spec itself is unchanged |
  
  ⭐ A duration is not recoverable from an aggregate over instants on any backend.
  Where an "average cycle time" is wanted, the cycle length has to exist as a number
  before it can be averaged.
  
  ## What is deliberately untouched
  
  `date` / `datetime` used as a **dimension** — grouping, bucketing, date-range
  filtering — is unchanged; this is about aggregation only. `avg` over a genuine
  numeric measure, `min` / `max` over a temporal one, and `count` / `count_distinct`
  over anything all behave exactly as before.
  
  ⚠️ **Two faces stay uncovered, deliberately.** The refusal lives in
  `compileDataset` and reads a `declaredFieldType` probe, so it applies only where
  a host wires one: `/analytics/query` — the non-dataset face, whose measures a
  Cube infers rather than an author declaring them — is NOT covered, and neither
  is any other `compileDataset` caller that passes no probe (those stand down
  unjudged rather than guessing). Closing those is #16099's, not this card's.
  
  Alongside the refusal, `service-analytics`' contradictory annotations about what a
  SQLite `Field.datetime` column physically holds are reconciled to one statement —
  **seven** source sites plus two test narratives, not the four the card quoted. Some
  said the column holds an INTEGER epoch and ISO TEXT at once; one said flatly that it
  IS an INTEGER epoch. Neither is current: since #3912 the column has ONE
  storage form, canonical UTC text, with the epoch surviving only in a database not
  yet converged by `backfillCanonicalDatetimes`. The fact is now stated once, on
  `AnalyticsServiceConfig.coerceTemporalFilterValue`, and the other sites link to it.
  No behaviour changes from that half.
- 3c557e2: **The published `DimensionLabelDeps` type (re-exported from this package's `index.ts`) gains
  one new optional key, `translateSelectOptions`** — the surface the level is graded against,
  per the same "a new key on a published exported type is the mechanical floor for clause ②"
  rule #16778 shipped under. Backward compatible (optional, additive, no removed/renamed key,
  no wire-shape change), so `minor` rather than `major`.
  
  A dataset's `select`-field dimension now renders its option label in the request's locale on
  a dataset-backed chart, matching what `GET /meta/object/:name` (and hence the console's list
  grid) already renders for the identical field.
  
  `dimension-labels.ts` resolved a select dimension's category label straight out of field
  metadata's authored `options[].label` — always the author's own-language text, since
  `SelectOptionSchema.label` is a plain string, never an inline locale map. The dotted
  cross-object arm (`field: 'contract.direction'`) was unaffected: a relationship-path field
  name never matches a key in the BASE object's own field map, so `resolveDimensionLabels`
  skips it via `if (!meta) continue` before either branch runs — this fix changes nothing on
  that path, and a regression test now pins that it is never even consulted.
  
  `DimensionLabelDeps` gains one new optional capability, `translateSelectOptions`, which the
  plugin bridge (`plugin.ts`) implements by calling `translateObject` (`@objectstack/spec/system`)
  — the SAME translator the object-metadata REST endpoint already uses — against the
  deployment's i18n bundle, when an `i18n` service is registered. No new export, no new spec
  key, no wire-shape change: `AnalyticsResult` carries the same `rows`/`fields` shape as before,
  and a kernel with no i18n service configured (or nothing for the requested locale) falls back
  to exactly today's authored-label text.
  
  A future widening of `LOOKUP_TYPES` (#16390) does **not** automatically inherit this: lookup /
  master_detail labels resolve through the separate `fetchRecordLabels` capability (a related
  RECORD's display name, not a field's authored `options[]`), which this change does not touch.
  It does lower the cost of adding translated lookup-record labels later, though — the i18n
  service bridge (`plugin.ts`'s `i18nService()` / `buildTranslationBundle()`) is now already
  wired into this package and is a `ctx.getService('i18n')` away from reuse.
- e66da5c: feat(service-analytics)!: a dataset measure applying `sum` or `avg` to a field whose declared type cannot carry it is refused at compile time, for every field type and not only the temporal class (#16099)
  
  <!-- adr-0087: not-required (already-registered dataset-measure-aggregate-field-type-refused) the hand-migration prescription for this exact narrowing is already registered under protocol major 18 by #16778 — store the quantity as a numeric field and aggregate that — and this change widens which pairs reach it without changing what an affected author must do. ⚠️ That entry's `acceptanceCriteria` is scoped to a `date`/`datetime`/`time` field and says a field of any other class is "neither refused nor certified by this leg", which is no longer true at HEAD; widening that sentence is a `packages/spec` edit this card is fenced out of and is reported to the `domain:spec` seat rather than done here. -->
  
  **BREAKING** — an accept-set narrowing on a published authoring surface, continuing the
  one #16778 began. A dataset measure pairing `aggregate: 'sum'` with a `text` field (or
  `avg` with a `select`, `json`, `lookup`, `formula`, … field) used to compile and reach
  the backend; it is now refused by `compileDataset` with `DATASET_INVALID` / **400**
  before any query is built. Shipped as `minor` under the repo's launch-window convention
  for accept-set narrowings.
  
  ⛔ This changeset adds no rows to any table and restates none. The verdict is
  `AGGREGATE_FIELD_TYPE_COMPATIBILITY`'s — the one table `@objectstack/spec` declared in
  #16353 under the director ruling of decision batch #59 ("both legs, table in spec") —
  read through `isAggregateCompatibleWithFieldType`.
  
  ## What was wrong
  
  #16778 landed the compile leg SCOPED to temporal source fields, leaving "every other
  non-temporal pair the table refuses" as a stated residual that had never been driven.
  Driven on this card, through the real service door:
  
  ```
  sum × text    the table refuses the pair   the compile leg does NOT throw   SQL IS emitted
  sweep         6 aggregates × 49 field types = 294 pairs; 155 refused by the table;
                minus 6 temporal (#16778's) minus 42 `min`/`max` × the string classes;
                residual 107 — and 107 of 107 were ACCEPTED by the compile leg
  control       avg × datetime / date / time → DATASET_INVALID / 400, no SQL emitted
  ```
  
  The control is what makes that a reading of the tree rather than of a blind harness: the
  same service, door and `sourceFieldMeta` hook sees the pairs #16778 enforces refused.
  
  So `sum` over a `text` column reached whichever backend the object is bound to, and the
  answer was a property of the dialect rather than of the data — the shape Prime Directive
  #12 exists to remove, and the same shape #16778 closed for one field class.
  
  ## What it does now
  
  - `compileDataset` judges a measure whose aggregate DERIVES a number (`sum` / `avg`)
    against the table for **every** declared field type, and refuses an unaccepted pair
    with `DATASET_INVALID` / **400** — naming the measure, the field, its declared type
    and the accepted set read off the table. Nothing reaches the driver.
  - `sum` × `percent` is refused at last: the row `analytics-service.ts` has called
    "incoherent" in a comment since before the table existed. `avg` × `percent` is still
    ACCEPTED by the same table, which is what makes it a row and not a class.
  - The refusal's closing prescription is now chosen by the source field's class: the
    temporal sentence #16778 measured is kept verbatim for temporal fields, and a
    non-numeric field is pointed at `count` / `count_distinct`, which accept every type
    because they read no arithmetic off a value.
  - Unchanged: `derived` is covered by construction (a dataset carrying a refused base
    measure never finishes compiling), and the three "cannot answer, do not block" tiers —
    no `sourceFieldMeta`, an unresolvable field, a `relationship.field` path.
  
  ## ⚠️ Scope: the DERIVING aggregates — and see #17560, which closed the other half
  
  > ⚠️ **Superseded within the same release window.** This section was accurate when it was
  > written and is kept as the record of why this change stopped where it did. #17560
  > (director ruling, decision batch #127, 2026-09-13) then judged `min` / `max` too, so at
  > the version that ships this entry **every** pair the table refuses is refused at the
  > compile door. Read that entry beside this one.
  
  `min` / `max` SELECT one of the stored values; `sum` / `avg` DERIVE a number. This is the
  line this package already draws — `measureResultType` branches on exactly that pair of
  aggregates — and the defect is about a derived number, so the deriving aggregates are its
  population.
  
  The `min` / `max` rows stayed with the table-amendment card (then **#17513**, since closed
  as a duplicate of **#17560**, which ruled and landed them), and that is measured rather
  than assumed.
  Enforcing the residual whole was tried on this card: with `min` / `max` × the string
  classes subtracted, **15** cases in `measure-result-type.test.ts` still went red, every
  one of them on `min` × `json` — a pair the table refuses, in no ruling's scope, driven
  end to end by the same shared fixture as the string rows. One dataset compiles every
  measure in that fixture, so one refused pair reds the whole section. ⇒ `min` / `max` is
  one question, and it is the table-amendment card's.
  
  ## Upgrading — FROM → TO
  
  Nothing an author writes is removed or renamed: `DatasetMeasure.aggregate` and
  `DatasetMeasure.field` keep their spellings and their types. What narrows is which PAIRS of
  values are accepted. The one-line fix, per shape:
  
  | FROM (compiled before, refused now) | TO |
  |---|---|
  | `{ aggregate: 'sum', field: <a text / select / lookup / user / autonumber field> }` | `{ aggregate: 'count_distinct', field: <the same field> }` — counting reads no arithmetic off the value |
  | `{ aggregate: 'sum' | 'avg', field: <a json / file / location / vector / composite field> }` | store the quantity you meant as its own numeric field and aggregate that |
  | `{ aggregate: 'sum', field: <a formula field> }` | aggregate the formula's numeric INPUT column; a `formula` is virtual in SQL storage, so no arithmetic aggregate can be lowered to it |
  | `{ aggregate: 'sum', field: <a percent field> }` | `{ aggregate: 'avg', field: <the same field> }` — a rate averages, it does not add |
  | `{ aggregate: 'sum' | 'avg', field: <a date / datetime / time field> }` | unchanged from #16778: use `min` / `max` for a real instant, or store a duration as a number and aggregate that |
  
  `min` / `max` are **not** affected by this change at all, over any field type.
  
  No shipped dataset in this repository declares a newly-refused pair — every one of the
  eleven shipped dataset measures resolves to `number`, `currency`, `summary` or `progress`.
  The refusal names the accepted set for the aggregate, read off the table.
- 51efbf1: feat(driver-sql)!: a text operator over a column whose DECLARED type is temporal answers the type-gated no-match on every SQL face (#15683)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed. No `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every object definition and filter body parses byte-identically to before — so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. What changes is the ANSWER a published filter surface gives at request time: a text operator aimed at a `date` / `datetime` / `time` column returns the declared no-match instead of the ISO-substring match SQLite happened to give it. The remedy for a caller who was leaning on that match is a different FILTER — the range operators, which are data the caller holds rather than an authored artifact with a stored representation — and it is spelled in the banner below. The one spec change is the membership of an existing exported set (`NON_TEXT_STORED_VALUE_TYPES`), which adds no export and removes none. -->
  
  **BREAKING** in the answer sense, on every SQL face, landing in the launch
  window as `minor` under the lockstep convention this cluster's siblings use.
  
  **The behaviour that GOES AWAY, by name: searching a date as a string.** On the
  SQLite family — `driver-sql` on any SQLite connection, `driver-sqlite-wasm`, and
  `driver-turso`'s local transport — a `Field.date` / `Field.datetime` /
  `Field.time` column stores canonical ISO TEXT (ADR-0053), and a text operator
  matched that text. `{ signed_on: { $contains: '2026' } }` returned every 2026
  row; `{ made_at: { $startsWith: '2026-01' } }` returned that January's rows;
  `{ shift_at: { $contains: ':30' } }` returned every half-past shift. **All three
  now return nothing**, and their `$notContains` mirrors now return every valued
  row. If you are relying on any of them, this is a row-set change and the
  replacement is a range filter — spelled out below. The behaviour was never
  declared by any contract row and it never worked outside SQLite: the same three
  filters were a `DATABASE_ERROR` 500 on live Postgres.
  
  Nothing that was refused becomes admitted, and no new error code is minted — the
  refusal reused is the one `NON_TEXT_STORED_VALUE_TYPES` already carried for the
  numeric and boolean classes.
  
  Maintainer ruling, 2026-09-05 on #15683, quoted rather than paraphrased:
  「a text operator over a column whose DECLARED type is temporal is type-gated
  exactly like the numeric and boolean classes; the SQLite ISO-text match is not
  a contract」.
  
  ## What was wrong — one filter, three answers across one driver family
  
  `{ on_day: { $contains: '2026' } }` over a column declared `Field.date` holding
  `2026-01-05`:
  
  | face | before | mechanism |
  |:--|:--|:--|
  | `driver-sql` / `driver-sqlite-wasm` / `driver-turso` local (SQLite) | **the row** | the column stores canonical ISO TEXT (ADR-0053), so `GLOB '*2026*'` matched it |
  | `driver-sql` on live PostgreSQL 16.13 | **`DATABASE_ERROR` 500** | `operator does not exist: date ~~ unknown` (SQLSTATE 42883) — the same for `timestamptz` and `time` |
  | `driver-sql` on MySQL | **NOT MEASURED** | no server was provisionable; reads as coercion via `CAST(col AS BINARY) LIKE` |
  
  Three answers to one filter, and no face declared which was canonical. The
  SQLite answer was the accident of a storage form, not a capability: the same
  query against Postgres was a 500.
  
  ## What it does now
  
  The three temporal classes join `NON_TEXT_STORED_VALUE_TYPES`
  (`@objectstack/spec`), the set the SQL compilers consult at compile time
  because the stored value is not visible until run time. Every face that reads
  it — `SqlDriver` (and everything that inherits its compiler),
  `driver-turso`'s remote transport, `service-analytics`' three SQL lowerings —
  compiles the positive operators (`$contains` / `$startsWith` / `$endsWith` /
  `$icontains` / `$like` / `$ilike`) to the FALSE constant and `$notContains` to
  the TRUE constant. Postgres's 500 becomes that declared answer; complementarity
  holds; the constants compose with the existing NULL-safe rules and the `$not`
  rewrite unchanged.
  
  **The SQLite ISO-substring match is RETIRED.** A caller who was using it to ask
  for "records in 2026" writes a range instead, which every dialect has always
  answered the same way:
  
  ```ts
  // before — matched only on the SQLite family, 500 on Postgres
  { on_day: { $contains: '2026' } }
  // after — the prescription, identical on every backend
  { on_day: { $gte: '2026-01-01', $lt: '2027-01-01' } }
  ```
  
  ## Boundaries, so a reader does not over-read this
  
  - **A MULTI-VALUED temporal field is untouched.** `multiple: true` stores a JSON
    TEXT array, where `$contains` is the MEMBERSHIP spelling #7398 left working on
    a JSON column — not a substring test. It keeps compiling exactly as before.
  - **The value-keyed JS evaluators do not move, and they DIVERGE — measured, not
    caveated.** `driver-memory` canonicalises a declared temporal write to ISO
    TEXT (#4047), for a `Date` input and a string input alike, so a positive text
    operator MATCHES there — the exact complement of the answer this changeset
    declares. That divergence is filed as #17348 and pinned by name in that
    driver's conformance suite, alongside a correction: the two rows previously
    read as pinning the no-match answer pass because their comparand omits the
    milliseconds, not because anything type-gates. `formula` and `having` cannot
    key on the declaration at all — `matchesFilterCondition(record, filter)` takes
    a bare record ("this evaluator sees a bare record and has no schema to
    consult", its own docblock), and `having` filters AGGREGATED rows whose columns
    carry no field declaration. ⛔ So "on every face" is NOT delivered by this
    change, and this changeset does not claim it: the SQL family answers the
    declared rule, the JS faces do not yet.
  - **`FILTER_TEXT_CASES` grows no temporal column**, deliberately. Every row there
    is keyed on the STORED value — which is why its non-string column is a number
    and not a date — so a temporal fixture would assert one stored form across all
    five drivers that import it, the stored-form guarantee the ruling refused
    option (b) for.
  - **MySQL is NOT MEASURED**, not "passing": no server was provisionable, so its
    cell rests on the compiled-shape pin, which reads the constant a statement
    would carry without executing one.

### Patch Changes

- 86c5052: fix(analytics): a `dateRange` array that is not a two-bound window is refused, once, instead of meaning three different things (#17124)
  
  `AnalyticsDateRangeSchema`'s array arm is a bare `z.array(z.string())` with no
  length constraint, so `dateRange: ['2026-01-01']` is schema-valid and reaches the
  analytics faces through `POST /analytics/dataset/query`, which types its selection
  from `AnalyticsQuery` and never Zod-parses it. The four faces in this package that
  read the arm answered it three different ways — measured over one authored
  document and four rows:
  
  | face | `['2026-01-01']` meant |
  |---|---|
  | `ObjectQLStrategy.dateRangeBounds` | the point window `created_at >= '2026-01-01' AND <= '2026-01-01'` |
  | `NativeSQLStrategy` | no time clause at all — the whole dataset |
  | the draft-preview evaluator | an upper bound of the string `"undefined"`, which every ISO date sorts below — everything from that day onward |
  | `DatasetExecutor`'s `compareTo` pass | the point window, shifted — compared against a primary pass that may have read all of history |
  
  For a dashboard that is one day's number, the whole dataset's, and everything
  from that day onward, from the same document, decided by which backend answered.
  `[]` and `[a, b, c]` split the same three ways, and `[null, null]` reached
  `parseUTC(null)` as a bare `TypeError` — a 500 for a malformed request.
  
  One rule is now the single reading of the arm and all four faces call it; the
  three divergent fallbacks are deleted. An array that is not exactly two string
  bounds is refused with the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400
  envelope — the answer the contract already gives for a `dateRange` that does not
  denote a window. A two-element window is untouched on every face, bound for
  bound, including the inclusive upper reading a caller's bounds keep (#16179) and
  the half-open bare-day widening on the SQL side (#3777).
  
  ### Write both bounds
  
  | wrote | write instead |
  |---|---|
  | `dateRange: ['2026-01-01']` | `dateRange: ['2026-01-01', '2026-01-01']` |
  
  That spelling already selects exactly that one day on every face, and it is the
  same instruction #16322 shipped for the single-day string dialect.
  
  ⭐ Shipped as `patch`, not as a breaking narrowing, because nothing DECLARED
  moves. The spec's own refusal wording already states that *"an explicit window is
  the two-element array [start, end] of ISO dates or {date-macro} tokens"*, and
  #16322's shipped migration table already told authors to write a single day as
  `['2026-01-20', '2026-01-20']`. A one-element array was therefore never a valid
  document; it was an invalid one that four faces answered arbitrarily, and a
  behaviour that was never one behaviour is not a behaviour this removes. The Zod
  type admitting the shape is weaker than the contract the same file states —
  tightening it is a separate, spec-owned question.
- 5ce3705: `DatasetSelectionSchema` — the ADR-0021 dataset selection is a Zod declaration now, and `POST /api/v1/analytics/dataset/query` parses the whole selection against it (#17551).
  
  `DatasetSelection` was a TypeScript **interface** with no Zod schema anywhere in the repo. PR #17548 doored that route, but only over the **seven** members the selection shares with `AnalyticsQuery`; the other **four** — `runtimeFilter`, `dateGranularity`, `compareTo`, `totals` — were declared in TypeScript, published in the api-surface, and enforced by nothing on the wire. The measured consequence is #17550: `compareTo: { kind: 'nonsense' }` came back as a previous-period comparison under an ordinary **200**, a number a dashboard renders and a person reads as fact.
  
  - **One declaration, in `packages/spec`.** `DatasetSelectionSchema`, `DatasetCompareToSchema` and `DatasetTotalsSchema` are authored in `api/analytics.zod.ts`, beside the `AnalyticsQueryRequestSchema` the sibling routes parse. `@objectstack/spec/contracts` now **re-exports** the `DatasetSelection` and `DatasetCompareTo` types from that schema instead of declaring interfaces of its own — the same move `AnalyticsQuery` made in #4538, taken here before a mirror could drift.
  - **A transcription, not a new contract.** The seven shared members are read straight off `AnalyticsQuerySchema.shape`, so the claim that the two agree is structural rather than a hand-written list; the four dataset-only members are the already-published TypeScript members made executable. No member is added and nothing the interface permitted is refused.
  - **Refusals carry a prescription.** An unrecognised `compareTo.kind` answers the sentence `datasetCompareKindRefusalMessage` builds — what arrived, the two windows the executor implements, what to do — and `@objectstack/service-analytics`' `shiftRange` now raises that same sentence with its own origin clause, so one condition keeps one wording. An unknown key is named, echoed and pointed at the canonical spelling (`where` → `runtimeFilter`, `granularity` → `dateGranularity`), and the retired `{ offset }` arm and the pre-#5011 bare-string form each carry their rewrite.
  - ⚠️ **What narrows on the wire**, so an upgrading caller can look for it: a selection member whose value the published interface never permitted now answers `400 VALIDATION_FAILED` with `details.fields[]` instead of travelling into the executor. Measured against the sibling route spelling for spelling, `runtimeFilter` now behaves exactly as `/analytics/query`'s `where` does — three structurally-malformed filter spellings (`{ $or: 'x' }`, an `$or` branch that is not a filter object, `{ $not: 5 }`) are refused at the schema on both routes, and the four semantic ones (`{ stage: {} }`, `{ amount: { $between: [10] } }`, `{ $nor: […] }`, `{ $or: [] }`) still pass both and are answered deeper. The dataset route was the looser of the two; it is not any more.
  - **No valid selection changes.** Every in-repo specimen and all five `@object-ui` call sites that build a selection today still pass, pinned in both packages; the route still forwards the caller's object to the service by identity, never a parse output, and the schema carries no default or transform that could override the engine's own timezone resolution chain.
- c81e7ff: fix(analytics): a `dateRange` preset plus `compareTo` is lowered and shifted instead of refused as an "invalid date" (#17973)
  
  `DatasetExecutor.runCompare` read the STRING arm of `dateRange` as
  `[range, range]` — the degenerate fallback #17015 removed from every other
  analytics face. `parseUTC` was handed the preset NAME, so a declared, honoured
  member of the closed vocabulary was refused outright. Measured end to end
  through the executor, a valid preset plus `compareTo`:
  
  ```
  DATASET_INVALID  400  [dataset-executor] invalid date in dateRange: "last_30_days"
  ```
  
  The diagnostic is not merely unhelpful, it is FALSE. `last_30_days` is exactly
  what the schema, the dashboard date filter and the docs tell an author to
  write, so "invalid date" sends them to check a date that is already correct —
  a repair that does not exist. This face was not in #17015's kit, so nothing
  measured it and nothing noticed.
  
  Both arms now go through one face lowering, which calls the shared
  `resolveAnalyticsDateRangeString` for the string arm — the same call the
  ObjectQL strategy, the native-SQL strategy, the draft-preview evaluator and
  driver-memory's cube face make — and the lowered window is then projected onto
  the comparison math's UTC calendar, with `endExclusive` honoured so that a
  calendar preset's exclusive upper bound does not itself add a day to the
  projected window. On the UTC calendar, `this_month` plus
  `compareTo: { kind: 'previousYear' }` now compares September against the
  previous September, rather than refusing. ⚠️ Outside UTC the projection costs a
  day of its own — third note below.
  
  Three consequences worth knowing when you upgrade:
  
  - **A string outside the vocabulary now answers the shared envelope.** On this
    path it used to be `DATASET_INVALID`; it is now
    `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400, the ADR-0112 envelope the other
    faces already raise, with the message that lists the thirteen declared preset
    names. One condition, one envelope. Code keying on `DATASET_INVALID` for an
    unrecognised `dateRange` STRING should key on
    `ANALYTICS_DATE_RANGE_UNRECOGNIZED` instead.
  - **The caller's explicit `[start, end]` window is untouched**, bound for bound,
    with the inclusive upper reading it has always had — including the
    `DATASET_INVALID "invalid date in dateRange"` refusal for a bound that is not
    a date, which is unchanged.
  - **⚠️ A calendar preset lowered in a NON-UTC zone gives a comparison window one
    day too wide** — in either direction, depending on which side of UTC the zone
    sits. The comparison math is UTC-calendar throughout (`parseUTC` reads a bare
    day as UTC midnight, `toISODate` emits a UTC day), so a window computed
    against another zone's calendar is projected onto UTC day boundaries: east of
    UTC the start lands a day early, west of UTC the end lands a day late.
    Measured through the executor, `this_month` plus
    `compareTo: { kind: 'previousYear' }` frozen at `2026-09-09` —
    `UTC` gives `['2025-09-01','2025-09-30']` (30 days, correct),
    `Asia/Shanghai` gives `['2025-08-31','2025-09-30']` and `America/New_York`
    gives `['2025-09-01','2025-10-01']` (31 days each). ⛔ This is NOT a
    regression: the same input used to be refused outright, so no
    previously-working input behaves differently — what changed is that the
    preset arm produces a window at all, which is what makes the projection
    observable. Tracked in #18245. It is deliberately not repaired here, because
    a timezone-aware calendar-day extraction in this module would be the second
    implementation `analytics-date-range.ts`'s own header exists to refuse.
  
  `runCompare` is also registered as a face in the shared `dateRange` conformance
  kit, so the next face that forgets to lower a preset is caught by a test rather
  than by a customer.
- fe0ae5c: analytics `dateRange`: one condition, one refusal wording
  
  An array `dateRange` that is not a two-bound window is refused by the
  `service-analytics` faces with the platform's ONE shared sentence
  (`analyticsDateRangeRefusalMessage`, origin `runtime`) instead of a
  package-private second wording. The envelope is unchanged —
  `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400 — so nothing that classifies on
  `code`/`status` is affected; only the `message` text changes, and it now agrees
  byte-for-byte with the sentence the schema door answers with for the same value.
  
  The second wording existed because the shared sentence used to judge a bare
  string against the preset vocabulary and to end with "Refused at the schema",
  neither of which is true of an array refused past the schema door. Both grounds
  were removed when `analyticsDateRangeRefusalMessage` gained its required
  `origin` parameter and began describing a non-string by what is wrong with it.
  
  ⚠️ **The message no longer echoes the value you sent.** For an ARRAY
  `dateRange` the shared sentence DESCRIBES the shape instead: what used to read
  `dateRange ["a","b","c"] is a 3-element array` now reads `received a 3-element
  array, not the two bounds [start, end]`. That applies to EVERY array shape this
  face refuses, not to unusual ones only — `[null, null]` now reads `received an
  array with a non-string bound`, and `['', '']` is where the description carries
  least, `received a two-element array`. A bare STRING `dateRange` is still quoted
  back to you. So a log line that used to carry the offending array no longer
  does: if you need the value at that site, read it from the request you already
  have, ⛔ not from the message.
  
  ⛔ If you match on the old text (`[service-analytics] dateRange …`), match on
  `error.code === 'ANALYTICS_DATE_RANGE_UNRECOGNIZED'` instead — the message was
  never the contract, the envelope is.
- ad067ad: fix(service-analytics): resolve `compareTo`'s comparison window on the reference calendar, not UTC
  
  `DatasetExecutor`'s `compareTo` day math carried its own local `parseUTC`/`toISODate` pair
  and read every bound on the UTC calendar. The lowered preset window is a pair of INSTANTS
  that open and close at the *reference zone's* midnight, so projecting them onto UTC days
  moved a boundary in every non-UTC zone — and in opposite directions either side of the
  meridian. `this_month` + `compareTo: { kind: 'previousYear' }` frozen at 2026-09-09 compared
  30-day September against a 31-day window: `Asia/Shanghai` opened at `2025-08-31`,
  `America/New_York` closed at `2025-10-01`. No error, no warning — a slightly-too-wide
  comparison leg rendered exactly like a correct one.
  
  The local pair is deleted. The bare-calendar-day arithmetic (year shift, previous-period
  length, bucket ordinals) now runs through `@objectstack/core`'s `zonedDateStartToUtcMs` on
  its zone-free UTC proxy, and the one seam that turns instants into days — the lowered
  window's projection — goes through the same package's `bucketDateKey`, threaded with the
  timezone `buildQuery` already resolves the primary pass in. UTC callers are unaffected.
- b49728f: `dimension-labels.ts` — the module header names the label-resolving option arm by the **property the resolver actually reads** (a declared, non-empty `options` list) instead of by the type name `select` (#18923).
  
  Doc comment only; it is published in `dist/index.d.ts` and `dist/index.d.cts`, so an upgrading reader's editor hover changes. No behaviour, no export, no schema.
  
  The header told the reader the arm was a type test:
  
  ```
   *  - **select** — grouped by the stored option `value` (e.g. `backlog`), but the
   *    user-facing text is the option `label` (e.g. `Backlog`).
  ```
  
  The resolver in the same file never reads a type for it. All three decision points spell one predicate — `Array.isArray(meta.options) && meta.options.length > 0` — at `isLabelBearing`, at `resolveLabels` and in `resolveDimensionLabels`'s display pass; `type === 'select'` occurs zero times in the file, while the sibling `type === 'date'` arm shows the file does spell type tests where it means them.
  
  Naming a type is wrong in both directions, which is why the replacement names the property rather than a longer type list:
  
  - **It misses fields that do resolve.** `options` is optional on every field in the spec's field schema, so any field that declares one is resolved here whatever its type says.
  - **It promises resolution for fields that carry none.** A free-input `tags` field may declare no options at all, and the display pass then leaves its stored value untouched.
  
  This closes the divergence that opened when the same sentence in `content/docs/data-modeling/analytics.mdx` and `content/docs/ui/dashboards.mdx` was moved to the property reading: the documentation was corrected, and the header the next editor of this file reads first was left behind.
- d7f7e34: Four readers of `FieldSchema.reference` gated the carrier with a truthiness test and then **propagated** it. `FieldSchema.reference` is declared an optional **string**, so the answer a reader owes for a carrier it cannot read is absence — and one of these four did worse than lose the information, it invented a name for it:
  
  ```
  out.push({ key, reference: String(f.reference) })   // -> reference: '[object Object]'
  ```
  
  Each site now reads the carrier through the one arbiter, `referenceCarrierOf`, and catches its refusal **at the site** — so the reader answers absence and reports, instead of aborting. That is the deliberate difference from `@objectstack/objectql`'s cascade seams, which let the same refusal propagate: those assert something positive about the schema on a write path, while these four are best-effort display and diagnostic readers whose own failure handling would have turned one unreadable field into a much wider loss.
  
  - **`@objectstack/plugin-approvals`** — `resolveLookupFields`. The stringified carrier was handed on as an object name to `engine.find()`, where it could never resolve and the failure was swallowed by the caller's `catch`. The field is now left out of the inbox display enrichment and logged; readable targets are unaffected. It is dropped rather than carried with an absent target because the sole consumer uses `reference` as the object name and has nothing to do with an entry carrying none.
  - **`@objectstack/service-analytics`** — the ADR-0021 relationship → target-object resolver. An unreadable carrier became the joined table for a dataset's `include`; the resolver now answers `undefined`, which its existing fallback turns into the compiler's own refusal, plus one warning naming the field.
  - **`@objectstack/cli`** — `os doctor`'s circular-dependency and unused-object checks, which put the carrier into a graph node and a name set. Both now report the unreadable carrier as a finding rather than skipping it, because "no circular references detected" and "defined but not referenced" are positive claims that an edge nobody could read cannot support. The same file's `collectViewObjectRefs` already narrowed its carrier this way.
  
  `null`, `undefined` and `''` are absence, not a wrong shape, and still pass silently at every one of these sites — a field is allowed to name no target. Each site's absence answer and its readable-target answer are pinned alongside the refusal.
  
  Upgrading: nothing conformant changes. A non-string `reference` is refused by `ObjectSchema.safeParse`, so a value in that shape only ever reaches these readers without having passed parse at all.
- a6a4361: The draft-data preview **refuses** a `where` operator it cannot evaluate instead of answering it for every row, so a drafted chart no longer silently ignores a filter and then changes at publish (#19810).
  
  `preview-evaluator.ts` evaluates a pending seed draft's rows in memory — the ADR-0037 P3 Live Canvas path — and its operator switch carried ten cases (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$between`, `$in`, `$nin`, `$contains`) and then `default: return true; // unknown operator — permissive (preview, reads only)`. Every other declared operator therefore matched EVERY row: `$icontains`, `$notContains`, `$startsWith`, `$endsWith`, `$null`, `$exists`, the staged `$like` / `$ilike`, and any typo. A drafted chart with `name $icontains 'acme'` charted the whole dataset and looked exactly like a working chart; the published chart, which runs the real filter doors, applied the filter.
  
  - **Fail-closed, and VISIBLE.** The operator is refused in the ADR-0112 `INVALID_FILTER` / 400 envelope this package's `where` door already speaks, through `filter-normalizer`'s exported `invalidFilterError`. No new error code and no new exported symbol. Refused rather than excluded from the result: an excluded row makes the preview merely *different* from publish — zero rows where publish draws numbers — which is the silent shape `lowerPreviewDateRange` abolished on this same evaluator; only a refusal reaches the author who can fix it. It is the call `uncompilableFieldOperatorError` states for the analytics cube face, and the posture `service-analytics` already takes for `$like` / `$ilike`.
  - **The vocabulary and the evaluator are now ONE table**, the shape `memory-analytics`' `MONGO_TO_CUBE_OPERATOR` took for this same defect class: adding a row is the only way to widen what this face accepts, and forgetting to add one is a loud refusal rather than a wrong number.
  - **The gate does not depend on the data.** It walks `where` before any row is read, so a seed draft holding zero rows — the state a draft is authored in — refuses too instead of answering an empty chart.
  - ⚠️ **What it costs**: a drafted chart whose filter uses one of those operators now returns `400 INVALID_FILTER` in preview where it previously rendered a number. That number was computed over rows the filter excludes, and it changed at publish. Growing the preview's arms is deliberately separate work — the `FILTER_OPERATORS` docblock's ruling that a name must not land ahead of its evaluators reads the same in this direction, so an arm joins the table in the PR that measures it against the shared conformance kits.
  - **The ten evaluated arms are byte-for-byte unchanged**, pinned in both directions (a matching row still matches, a non-matching row still does not).
- 44ce049: The draft-data preview **refuses** a field constraint with zero operators (`{ name: {} }`) instead of answering it with every row, so a drafted chart no longer shows rows for a filter publish refuses outright (#19835).
  
  `preview-evaluator.ts`'s `matchesWhere` iterated a field constraint's entries; an empty object has none, so the loop never ran and the row fell through to a MATCH. `matchesWhere({ name: 'Globex' }, { name: {} })` answered `true`. Every data driver refuses this shape (`driver-memory`, `driver-mongodb`, and `driver-sql` at the top level and inside `$and`/`$or`/`$not`), and so does this package's own `where` door, so the preview and publish gave opposite answers to the same filter.
  
  - **Refused in the ADR-0112 `INVALID_FILTER` / 400 envelope**, through the same `invalidFilterError` the preview already uses for an operator it cannot evaluate. No new error code and no new exported symbol. The message follows the drivers' wording: it names the constraint and its position (`where.$or[1].amount`), and gives the two legal repairs (name an operator, or write a direct comparand).
  - **Not answered as "matches zero rows" either.** `{ status: {} }` does not mean "no rows". Read literally it means "rows whose status is anything", and the shape is almost always an authoring accident: a filter builder that recorded a field but never its operator. Only a refusal names the constraint to repair.
  - **Nesting cannot route around it.** The check walks the whole `where` before any row is read, `$and` / `$or` / `$not` arms included. So a constraint in an `$or` arm that a matching row would short-circuit past still refuses, and so does a seed draft holding zero rows.
  - ⚠️ **What it costs**: a drafted chart whose filter carries `{ field: {} }` now returns `400 INVALID_FILTER` in preview, where before it rendered a number computed over every row. Fix: name the operator the constraint was meant to carry, e.g. `{ status: { $eq: 'open' } }` or `{ status: 'open' }`.
  - **Unchanged**: constraints that name an operator, implicit-equality comparands, and an empty *node* (`where: {}` or `$and: [{}]`, which is the identity and not a field constraint).
- 60fdaa9: fix(service-analytics): the ObjectQL execute face refuses a read scope carrying a filter placeholder the engine cannot resolve in the withheld `READ_SCOPE_COMPILE_FAILED` / 500 envelope, not the engine's `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` / 400 (#19995)
  
  Clause-②: no
  
  A row-level read scope carrying an unknown filter placeholder, or a known one the request has no value for, used to reach `engine.aggregate` composed with the caller's own filter. The engine's placeholder resolver then refused it with a 400. A 4xx's message is relayed to the caller, and this one named the policy's placeholder.
  
  The ObjectQL strategy now runs the engine's own placeholder resolver on the scope by itself, with the token context the engine builds, at both engine-bound merge sites: the base aggregate (direct and cross-object) and the referenced object's scope in the cross-object label lookup. It does this before composing the scope. A refusal there is `READ_SCOPE_COMPILE_FAILED` / 500. `POST /analytics/query` and `POST /analytics/dataset/query` withhold its message, and the full text goes to the operator's log.
  
  Unchanged: which scopes are served. A placeholder the engine resolves, such as `{current_user_id}` for a signed-in caller, is resolved the same way here, and the scope is served. The caller's own `where` keeps its `FILTER_TOKEN_UNKNOWN` / 400 with its message.
- ab82001: fix(service-analytics): the analytics ObjectQL face asks the engine's own filter admission about a row-level read scope before composing it, and refuses a scope the engine refuses with the policy withheld (#19995)
  
  Clause-②: no
  
  The ObjectQL execute face composes each object's read scope into the `where` it hands `engine.aggregate`. A scope the engine refuses through a door that reads the object's declared fields (a text operator over a field that never holds a string, a temporal comparand the field cannot read, a filter on a formula field, a dotted path through a lookup) came back as the engine's `INVALID_FILTER` or `INVALID_FIELD` / 400. Both analytics HTTP doors relay a 400's message, and that message named the policy's field, and for some classes its operator or comparand. A read-scope refusal is a server fault whose detail belongs in the server log only (the #5367 ruling), so these scopes now answer `READ_SCOPE_COMPILE_FAILED` / 500 with the message withheld, like the other refusals this package's read-scope compiler and guards raise. The `driver-sql` refusals that read the `'policy'` provenance mark are unchanged: they stay a withheld `INVALID_FILTER` / 400.
  
  **How.** The analytics face asks the engine's judge-only admission, `IObjectQLEngine.judgeFilter`, about the scope on its own before composing it. It asks at every engine-bound merge: the direct aggregate, both merges on the cross-object path, and the record-label lookup behind a lookup dimension. The engine runs the same admission it runs when it executes and stops before any driver, so a scope the engine serves is still served. The caller's own `where` is not judged here and keeps the engine's answer, including its 400 and message.
  
  **Also fixed.** The record-label lookup `AnalyticsServicePlugin` supplies for a lookup dimension composed the referenced object's scope with only the vacancy guard. When a dataset sorted by that dimension's labels, a scope the engine refused there came back as its 400, with the policy in the message. When a dataset only displays the labels, a failed lookup is caught and the raw ids render, as before. The lookup now runs the same checks as the other merges and answers the same withheld 500.
  
  **Wiring, and what a host without it keeps.**
  
  - `AnalyticsServicePlugin` wires the judge automatically when it bridges `executeAggregate` to the kernel's `data` engine itself. That is the default composition, so nothing changes in host code.
  - A host that constructs `AnalyticsService` directly can pass the new optional `AnalyticsServiceConfig.judgeFilter`. It must be the judgement of the engine its `executeAggregate` runs on.
  - A host with no judge (a custom `executeAggregate`, or a `data` engine without `judgeFilter`) keeps today's behaviour everywhere except the plugin's record-label lookup. The scope shapes this package judges itself are still refused with the policy withheld, and the rest reach the engine unjudged, as before. That lookup's comparand and placeholder checks are new for every host that uses it, with or without a judge. So on such a host a referenced-object scope that fails one of them now answers the withheld 500 at that lookup, where it used to reach the executor. The host logs one `warn` that no judge is wired, with the remedy.
- 7b76fff: fix(service-analytics): the ObjectQL execute face refuses a read scope it cannot run in the withheld `READ_SCOPE_COMPILE_FAILED` / 500 envelope, not the engine's `INVALID_FILTER` / 400 (#19995)
  
  Clause-②: no
  
  A row-level read scope carrying a comparand the engine's shared comparand faces refuse — a list in the equality slot, a scalar under `$in` / `$nin`, a one-bound `$between`, a null list member, a plain-object or `undefined` comparand — used to reach `engine.aggregate` composed with the caller's own filter, and came back as the engine's `INVALID_FILTER` / 400. A 4xx's message is relayed to the caller, and this one named the policy's fields and comparands. The NativeSQL execute face and the `/analytics/sql` echo already refused the same scope as a server fault with the message withheld (the #5367 ruling), so one scope got two envelopes depending on which analytics face served it.
  
  The ObjectQL strategy now judges the scope on its own at both engine-bound merge sites (the base aggregate, direct and cross-object, and the referenced object's scope in the cross-object label lookup), with the same two shared functions the engine runs, before composing it. A refusal there is `READ_SCOPE_COMPILE_FAILED` / 500: `POST /analytics/query` and `POST /analytics/dataset/query` withhold its message, and the full text goes to the operator's log.
  
  Unchanged: which scopes are served. The judgement uses the engine's own functions, so a scope the engine serves is still served, including a `{ $field }` cross-field scope and an emptied `$in` beside an own-rows grant. The caller's own `where` still answers `INVALID_FILTER` / 400 with its message, whether the analytics door or the engine refuses it.
- bf37b99: fix(service-analytics): on SQLite, the text operators in analytics filters and read scopes compare the whole stored value and the whole comparand, instead of stopping at their first U+0000 (#20025)
  
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
- 6780e34: fix(service-analytics): a dataset measure column takes the source field's currency only when that field's `currencyConfig.currencyMode` is `'fixed'`. Otherwise it takes the tenant default (#20091)
  
  Clause-②: no
  
  `AnalyticsServicePlugin` passes each source field's metadata to the service through `sourceFieldMeta`. That hook passed on `currencyConfig.defaultCurrency` whatever `currencyMode` said, and `queryDataset` put it on the result column as `currency`. The column is resolved in this order: the measure's own `currency`, then that value, then `ExecutionContext.currency`. So a `dynamic` field's `defaultCurrency` showed on analytics, chart and dataset faces, where the tenant currency belonged. That covers a `currencyConfig` naming no mode too, which is `dynamic` by the schema default. Parsed through the spec, a `currencyConfig: {}` also carries the schema's placeholder `CNY`, and that reached the column as if an author had written it.
  
  - **What changes**: the relay now passes `defaultCurrency` on only under `currencyMode: 'fixed'`. This is the rule `CurrencyConfigSchema` declares, and objectui's field faces already follow it: only `fixed` gives a field one currency, and a field without one uses the tenant default at runtime. On both the live and the draft-preview path of `queryDataset`, the column now carries:
    - the field's currency for a `fixed` field;
    - `ExecutionContext.currency` for a `dynamic` field, a config naming no mode, an empty config, or no config at all.
  - **What does not change**: a measure's explicit `currency` still wins, over a fixed field as well. A non-monetary measure still gets no code. `AnalyticsService.query` (the cube face) still carries no column currency. The `AnalyticsServiceConfig.sourceFieldMeta` type is unchanged.
  - **Hosts that write their own `sourceFieldMeta`**: its `defaultCurrency` means the field's fixed currency. Return `currencyConfig.defaultCurrency` only when `currencyConfig.currencyMode === 'fixed'`, and return `undefined` otherwise. The TSDoc on `AnalyticsServiceConfig.sourceFieldMeta` states the rule.
- 536f2d5: fix(service-analytics): `$icontains` works on a query the ObjectQL strategy serves (#20098)
  
  Clause-②: no
  
  `ObjectQLStrategy` had no translation for the case-insensitive `$icontains`
  operator, so every such filter on a datasource it serves failed. A valid
  `{ name: { $icontains: 'acme' } }` included. `POST /analytics/query` answered
  `500 INTERNAL_ERROR` ("ObjectQL strategy cannot express filter operator
  "icontains""), while the native SQL face and the `/analytics/sql` echo served
  the rows.
  
  The strategy now hands the engine the canonical `$icontains`, the same way it
  passes `$contains`, `$notContains`, `$startsWith` and `$endsWith`. The engine
  and the driver apply the case fold, so the ObjectQL face answers the same rows
  as every other face: the fold is ASCII-only, so `'CAFÉ'` does not match
  `'café'`. This covers the query's `where` in both spellings (`$icontains` and
  the `FilterArray` `icontains`), under `$not`, a compiled dataset's scope and a
  measure filter. An empty or non-string comparand is still refused with
  `INVALID_FILTER` / 400 before the strategy runs.
- 70ce802: `AnalyticsService.queryDataset` no longer writes the service-wide cube and dataset registries: each call compiles its dataset into a scope of its own (#20356).
  
  Clause-②: no
  
  - **What changes**: a dataset query — an inline draft or a saved definition passed to `queryDataset` — used to register its compiled cube and compiled dataset under the dataset's name before it ran. From then on the name meant that request's definition for every later reader (`getMeta()` and `GET /api/v1/analytics/meta`, and every query by that name) until restart, whatever the request's own admission answered. The dataset is now compiled for the call only. The queries it runs resolve its name through a request-local lookup that overlays the shared registry read-only: the cube, the object-level admission and read-scope object sets, the join allowlist and the dataset scope all come from the call's own dataset, and a measure the call infers stays with the call.
  - **What does not change**: the request is served as before, from its own definition, with the same admission, read scope and refusals. `registerDataset` still compiles and registers into the shared registry — the configuration door behind `AnalyticsServiceConfig.datasets` and embedders — and configured cubes are untouched. No refusal is added for a dataset whose name matches a configured cube.
  - **The one observable difference**: a cube that only a `queryDataset` call ever compiled is no longer listed by `getMeta()`, and is no longer queryable by name through `query()` / `POST /api/v1/analytics/query` after that call returns. To make a dataset addressable by name, register it through `registerDataset` or `AnalyticsServiceConfig.datasets`.
- 50e273f: `AnalyticsService.query()` and `generateSql()` no longer write the service-wide cube registry before the object-level read admission has admitted the request, and never write a caller-named measure into a registered cube (#20381).
  
  Clause-②: no
  
  - **What changes**: both ad-hoc doors — `query()` (`POST /api/v1/analytics/query`) and `generateSql()` (`POST /api/v1/analytics/sql`) — resolved the query's cube and recorded what `ensureCube` minted straight into the shared registry, ahead of the admission check. A request refused `PERMISSION_DENIED` still left the cube it inferred for the refused object in the registry, and a suffix measure a caller named on a registered cube (`<field>_sum`, `<field>_count_distinct`, …) was appended to that cube for every later reader, whether the request was refused or admitted. Both doors now run in the same request-local scope `queryDataset` runs in: what `ensureCube` mints stays with the call, and the admission, read scope and strategy all read it from there.
  - **What does not change**: every request is served as before, with the same admission, read scope, refusals, codes and statuses, and a caller-named suffix measure is still served to the caller who named it. A cube inferred for an ADMITTED ad-hoc query is no longer registered either; the separate #20381 entry that retires inferred-cube registration describes that change. Configured cubes and datasets registered at construction (`AnalyticsServiceConfig.cubes` / `datasets`) are untouched.
  - **What `getMeta()` lists, the one observable difference**: `getMeta()` and `GET /api/v1/analytics/meta` no longer list a cube inferred for a refused request, and no longer list a suffix measure some caller named on a registered cube — a registered cube is listed as it was registered.
- c745e2b: A cube `AnalyticsService` infers for an ad-hoc `query()` or `generateSql()` request is no longer registered in the service-wide cube registry, even when the request is admitted, so `getMeta()` and `GET /api/v1/analytics/meta` list configured cubes only (#20381).
  
  Clause-②: no
  
  - **What changes**: an ad-hoc request naming an object that no cube is configured over (`POST /api/v1/analytics/query`, `POST /api/v1/analytics/sql`) is still served from a minimal cube inferred from that request's own members. That cube now lives only in the request that inferred it, like a suffix measure a caller appends to a configured cube. Before, an admitted request left it in the shared registry, so `getMeta()` listed it to every caller, including callers who may not read the object, together with the member names the first caller used. Its contents depended on who had queried what since boot, and it was lost on restart.
  - **What does not change**: every request is served as before, with the same answer, admission, read scope, refusals, codes and statuses. A repeat request for the same object infers the cube again, through the same existence and source-field checks, and gets the same answer. Configured cubes (`AnalyticsServiceConfig.cubes`) and datasets registered through `registerDataset` (the constructor's `datasets`, or an embedder) are registered and listed as before, and they are now the registry's only writers.
  - **What to do**: nothing, unless something reads `getMeta()` / `GET /api/v1/analytics/meta` expecting to find a cube that only an ad-hoc query inferred. No consumer in this repository does. Author that cube explicitly (`defineCube`, or the analytics service's `cubes` config) so that it is listed, and listed the same way after a restart.
- 40098a4: fix(service-analytics): an unrecognised `compareTo.kind` is refused, not answered with a previous-period window under a 200 (#17550)
  
  `shiftRange` had one branch and a fall-through — `previousYear` was named, and
  **everything else** landed in the `previousPeriod` arm. No `default`, no
  exhaustiveness check. So `compareTo: { kind: 'previousQuarter' }` came back as a
  previous-period comparison under an ordinary **200**, and the caller was told
  nothing. The wrong answer is a comparison **window**: a number a dashboard
  renders and a person reads as fact, with no status, header or field in the
  response to distinguish it from a real answer.
  
  `DatasetCompareTo.kind` has only ever declared two values
  (`'previousPeriod' | 'previousYear'`), but `DatasetSelection` is a TypeScript
  interface with no Zod schema anywhere, and `/analytics/dataset/query`'s door
  parses only the seven members the selection shares with `AnalyticsQuery` —
  `compareTo` is one of the four it projects away before its parse, and the route
  forwards the caller's selection to the service untouched. So `kind` was checked
  by `tsc` inside this repo and by nothing at all on the wire.
  
  ## FROM → TO
  
  | Input | Was | Now |
  |:--|:--|:--|
  | `compareTo: { kind: 'previousPeriod' }` | the equal-length window before | **unchanged** |
  | `compareTo: { kind: 'previousYear' }` | the same window one year back | **unchanged** |
  | `compareTo: { kind: <anything else> }` | a previous-period window, **200** | `DATASET_INVALID` / **400**, naming the value received and both legal ones |
  
  The fix is to name one of the two declared windows, or drop `compareTo` — which
  is what the refusal says. No accept set widens, no new error code is minted: the
  refusal is the fourth member of the `datasetInvalidError` family
  `resolveCompareDimension` already raises three times for the same document, so it
  arrives at the route through the envelope that route already classifies on.
  
  ## Why this is a `patch`
  
  It pulls behaviour back onto the contract the type has always declared, rather
  than narrowing past it: every input `DatasetCompareTo` permits returns
  byte-identical windows, pinned by a control in the same change. What flips from
  200 to 400 is input the declared contract never permitted. The reachable-today
  population for that input was measured on the tree — the dashboard authoring path
  is already doored (`DashboardWidgetSchema` parses the widget's `kind` as a
  `z.enum`, so a third kind cannot arrive through a parsed widget), and no producer
  in this repository sends a third value. What is not enumerable from here is a
  consumer outside it calling the published `shiftRange` export, or posting a
  hand-rolled body to the dataset route; for those, the refusal replaces a wrong
  answer with a located one.
  
  `alignedCompareBucketKey` reads the same two-valued `kind` and deliberately gains
  no refusal of its own: it is not on the package's public surface, and its only
  caller runs `shiftRange` first — both pinned, so exporting it turns the pin red
  rather than silently reopening this defect.
- 113050e: A dataset dimension over a `user` or `tree` field renders the referenced record's display name, the same way a `lookup` dimension already did. A "by person" chart's axis is people's names, not a column of user ids.
  
  `packages/spec` declares one reference class — `REFERENCE_VALUE_TYPES` = `lookup`, `master_detail`, `user`, `tree`, "value points at another record … a record-id string in stored form" — and this service already treated it as one class where it annotates measure result types (`measure-result-type.ts` imports that very set). The label resolver, one file away, hand-wrote a two-member subset of it (`lookup`, `master_detail`), so within a single dataset query one axis came back as a name and the other as a raw id, for two fields that differ in one word:
  
  ```
  Field.user({ label: 'Person' })            -> { type: 'user',   reference: 'sys_user' }
  Field.lookup('sys_business_unit', { … })   -> { type: 'lookup', reference: 'sys_business_unit' }
  ```
  
  - **The subset is gone, not extended.** The resolver now asks `referenceTargetOf` (`@objectstack/spec/data`) — the declared single arbiter of "what does this reference field point at" — at all three sites that classified a dimension: the display pass, the `#3680` sort-key hook's `isLabelBearing`, and its `resolveLabels`. Adding two literals to a private `Set` would have left the next member of the class to be re-reported by the next user.
  - **A `user` field authored without `reference` resolves too.** `sys_user` is a constant of the type, which `referenceTargetOf` materializes; requiring an author to restate it is exactly the disagreement between two readers of one field that arbiter exists to end.
  - **The label read stays scoped (`#3602`).** Turning a user id into a name is a read of `sys_user`, and it travels the same `LabelScopeResolver` path every other member of the class travels — the referenced object's own RLS is resolved and ANDed into the lookup, and an unresolvable scope still fails closed to the raw id rather than fetching unscoped. This is the half of the change that had to land with it, not after it.
  - **Nothing degrades into an error or a blank.** An orphaned or RLS-hidden user id, a `sys_user` with no display field, and a user object unknown to the engine all leave the raw id in place and answer the query, which is the pre-existing contract for an unresolved lookup id.
  
  No new authorable key and no new export: `DatasetDimensionSchema` is untouched, and a dimension's own declared `type` still does not decide this — the resolver reads the object field's type, as it always has.
- 54b3d1d: fix(service-analytics): a fail-closed row-scope refusal can no longer be served as an empty chart (#17130)
  
  `queryDataset` degrades to `{rows: [], fields: [], totals: []}` when a BARE error looks like a driver reporting an absent table — a deliberate leniency (#5033) so a dashboard widget over an unmounted object renders "no data" instead of failing. The test is a substring match over the message, and three of its six limbs — `not registered`, `unknown object`, `is not a registered object` — are exactly the phrasings a registry or security refusal reaches for.
  
  Both sites of the row-scope RESOLUTION stage refused with a bare `throw new Error(…)`: the `security` bridge in `AnalyticsServicePlugin`, and `AnalyticsService.resolveReadScopes`. They propagated only because their wording happened to miss all six — so any reword, or any refusal added to that stage later, could silently turn a fail-closed gate into a `200` with no rows.
  
  Both now declare `READ_SCOPE_COMPILE_FAILED` / `500` — the code the sibling read-scope LOWERING stage has answered with since #5367, so the registered wire vocabulary is unchanged. Two visible consequences for a deployment whose wired `security` service cannot answer a row-level read scope:
  
  - the refusal reaches the caller as a declared `500` instead of relying on its phrasing to escape the degradation path;
  - its message is withheld from the response body by declaration (the operator still gets the full text, at `error`, from the producing site) rather than echoed.
  
  Every refusal message is byte-unchanged, and #5033's leniency is untouched: a genuine absent source table still degrades to the empty result with its `warn`. A deployment with NO security service does not run unscoped either: the in-repo kernels throw on its `security` lookup, so its queries are refused, fail-closed, as they already were. A guard derived from the source (`refusal-wording-collision.test.ts`) now walks every `throw` in the package and fails if an un-enveloped refusal can be read as a missing source table.
  
  *Erratum, 2026-10-08 — this entry said "a deployment with NO security service still runs unscoped exactly as before." The sentence was false when published: in the published 17.5.0 packages, `ObjectKernel` and `LiteKernel` throw on a `security` service nothing ever registered, and the analytics bridges answer that throw by refusing the query, fail-closed. One passage above is corrected in place; everything else this entry published is unchanged. (Corrected after publication, #22279.)*
- f3b28eb: Draft-preview analytics: `avg` answers the mean of the NON-NULL operands, and `null` when there are none — matching every live face
  
  A dataset measure `{ aggregate: 'avg', field: 'amount' }` compiles to the cube
  metric `{ type: 'avg', sql: 'amount' }`, and the draft-preview evaluator built
  its operand list with `rows.map((r) => Number(r[field]))`. `Number(null)` is `0`
  and `Number.isFinite` accepts it, so every NULL entered the average as a zero
  OPERAND and was counted in the divisor. `AVG(col)` is defined over non-null
  values in every SQL dialect, so a drafted chart showed a different number than
  the published one, silently — and where a group's column was NULL in every row
  the number it showed was `0`: a plausible-looking average that a reader cannot
  tell from one somebody measured.
  
  Measured on one dataset, one row set, two `AnalyticsService` instances differing
  only in `draftRowsResolver` (the live half being `NativeSQLStrategy`'s generated
  SQL on a real SQLite). Rows `{meals, null}` and `{meals, null}` answered
  `avg_amount` null live and `0` on preview; rows `{travel, 10}`, `{travel, 20}`,
  `{travel, null}` answered 15 live and 10 on preview. Both cells now answer the
  live number.
  
  The empty answer is READ from the platform's own ruling rather than restated
  here: `emptyGroupValueFor` (`@objectstack/spec/data`) returns the identity `0`
  where counting or summing nothing is a measured fact and `undefined` — spelled
  `null` on this wire — where there is nothing to answer. It is the same function
  `fillEmptyGroups`, `sql-driver` and `driver-turso` read, and the one #16203 cited
  when it moved `min`/`max` off the same idiom in this function.
  
  Unchanged, and pinned by the same differential: `sum` over a group with no values
  still answers the ruled identity `0`, `count` over one still answers `0`
  (#16218), `min`/`max` still answer `null` (#16203), and `avg` over a group that
  has values still answers its mean. `sum` and the numeric `default` arm keep their
  existing operand list — `0` is the additive identity, so the coercion never moved
  `sum`'s answer, and the `default` arm serves the custom-SQL metric types, which
  have no live standard to be moved towards.
  
  The `null` fires on an EMPTY group and never on an incoherent one. "No numeric
  operand" is two different situations: no row carried a value at all — the empty
  group the policy rules on — or rows carried values that do not read as numbers,
  such as a `date` column under `avg`. The second is an incoherent
  aggregate/field-type pair that #16099 owns and no layer refuses yet; it keeps the
  numeric identity it has always had, since the live face answers a different
  number again (SQLite's numeric affinity over a TEXT column) and a `null` there
  would invent a third answer. That boundary is pinned from both sides — by
  `preview-aggregate-operand-type.test.ts` (#16203) and by a control in the new
  differential.
  
  The live path is unchanged.
  
  Bumped `patch` rather than `minor`, on the same reasoning the sibling #16218
  shipped under: the package's published surface is byte-unchanged — `src/index.ts`
  is not in this diff and does not re-export `preview-evaluator.ts` at all, and
  `aggregate()` is module-private — and the only user-visible effect is a drafted
  chart's number moving to the number the published chart already showed. A value
  correcting toward the live standard is a fix, not the backwards-compatible
  feature addition `minor` denotes. It is a real value change for a consumer
  reading the preview response (`0` becomes blank), which is why the card was filed
  separately rather than ridden along with #16203 — but the `0` it replaces was
  never a number the platform promised.
- fd5cff2: Draft-preview analytics: `count` over a declared field counts its non-null values, matching every live face
  
  A dataset measure `{ aggregate: 'count', field: 'payer' }` compiles to the cube
  metric `{ type: 'count', sql: 'payer' }`, and the draft-preview evaluator carried
  that field in and never read it — it answered the ROW count, nulls included,
  while every SQL face lowers the same measure to `COUNT("payer")`, defined over
  non-null values. A drafted chart therefore showed a different number than the
  published one, silently, and the number it showed was the one `count(*)` gives:
  the author's choice to count a specific column had no effect on the preview path.
  
  Measured on one dataset, one row set, two `AnalyticsService` instances differing
  only in `draftRowsResolver` (the live half being `NativeSQLStrategy`'s generated
  SQL on a real SQLite): rows `{meals, 'bob'}` and `{meals, null}` answered
  `payer_count` 1 live and 2 on preview. Both now answer 1.
  
  Unchanged, and pinned by the same differential: `count` with no field and `count`
  with `field: '*'` still answer the row count (the compiler writes
  `sql: m.field ?? '*'`, so the star is the "no field declared" spelling), and
  `count_distinct` still answers a cardinality. A group in which no row carries a
  value counts `0`, never null — `emptyGroupValueFor` rules counting nothing the
  identity `0`.
  
  The live path is unchanged.
  
  Bumped `patch` rather than `minor`: the package's published surface is
  byte-unchanged — `src/index.ts` is not in this diff, `aggregate()` is
  module-private and `evaluateAnalyticsQueryOverRows` is not on the barrel — and
  the only user-visible effect is a drafted chart's number moving to the number
  the published chart already showed, which is a correction toward the live
  standard rather than the backwards-compatible feature addition `minor` denotes.
- Updated dependencies [863c7c4]
- Updated dependencies [0f95f43]
- Updated dependencies [825d70f]
- Updated dependencies [6057357]
- Updated dependencies [a60e04d]
- Updated dependencies [7f62536]
- Updated dependencies [abc4b83]
- Updated dependencies [7382c5d]
- Updated dependencies [ea2940d]
- Updated dependencies [7d0f911]
- Updated dependencies [48f5200]
- Updated dependencies [245f360]
- Updated dependencies [d0f1845]
- Updated dependencies [9dcdb77]
- Updated dependencies [6175da8]
- Updated dependencies [0283cb9]
- Updated dependencies [324968e]
- Updated dependencies [7843663]
- Updated dependencies [ce57857]
- Updated dependencies [744a0a3]
- Updated dependencies [c7d4825]
- Updated dependencies [4844840]
- Updated dependencies [fe71032]
- Updated dependencies [74eaab8]
- Updated dependencies [0b788da]
- Updated dependencies [f7a3495]
- Updated dependencies [97f4f8c]
- Updated dependencies [482d34d]
- Updated dependencies [7a25a3e]
- Updated dependencies [839d1b0]
- Updated dependencies [2fc092b]
- Updated dependencies [2dfe070]
- Updated dependencies [6059b29]
- Updated dependencies [88a072e]
- Updated dependencies [d4a1a28]
- Updated dependencies [baf9745]
- Updated dependencies [3d8779d]
- Updated dependencies [0bd7dae]
- Updated dependencies [d34f9b6]
- Updated dependencies [57343f7]
- Updated dependencies [271d6bb]
- Updated dependencies [1e20f81]
- Updated dependencies [38472ce]
- Updated dependencies [8b48903]
- Updated dependencies [2d235bc]
- Updated dependencies [aaacf1d]
- Updated dependencies [6548118]
- Updated dependencies [9dacf61]
- Updated dependencies [146c291]
- Updated dependencies [4db1bf1]
- Updated dependencies [e0e4a56]
- Updated dependencies [7aae005]
- Updated dependencies [bdb247d]
- Updated dependencies [d5c91dd]
- Updated dependencies [0e51278]
- Updated dependencies [48203ff]
- Updated dependencies [ada2869]
- Updated dependencies [d88a47d]
- Updated dependencies [2f1a6f6]
- Updated dependencies [23fc5d6]
- Updated dependencies [2d34f32]
- Updated dependencies [7b1e4a4]
- Updated dependencies [d7c0241]
- Updated dependencies [9e3c485]
- Updated dependencies [e1796ad]
- Updated dependencies [8271c81]
- Updated dependencies [c9eb773]
- Updated dependencies [fbc12be]
- Updated dependencies [ec2ede0]
- Updated dependencies [4342c99]
- Updated dependencies [132dd13]
- Updated dependencies [d285bf0]
- Updated dependencies [dfeba25]
- Updated dependencies [9059a94]
- Updated dependencies [0a88a80]
- Updated dependencies [2c1011b]
- Updated dependencies [12bb672]
- Updated dependencies [97233b9]
- Updated dependencies [c199772]
- Updated dependencies [f5a7250]
- Updated dependencies [1a2bb9e]
- Updated dependencies [eea7ccc]
- Updated dependencies [097d268]
- Updated dependencies [182bbde]
- Updated dependencies [5ce3705]
- Updated dependencies [24d622b]
- Updated dependencies [0252320]
- Updated dependencies [2eb4724]
- Updated dependencies [e04a0af]
- Updated dependencies [6b97a20]
- Updated dependencies [e7ff9c2]
- Updated dependencies [75237a9]
- Updated dependencies [920f887]
- Updated dependencies [497655f]
- Updated dependencies [ada7012]
- Updated dependencies [3a9ad22]
- Updated dependencies [758ac40]
- Updated dependencies [6d2571f]
- Updated dependencies [2bf6ef1]
- Updated dependencies [092d460]
- Updated dependencies [09e16a5]
- Updated dependencies [98bd798]
- Updated dependencies [cbcae14]
- Updated dependencies [8261ff7]
- Updated dependencies [24489f1]
- Updated dependencies [fc28c1d]
- Updated dependencies [6d64785]
- Updated dependencies [00c332b]
- Updated dependencies [b3b43b6]
- Updated dependencies [d93400f]
- Updated dependencies [b1d3945]
- Updated dependencies [134b410]
- Updated dependencies [84e6b05]
- Updated dependencies [cb1f274]
- Updated dependencies [5c28cc7]
- Updated dependencies [b0eb9a5]
- Updated dependencies [e233db9]
- Updated dependencies [176b035]
- Updated dependencies [a83dbb6]
- Updated dependencies [d3a2331]
- Updated dependencies [51297e9]
- Updated dependencies [2d892dd]
- Updated dependencies [156792e]
- Updated dependencies [5ba2ec3]
- Updated dependencies [abb01f1]
- Updated dependencies [e64ae15]
- Updated dependencies [02bdeaa]
- Updated dependencies [66abef3]
- Updated dependencies [25c9a83]
- Updated dependencies [ee5812a]
- Updated dependencies [68fea8b]
- Updated dependencies [c049e74]
- Updated dependencies [bb9794a]
- Updated dependencies [d402e32]
- Updated dependencies [63a8eb4]
- Updated dependencies [9a910c4]
- Updated dependencies [adabccf]
- Updated dependencies [340b6dc]
- Updated dependencies [fe0ae5c]
- Updated dependencies [99fcb4a]
- Updated dependencies [55095cc]
- Updated dependencies [0f1cd83]
- Updated dependencies [a3d4c59]
- Updated dependencies [74832b6]
- Updated dependencies [1aa5026]
- Updated dependencies [2b80461]
- Updated dependencies [2bdb81f]
- Updated dependencies [b9d5422]
- Updated dependencies [c7448dc]
- Updated dependencies [627382b]
- Updated dependencies [0b31d90]
- Updated dependencies [4b58dcf]
- Updated dependencies [c23cfb3]
- Updated dependencies [559041d]
- Updated dependencies [e0d0553]
- Updated dependencies [5100c42]
- Updated dependencies [596090e]
- Updated dependencies [5380daa]
- Updated dependencies [00b38d7]
- Updated dependencies [47a9002]
- Updated dependencies [7056ca5]
- Updated dependencies [731f020]
- Updated dependencies [5eebc9e]
- Updated dependencies [72c1640]
- Updated dependencies [5e5ec9f]
- Updated dependencies [170fd83]
- Updated dependencies [922923b]
- Updated dependencies [2cac363]
- Updated dependencies [fc91239]
- Updated dependencies [e6c34f6]
- Updated dependencies [062f5cd]
- Updated dependencies [0318faf]
- Updated dependencies [5d8319f]
- Updated dependencies [43f4766]
- Updated dependencies [8e8ea99]
- Updated dependencies [a484966]
- Updated dependencies [021755a]
- Updated dependencies [b929e0a]
- Updated dependencies [dbd4744]
- Updated dependencies [14a762f]
- Updated dependencies [b146102]
- Updated dependencies [75c0dac]
- Updated dependencies [9bb059d]
- Updated dependencies [07c6f82]
- Updated dependencies [502f179]
- Updated dependencies [f20fe29]
- Updated dependencies [362035c]
- Updated dependencies [7e0bfce]
- Updated dependencies [c120dbd]
- Updated dependencies [32b5831]
- Updated dependencies [74554a3]
- Updated dependencies [e56112c]
- Updated dependencies [aeaaa44]
- Updated dependencies [43460b9]
- Updated dependencies [44a2332]
- Updated dependencies [f34dda6]
- Updated dependencies [488f4f5]
- Updated dependencies [15f9284]
- Updated dependencies [a4ca69a]
- Updated dependencies [1ff3a8f]
- Updated dependencies [61dd96f]
- Updated dependencies [b971924]
- Updated dependencies [6afa59d]
- Updated dependencies [e37ea4d]
- Updated dependencies [8f6d831]
- Updated dependencies [fa29803]
- Updated dependencies [b01bdbc]
- Updated dependencies [adbdbc5]
- Updated dependencies [6cc8dcd]
- Updated dependencies [ba77509]
- Updated dependencies [408ca2e]
- Updated dependencies [ec292cf]
- Updated dependencies [dc0ab6a]
- Updated dependencies [19e58e2]
- Updated dependencies [7e1b048]
- Updated dependencies [342808c]
- Updated dependencies [b3615f1]
- Updated dependencies [0b4022b]
- Updated dependencies [a60c913]
- Updated dependencies [5c5b67f]
- Updated dependencies [3f9e2ea]
- Updated dependencies [77f54bf]
- Updated dependencies [ccccdcc]
- Updated dependencies [48c91e9]
- Updated dependencies [2b52a5b]
- Updated dependencies [0f057b6]
- Updated dependencies [3875ae6]
- Updated dependencies [1c16889]
- Updated dependencies [1912237]
- Updated dependencies [fc29c74]
- Updated dependencies [95fb417]
- Updated dependencies [4ec3987]
- Updated dependencies [5b9402d]
- Updated dependencies [2cf9db7]
- Updated dependencies [dc1b986]
- Updated dependencies [655e8c0]
- Updated dependencies [041c8cf]
- Updated dependencies [e3277c3]
- Updated dependencies [cc6dfd9]
- Updated dependencies [7536721]
- Updated dependencies [9df3934]
- Updated dependencies [0b83e01]
- Updated dependencies [ebc6afe]
- Updated dependencies [6696056]
- Updated dependencies [0e06f3b]
- Updated dependencies [c1dfa52]
- Updated dependencies [2548ba5]
- Updated dependencies [9282578]
- Updated dependencies [ecf90b2]
- Updated dependencies [90ff10a]
- Updated dependencies [2bbebf5]
- Updated dependencies [369bcbe]
- Updated dependencies [3bd28e2]
- Updated dependencies [9347c1f]
- Updated dependencies [c164186]
- Updated dependencies [e7344f0]
- Updated dependencies [4d7e740]
- Updated dependencies [de091b5]
- Updated dependencies [6aa3188]
- Updated dependencies [ae7a35a]
- Updated dependencies [cf55914]
- Updated dependencies [17bd318]
- Updated dependencies [681868c]
- Updated dependencies [a9fb83e]
- Updated dependencies [2274894]
- Updated dependencies [e462186]
- Updated dependencies [b5853da]
- Updated dependencies [4ac9319]
- Updated dependencies [560b724]
- Updated dependencies [16c5473]
- Updated dependencies [b276d44]
- Updated dependencies [3f86dc5]
- Updated dependencies [172b4cf]
- Updated dependencies [67c98f6]
- Updated dependencies [b98fbc2]
- Updated dependencies [e7f69db]
- Updated dependencies [84156c7]
- Updated dependencies [e0f17a3]
- Updated dependencies [0bf85ea]
- Updated dependencies [1df29df]
- Updated dependencies [8a44ce7]
- Updated dependencies [ca753c0]
- Updated dependencies [8ecbe0f]
- Updated dependencies [6a4aec7]
- Updated dependencies [e4471e6]
- Updated dependencies [e8fcf55]
- Updated dependencies [fe677ae]
- Updated dependencies [8d1f7ab]
- Updated dependencies [cfc3bcf]
- Updated dependencies [dd1b803]
- Updated dependencies [03d6cb0]
- Updated dependencies [9e7824a]
- Updated dependencies [437bb0d]
- Updated dependencies [49144fc]
- Updated dependencies [e2c4e12]
- Updated dependencies [08c8484]
- Updated dependencies [93cfc3f]
- Updated dependencies [6ac33a5]
- Updated dependencies [443b2f4]
- Updated dependencies [7e7fab7]
- Updated dependencies [b09ce67]
- Updated dependencies [4df101c]
- Updated dependencies [6a6a17b]
- Updated dependencies [733822c]
- Updated dependencies [e5cf27d]
- Updated dependencies [a91d12a]
- Updated dependencies [bea6d2e]
- Updated dependencies [f415bcf]
- Updated dependencies [615c468]
- Updated dependencies [5f9d7d7]
- Updated dependencies [31d281d]
- Updated dependencies [569d4d2]
- Updated dependencies [9e9bb46]
- Updated dependencies [0d7ed5a]
- Updated dependencies [2aa25ef]
- Updated dependencies [0e1afe8]
- Updated dependencies [288611e]
- Updated dependencies [dfd8e39]
- Updated dependencies [89f87f2]
- Updated dependencies [28ad7e4]
- Updated dependencies [e6b7d8c]
- Updated dependencies [3062e50]
- Updated dependencies [40b315b]
- Updated dependencies [f2c7eef]
- Updated dependencies [7e36a3c]
- Updated dependencies [5a6267f]
- Updated dependencies [0bbe400]
- Updated dependencies [862b6ce]
- Updated dependencies [80153f5]
- Updated dependencies [26daf0b]
- Updated dependencies [826f327]
- Updated dependencies [7e5246d]
- Updated dependencies [b810ddb]
- Updated dependencies [7dc45eb]
- Updated dependencies [17e4f52]
- Updated dependencies [dcd3bce]
- Updated dependencies [2d91c9a]
- Updated dependencies [b285508]
- Updated dependencies [2c31070]
- Updated dependencies [7db1332]
- Updated dependencies [aeb0557]
- Updated dependencies [1c1b8c8]
- Updated dependencies [05077d4]
- Updated dependencies [ba5927f]
- Updated dependencies [75b2169]
- Updated dependencies [de8c973]
- Updated dependencies [65352b7]
- Updated dependencies [e956924]
- Updated dependencies [2304b16]
- Updated dependencies [c7ad16f]
- Updated dependencies [48efe91]
- Updated dependencies [fb38607]
- Updated dependencies [dc07593]
- Updated dependencies [e967cbd]
- Updated dependencies [8255a51]
- Updated dependencies [d1c01ff]
- Updated dependencies [9e1689f]
- Updated dependencies [b057434]
- Updated dependencies [f6ceddc]
- Updated dependencies [4c42fd1]
- Updated dependencies [5f392f0]
- Updated dependencies [a362e0e]
- Updated dependencies [f26fb8e]
- Updated dependencies [bc2ec80]
- Updated dependencies [0da638c]
- Updated dependencies [041d9fd]
- Updated dependencies [f03f6c7]
- Updated dependencies [b8ec127]
- Updated dependencies [cf79182]
- Updated dependencies [e81c4e5]
- Updated dependencies [28f9277]
- Updated dependencies [929d9e3]
- Updated dependencies [8a5240a]
- Updated dependencies [c1d54db]
- Updated dependencies [c7af6bd]
- Updated dependencies [1f0b565]
- Updated dependencies [23aa83c]
- Updated dependencies [357f499]
- Updated dependencies [80aef80]
- Updated dependencies [c3ebe4a]
- Updated dependencies [65ad77d]
- Updated dependencies [a61ae59]
- Updated dependencies [fb59fb5]
- Updated dependencies [a54ecaa]
- Updated dependencies [854639b]
- Updated dependencies [44c917a]
- Updated dependencies [613d35a]
- Updated dependencies [e08c8b0]
- Updated dependencies [0ee32ed]
- Updated dependencies [58b36fa]
- Updated dependencies [4792049]
- Updated dependencies [53ec0b1]
- Updated dependencies [71629a1]
- Updated dependencies [0a56d3b]
- Updated dependencies [f8e5790]
- Updated dependencies [d2c1d19]
- Updated dependencies [681871e]
- Updated dependencies [54e8234]
- Updated dependencies [288fe9c]
- Updated dependencies [d127f9b]
- Updated dependencies [4bbf766]
- Updated dependencies [c17b494]
- Updated dependencies [d414e2b]
- Updated dependencies [af98a04]
- Updated dependencies [43cbe14]
- Updated dependencies [c86d351]
- Updated dependencies [6e3462d]
- Updated dependencies [6e3e546]
- Updated dependencies [c4d1759]
- Updated dependencies [f7a9740]
- Updated dependencies [96451ec]
- Updated dependencies [9cdffbe]
- Updated dependencies [331a1a2]
- Updated dependencies [9788f1e]
- Updated dependencies [3cf6449]
- Updated dependencies [3cf6449]
- Updated dependencies [2bd53f1]
- Updated dependencies [5f9f846]
- Updated dependencies [5a95b0e]
- Updated dependencies [5d527f7]
- Updated dependencies [5bf2330]
- Updated dependencies [9165d5c]
- Updated dependencies [d9e1587]
- Updated dependencies [07150b3]
- Updated dependencies [143c715]
- Updated dependencies [fb2bccf]
- Updated dependencies [d2badf7]
- Updated dependencies [d64bcb6]
- Updated dependencies [d4f5232]
- Updated dependencies [396eae3]
- Updated dependencies [ecdfc94]
- Updated dependencies [f04be62]
- Updated dependencies [de1a611]
- Updated dependencies [4fba503]
- Updated dependencies [db76982]
- Updated dependencies [5cf58eb]
- Updated dependencies [66e266c]
- Updated dependencies [3b1dab9]
- Updated dependencies [7607076]
- Updated dependencies [1555ed4]
- Updated dependencies [776d64c]
- Updated dependencies [03b19d9]
- Updated dependencies [6154165]
- Updated dependencies [199002b]
- Updated dependencies [ab450f4]
- Updated dependencies [21ab410]
- Updated dependencies [025588a]
- Updated dependencies [a49e8ae]
- Updated dependencies [f3e3d59]
- Updated dependencies [9bd4344]
- Updated dependencies [51efbf1]
- Updated dependencies [9c44eed]
- Updated dependencies [bbca441]
- Updated dependencies [7cd5874]
- Updated dependencies [3cb84d0]
- Updated dependencies [119a02b]
- Updated dependencies [eea8787]
- Updated dependencies [7887077]
- Updated dependencies [29dd1a6]
  - @objectstack/spec@17.5.0
  - @objectstack/core@17.5.0
  - @objectstack/types@17.5.0

## 17.4.0

### Minor Changes

- 6136293: A `min`/`max` over a string-valued field is described as `string`, not `number` (#16098)
  
  The sibling population of the temporal fix. `min` and `max` return a value **of the aggregated field's own type**, so a `min` over a `text` / `select` / `lookup` / `autonumber` column carries a string — and `POST /api/v1/analytics/dataset/query` described every one of those columns as `type: "number"`, exactly as it did for the temporal family before the temporal half landed.
  
  What changed:
  
  - **`measureResultType` now answers `string` for the string-valued field types too**, in the same one table it already answered `time` from. No second mechanism and no new call site: the rule still answers `undefined` for "no correction", and `queryDataset`'s ADR-0021 result-column enrichment still applies it once, downstream of all four producers of the shape.
  - **The corrected spelling is `string`**, the `DimensionType` word a `lookup` or `string` DIMENSION column in the same response already carries (`dataset-compiler.dimensionType`). A textual measure spelled `text` would have been a sixth word in a five-word wire vocabulary, leaving every existing consumer branch unreached — the same argument that chose `time` over `datetime`.
  - **Membership is composed from `@objectstack/spec`'s own value classes** (`STRING_VALUE_TYPES`, `SINGLE_OPTION_TYPES`, `REFERENCE_VALUE_TYPES`) rather than re-listed, so what the platform says a field type STORES and what this rule says a `min` over it RETURNS cannot drift.
  
  Corrected: `text`, `textarea`, `email`, `url`, `phone`, `password`, `secret`, `markdown`, `html`, `richtext`, `code`, `color`, `signature`, `qrcode`, `select`, `radio`, `lookup`, `master_detail`, `tree`, `user`, `autonumber` — twenty-one members, each verdict read off the two shipped statements of what the type stores (the spec value contract and `driver-sql`'s DDL column switch).
  
  Deliberately NOT corrected, with the measurement recorded rather than a guess shipped as a declaration:
  
  - **`boolean` / `toggle`** — Postgres has no `min(boolean)` at all, SQLite answers `0`/`1` as numbers, and the driver seam has been recorded answering `false`/`true`. Three readings that disagree about whether a value exists and what kind it is. `DimensionType` does carry a `boolean` word, so the correction is spellable; it is not made.
  - **The JSON-column classes** (`multiselect` / `checkboxes` / `tags`, `composite` / `repeater` / `record` / `location` / `address` / `vector`, `json`) — no `min` over `jsonb` on Postgres, serialized TEXT on SQLite.
  - **The file types** (`image` / `file` / `avatar` / `video` / `audio`) — their stored form is mid-migration under ADR-0104 D3: the value contract already says an opaque `sys_file` id while the DDL still gives them a JSON column.
  - **`formula`** — its result type IS declared, on `FieldSchema.returnType`, but that key is not on `AnalyticsServiceConfig.sourceFieldMeta`'s return shape and is itself optional.
  - **`summary`** — measured NUMERIC on both shipped statements (the spec's `NUMERIC_VALUE_TYPES`, and `driver-sql`'s `table.float` column), so the `number` it already carried is correct rather than merely unexamined.
  
  Every member of `FieldType` now carries an explicit verdict, pinned by a test that walks the enum: a field type added to the spec fails that pin instead of silently inheriting the flat `number`.
- 07f40e5: A dataset measure's `fields[].type` stops contradicting the value beside it: a `min`/`max` over a temporal field is described as `time`, not `number` (#15768)
  
  `POST /api/v1/analytics/dataset/query` described **every** measure column as `type: "number"`, including a `min`/`max` over a `date` / `datetime` / `time` field whose value in the same response is an ISO instant. Measured on a real boot (`@objectstack/cli` 17.3.0, SQLite dev datasource):
  
  ```json
  {"rows":[{"oldest_last_update_at":"2026-07-04T07:00:00.000Z"}],
   "fields":[{"name":"oldest_last_update_at","type":"number","label":"Oldest touch","format":"relative"}]}
  ```
  
  `min` and `max` return a value **of the aggregated field's own type**, so that column carries an instant and the metadata denied it — which is enough on its own to keep a formatter that branches on the declared type from ever reaching a temporal branch.
  
  What changed:
  
  - **The measure column's type is resolved from the authored measure plus the source field's declared type**, in `AnalyticsService.queryDataset`'s ADR-0021 result-column enrichment — the same block that already resolves `label` / `format` / `currency` / `percentScale`, and the one seam every producer of the shape passes through on the way to the route, which relays that method's return verbatim. The rule itself is `measureResultType` in the new `measure-result-type.ts`, so the per-aggregate verdict has one home instead of four copies.
  - **The corrected spelling is `time`**, the `DimensionType` word a temporal DIMENSION column in the same response has always carried. A second temporal word in one wire position would have left every existing consumer branch unreached.
  - **Only `min` and `max` move.** `count` and `count_distinct` are numeric however temporal the column they read is; `sum` / `avg` over a temporal column are refused by no layer and answered by the backend (an epoch mean on SQLite, an error on Postgres), so there is no single value for a type to describe and none is invented; a derived measure is numeric by construction, because `computeDerived` coerces its operands with `Number()`. Row values are untouched on every path.
  - **Tiered "cannot answer, do not block".** A host with no source-field metadata wired, and a measure over a relationship PATH (which the source-field lookup resolves against the base object and therefore cannot answer), both leave the column exactly as the query layer produced it.
  
  `AnalyticsResult.fields[].type` and the `AnalyticsResultResponse` schema now state the vocabulary this position speaks and what each aggregate answers; neither declaration widens — the wire type was, and remains, a string.
- 6573af9: A draft-preview `min`/`max` answers the operand's own type instead of `0`, and a preview dimension column is described by its own type
  
  `POST /api/v1/analytics/dataset/query` has two producers of one response: the engine, and — when the request renders the as-if-published world over a pending seed draft (ADR-0037 P3) — `evaluateAnalyticsQueryOverRows`. The second one coerced every aggregate operand with `Number()` and dropped the non-finite ones, so a `min` / `max` over a non-numeric field answered `0`. Measured on one dataset and one row set, with two services differing only in whether a pending seed draft exists:
  
  ```
  live     {"category":"travel","latest_spend":"2026-05-12"}
  preview  {"category":"travel","latest_spend":0}
  ```
  
  That is not a mislabelled column: it is a different, wrong answer to the same query, with no refusal and no warning, on the path an author is looking at *while* authoring the dataset.
  
  What changed, per member of the closed `AggregationFunction` vocabulary:
  
  - **`min` / `max` return the winning operand in its own type.** Ordering goes through this file's shared `compare` — so an ISO date orders as a date, a BSON `Date` orders as its instant against wire text, and text orders the way `MIN(text_col)` does on a SQL face — with a numeric arm so a numeric column written as text (`'800'`) still orders numerically. `cross-object-rebucket.ts` settled the identical question for the recombination path: the value these two pick is a value OF the column, so it must come back in the shape the row carried.
  - **A group whose operand is null throughout answers `null`, not `0`** — `emptyGroupValueFor` (`@objectstack/spec/data`) rules `min` / `max` over nothing unanswerable, and `0` reads as a measurement nobody made.
  - **`count_distinct` answers a cardinality again.** Its arm was spelled `countDistinct`, a word no producer mints (`dataset-compiler` copies the spec's `count_distinct` through), so it was unreachable and the measure fell to the numeric default — answering a row count under the author's `count_distinct` name (measured: `3` where the live path says `2`).
  - **`count` stays a row count and `sum` / `avg` stay arithmetic.** Counting dates is still counting.
  - **`sum` / `avg` over a TEMPORAL operand is deliberately unchanged.** There is no defined answer — the SQL faces do not agree on one either — and refusing an incoherent aggregate/field-type pair is an open decision, not this fix's to invent.
  - **A dimension column is typed from the cube dimension**, the same expression both live producers use (`d?.type || 'string'`), so a `date` dataset dimension is `time` on the preview path as it already was on the live one. A MEASURE column keeps the `number` every producer mints; correcting that is the ADR-0021 descriptor pass's one rule, not a second copy here.
  
  Derived measures are untouched: `computeDerived` still coerces with `Number()` and answers `null` for a non-finite operand — but a derived ratio over a temporal `min` / `max` now sees a date instead of the spurious `0`, so it answers `null` on the preview path exactly as it already did on the live one.
- 54bb2f1: The analytics SQL compilers compile the case-sensitive text family per dialect, so a `$contains` policy on SQLite stops admitting rows it excludes (#15684)
  
  `$contains` / `$notContains` / `$startsWith` / `$endsWith` are case-SENSITIVE on every backend (#4706 Q2 = A). All three of `service-analytics`' SQL compilers emitted `col LIKE ? ESCAPE ?` on every dialect, and SQLite's `LIKE` folds ASCII case unconditionally — the fold cannot be turned off per statement, because `PRAGMA case_sensitive_like` is a connection-global switch. Measured on sql.js over the shared `FILTER_TEXT_ROWS` fixture, `{ name: { $contains: 'acme' } }` answered `['1','2']` — `ACME Corp` **and** `acme corp` — where `FILTER_TEXT_CASES` says `['2']`.
  
  On two of the three compilers that is a wrong chart. The third is `read-scope-sql.ts`, the ADR-0021 D-C read scope: a scope that **admits** rows the policy's case-sensitive predicate excludes is over-reach, not a loose filter — the same reading that file already applied to its own `LIKE` escaping. The `/analytics/sql` echo was wrong in a third way: it printed `LIKE` while the statement it claims to reproduce ran through a driver that has emitted `GLOB` on the SQLite dialects since #6518.
  
  What changed:
  
  - **The construct is chosen per dialect** (`text-match-sql.ts`), arm for arm with `driver-sql`'s own table: `GLOB` on SQLite (case-exact by definition, with its own `*` / `?` / `[` escaped class and no `ESCAPE` clause), `LIKE` over `CAST(… AS BINARY)` on MySQL, and `LIKE` **unchanged** on Postgres, where it is already exactly the ruled semantics. There is no single construct that is case-exact and parses on all three, so the dialect had to become an input rather than a guess.
  - **The dialect arrives from the driver that will execute the statement.** New optional `AnalyticsServiceConfig.sqlDialect`, wired by `AnalyticsServicePlugin` from `IDataEngine.getDriverForObject`. `SqlDriver.dialectName` is now public so that answer can be read without a second dialect-resolution table drifting behind the driver's own knex spellings; it is derived and read-only.
  - **A host that answers no dialect keeps the `LIKE` it always got** — "cannot answer, do not block". Postgres deployments see byte-identical SQL.
  
  `$icontains` is untouched: it keeps its own ASCII-only fold on both sides, and collapsing the two families onto one path would hand the case-exact family back the fold the ruling took away from it. `LIKE` escaping is unchanged wherever a `LIKE` is still emitted.
- a646120: The three SQL compilers in this package — the RLS read-scope lowering (`compileScopedFilterToSql`), `NativeSQLStrategy`'s own `where` and the `ObjectQLStrategy` SQL echo — compile a text operator over a column whose declared type stores no text to the contract's declared answer.
  
  `compileScopedFilterToSql(filter, alias, options?)` takes a new optional `nonTextColumn(field)` predicate; when it answers `true`, a positive text operator compiles to `1 = 0` and `$notContains` to `1 = 1` instead of a `LIKE` that coerces on SQLite (`5` renders `'5.0'`) and is refused at query time on Postgres (SQLSTATE 42883 — a 500 on a read scope the platform accepted). The service answers the predicate from the field metadata hook it already holds (`sourceFieldMeta`), exposed to strategies as `DatasetScopedStrategyContext.declaredFieldType`, and the two strategies pass it for the read scope and for the query's own text filters, so a query and its RLS scope answer one cell one way and the echo prints the statement that ran (`FILTER_TEXT_CASES`' `score` rows, maintainer ruling 2026-09-05). A host that wires no field metadata keeps the `LIKE` it always got, and every comparand refusal still runs ahead of the constant.

### Patch Changes

- dcad825: Analytics `$icontains` no longer compiles a `translate()` call on the `sqlite` and `mysql` dialects. On **SQLite** that function does not exist and the statement failed to parse — measured on the engine, not inferred. On **MySQL** the same construct was emitted and its arm is repaired the same way, but nothing was ever executed there: the MySQL arm is asserted as emitted TEXT only, on this face and on `driver-sql`'s alike, so no MySQL parse failure is claimed as measured.
  
  `$icontains` folds ASCII case on both sides of the comparison (#4706 Q1 = A). All three of this package's SQL compilers — the query's own `where` (`NativeSQLStrategy.buildFilterClause`), the ADR-0021 D-C read scope (`compileScopedFilterToSql`) and the `ObjectQLStrategy` echo of that statement — spelled that fold as `translate(col, 'ABC…', 'abc…')` on all four dialect values a compiler can see: `sqlite`, `mysql`, `postgres` and `unknown`, onto which `normalizeSqlDialect` maps everything else, an unset hook and `'oracle'` included. `translate()` is PostgreSQL/Oracle; SQLite has none. Measured on sql.js 1.14.1 (SQLite 3.49.1, the engine `driver-sqlite-wasm` runs), `SELECT translate('ABC','ABC','abc')` answers `no such function: translate` — so this was not a filter that returned the wrong rows, it was a statement the engine refused. On a SQLite datasource, an analytics `where` carrying `$icontains` and an **RLS read scope** carrying it were both unusable.
  
  The fold is now chosen per dialect, on the same construct table the case-exact text family already used, reached through one `fold` flag:
  
  - **SQLite** — `lower(col) GLOB lower(?)`. SQLite's `lower()` is ASCII-only (measured: `lower('CAFÉ')` is `cafÉ`), so this is the ruled fold rather than an approximation of it, and it runs.
  - **PostgreSQL** and the `unknown` residue — `translate()`, byte-for-byte what those two arms emitted before. Measured set for that word: this package's own suite pins six cells verbatim — `{NativeSQLStrategy, ObjectQLStrategy echo, compileScopedFilterToSql} × {dialect unset, 'postgres'}` for `{name: {$icontains: 'acme'}}`, full emitted SQL and the exact bound params — and the round-1 contract review widened it to **2,721 cells** (2,720 = `{undefined, 'postgres', 'unknown', 'oracle'} × 5 compiler paths × 8 filter shapes × 17 comparands`, plus the bare `{dialect: undefined}` cell), emitted at the merge-base blobs (all five hash-verified) and again at this head: **0 changed cells, 0 error cells**. Outside that set nothing is claimed — no PostgreSQL server was contacted, and on `sqlite` and `mysql` the bytes deliberately changed (340 of 680 cells each, all inside the four `$icontains` shapes).
  - **MySQL** — the nested-`REPLACE` fold over `CAST(… AS BINARY)`, matching what `driver-sql` emits for the same operator; the review measured the two faces byte-equal on 60 of 60 MySQL cells. Asserted as text only — no MySQL server is provisionable in the container that wrote this, so that cell is a declared skip, not a claimed pass.
  
  ⚠️ Carve-out, stated because it is the surviving half of the defect and not an aside: an `unknown` dialect that is really SQLite is **not** fixed by this change. The residue is reached by four constructions the round-1 contract review drove rather than reasoned — a `SqlDriver` given a **class** client or an unrecognised spelling (`'libsql'`), a host hook answering knex's own `'sqlite3'`, a directly-constructed public `AnalyticsService` with the optional `sqlDialect` omitted, and a `data` service without `getDriverForObject`. For each of them `translate()` still reaches the engine and still fails to parse, on the `where` path, the read scope and the echo alike. No in-repo SQLite driver lands there — `SqliteWasmDriver` and `TursoDriver` both answer `"sqlite"`, measured — so this is an embedder-composition population, not a shipped-driver one. Tracked as #16028.
  
  `$icontains` and the case-sensitive `$contains` family remain two separate constructs on every dialect the compilers accept — collapsing them would give `$contains` back the case fold #4706 Q2 = A took away from it. Measured set for that word: 510 cells (six dialect names — the four values above plus `'oracle'` and an unset hook, which both normalize to `unknown` — × 5 compiler paths × 17 comparands), 0 of them identical between the two families and no `$contains` cell carrying a fold.
  
  ⚠️ One deliberate divergence from `driver-sql`, recorded here rather than only in this package's source: `driver-sql`'s own `unknown` arm folds with `LOWER()`, this one keeps `translate()`. Each face keeps the residue it already had, and adopting `LOWER()` here would silently restore on PostgreSQL the Unicode fold #4706 Q1 = A rules out. The pointer exists on this side only; `driver-sql` carries no cross-reference back.
- fd014b1: Analytics `$icontains` no longer compiles a `translate()` call on the `unknown` dialect arm, so a datasource whose dialect nothing answered — which includes SQLite — gets a statement its engine can parse. **Graded `patch`:** no exported type, signature or option changes; the package's own contract for the operator (#4706 Q1 = A, an ASCII-only fold on both sides) is unchanged, and this repairs an arm that could not run rather than adding or retiring behaviour. What moves is emitted SQL text on one arm, measured and enumerated below.
  
  `normalizeSqlDialect` maps **everything it cannot name** onto `unknown`: an unset `sqlDialect` hook, `'oracle'`, `'libsql'`, a `SqlDriver` handed a knex Client **class** rather than a spelling. #15780 left that arm folding with `translate()` and recorded it as "never broken", which was true of the dialects the arm was *pictured* as — mssql and oracle, which have `translate()` — and false of the ones actually routed there. Measured on sql.js 1.14.1 (SQLite 3.49.1, the engine `driver-sqlite-wasm` runs), `SELECT translate('ABC','ABC','abc')` answers `no such function: translate`, so on all three of this package's compilers — the query's own `where` (`NativeSQLStrategy.buildFilterClause`), the ADR-0021 D-C read scope (`compileScopedFilterToSql`) and the `ObjectQLStrategy` echo — the statement failed to **parse**. It reached the client as a 500, not an ADR-0112 refusal. One of the four constructions that land there is a directly-constructed public `AnalyticsService` with its **optional** `sqlDialect` omitted: leaving out an optional field turned a documented operator into a 500.
  
  The `unknown` arm now folds with one nested `REPLACE` per ASCII letter — the chain the MySQL arm already used, minus its `CAST(… AS BINARY)`, so there is one builder and the two arms cannot fold different alphabets. `REPLACE` is the one string function every SQL dialect has, and the domain is the same 26-letter constant, so the fold is ASCII-only **by construction**:
  
  - **PostgreSQL / Oracle-like** — same result set as `translate()`. The chain equals the simultaneous `A`-`Z` map because no step can feed a later one: every replacement writes a lower-case letter and every later step matches an upper-case one. Measured on the engine over **every ASCII code point** plus accented, Greek, Cyrillic and dotted-I probes, required equal to the ASCII-only map exactly.
  - **SQLite-like** — it runs. Executed over the shared `FILTER_TEXT_CASES` `$icontains` rows through all three compilers on sql.js: the same row sets the `sqlite` arm is required to answer, including the `CAFÉ`/`café` pair that separates an ASCII fold from a Unicode one.
  - ⛔ **Not `LOWER()`**, which is what `driver-sql`'s own `unknown` arm folds with. `LOWER()` follows the collation, so adopting it would trade this parse failure for **silently wrong rows** on PostgreSQL — the Unicode fold #4706 Q1 = A rules out. ⚠️ Measuring `LOWER()` in this container proves nothing about that: SQLite's `lower()` is ASCII-only and passes the same fixture, which is exactly the trap of letting a green SQLite reading stand in for a PostgreSQL one. No PostgreSQL server was contacted.
  
  **Which cells moved.** The emitted SQL and bound params of `{NativeSQLStrategy, ObjectQLStrategy echo, compileScopedFilterToSql} × {undefined, 'unknown', 'oracle', 'libsql', 'postgres', 'sqlite', 'mysql'} × 5 text operators × 17 comparands` = **1,785 cells**, generated at this head and again with the emitter reverted to its merge-base blob (both legs hash-verified on disk and rebuilt, the marker's presence and absence checked in `dist/`): **204 moved, 1,581 byte-identical, 0 error cells either side.** Every moved cell is `$icontains` on one of the four dialect inputs that normalize to `unknown` (51 each = 17 comparands × 3 compilers). **0 of the 204 changed their bound params** — only the fold's spelling moved, never the escaping or the `ESCAPE` binding. Nothing moved on `postgres`, `sqlite` or `mysql`, and no case-exact operator moved on any dialect input.
  
  ⚠️ **The cost, stated rather than left to be found:** the predicate grows from 168 to 1,014 characters on the read scope (233 → 1,079 on the other two). Both constructs are non-sargable scalar expressions over the column, so the plan class is unchanged — what grows is statement text and per-row work, on the arm where the alternative was a statement that did not run.
  
  ⚠️ **The residue that remains**, because this arm is a residue and not a dialect: the fold is exact everywhere, but the comparison is `LIKE`, which on a case- or accent-insensitive collation (MySQL/MariaDB arriving here through the `'mariadb'` spelling #11756 deliberately leaves unrecognised; SQL Server) over-matches beyond ASCII. That is the **same** residue this arm's case-exact neighbour already carries and names — not a new one — and on those engines `translate()` did not run at all, so nothing that answered correctly before stops answering.
  
  `SqliteWasmDriver.dialectName` gains a direct pin. It answers `"sqlite"` only through an `isSqlite` override (the base class string-matches `config.client`, and this transport passes a class), that override had **0 direct test hits**, and it is the sole reason no in-repo SQLite driver reaches the arm above. The new pin includes the control: the base class answers `'unknown'` for that very config.
- d5d8d50: Correct the documented reason for rejecting `CAST(col AS BLOB) LIKE ?` as a portable case-exact construct.
  
  Four headers stated, as a universal fact about SQLite, that the construct "was measured to return NOTHING". That is not a property of SQLite: whether `LIKE` is false for a BLOB operand is fixed when SQLite is compiled, by `SQLITE_LIKE_DOESNT_MATCH_BLOBS`, and the two SQLite builds this project ships disagree about it. Measured over the shared `FILTER_TEXT_ROWS` fixture, `{ name: { $contains: 'acme' } }` compiled to that construct returns `[]` on better-sqlite3 13.0.3 (SQLite 3.53.4, flag compiled in) and `['1','2']` on sql.js 1.14.1 (SQLite 3.49.1, flag absent) — the latter being exactly the ASCII case-folding defect the construct was being considered to avoid.
  
  No behaviour changes and no conclusion changes: all four sites still reject the construct and still choose `GLOB`. The rejection is now stated in a form that does not depend on any particular return value — a construct whose meaning is decided by an upstream compile flag cannot carry a read scope, because it means two different things on the two builds shipped here. Two supporting readings are recorded alongside it: `typeof CAST(name AS BLOB)` is `'blob'` on both builds, so the CAST is not the part that differs, and `GLOB` answers identically on both.
  
  Documentation only. `@objectstack/spec` and `@objectstack/driver-turso` ship the corrected text in their published type declarations (and `spec` also publishes the corrected source file directly, via its `src/**/*.zod.ts` entry); for `@objectstack/driver-sql` and `@objectstack/service-analytics` the change reaches published output only through sourcemaps.
- 81919a7: `CubeRegistry`'s documentation now describes what the class actually does. Four claims it shipped were measured false against the built package; no behaviour changes, and the corrected text ships in `dist/index.d.ts`, where consumers read it.
  
  The class docblock said cubes reach the registry "from two sources: manifest definitions, and object schema inference". Neither half held. Two sources were missing — a compiled dataset's Cube (ADR-0021), registered under the dataset's name by `queryDataset`, and the ad-hoc Cube `ensureCube` / `inferCubeFromQuery` mints from the members a query references. And object schema inference is `inferFromObject`, which no path in this repository calls: its only in-tree caller is a unit test. The list now names the three sources that do write to the registry, and points at the method for the fourth door instead of advertising it as delivered.
  
  `inferFromObject`'s own "heuristic rules" list was wrong in three of five bullets. Driving the built package:
  
  - `number` / `currency` / `percent` fields mint one `sum` and one `avg` measure each — not the documented `sum`, `avg`, `min`, `max`. No `min` or `max` measure exists.
  - `boolean` fields become a `boolean` dimension and nothing else. The documented "`count` measure (count where true)" is not minted.
  - Every field becomes a dimension. The documented "all non-computed fields" implies an exclusion the code does not have, on a parameter that carries no such flag.
  
  The two accurate bullets (a default `count` measure, and `date` / `datetime` fields becoming `time` dimensions granulated day/week/month/quarter/year) are kept and stated in the form the run produced.
  
  The method's docblock now also records what it is: a published method with no in-repo caller, still callable by consumers through the package entry (`CubeRegistry`) or `AnalyticsService.cubeRegistry`, whose output does reach the wire because `getMeta()` serves its labels as `CubeMeta` titles.
- d770b3e: Analytics: a draft-preview dataset response now describes its columns like the live one
  
  `AnalyticsService.queryDataset`'s ADR-0037 P3 draft-preview branch returned before the
  ADR-0021 result-column enrichment ever ran, so a dataset queried while the base object had a
  pending seed draft came back with none of its column metadata: `fields[].label`, `format`,
  `currency`, `percentScale`, `builtinAggregate`, and the temporal `type` correction were all
  absent, on measure and dimension columns alike. A renderer then fell back to humanizing the
  raw measure name and guessing a percent scale from magnitude — so the same dataset in the
  same widget described its columns differently depending only on whether a pending seed draft
  existed, which is the surface an author is looking at while authoring the dataset.
  
  Every one of those keys is read off the authored dataset and the source object's field
  metadata, never off the rows, so the enrichment is now one method both paths call. Dimension
  VALUE label resolution (resolving a lookup id to a display name) stays skipped on the preview
  path deliberately: drafted seed rows reference lookups by name, so there is no id to resolve.
- Updated dependencies [fe0d9a4]
- Updated dependencies [ecd2158]
- Updated dependencies [f2b5e46]
- Updated dependencies [2ed6be6]
- Updated dependencies [ed7243d]
- Updated dependencies [6ba0db4]
- Updated dependencies [625b0c3]
- Updated dependencies [233222e]
- Updated dependencies [07f40e5]
- Updated dependencies [ceb4877]
- Updated dependencies [e9fcd6b]
- Updated dependencies [90e7e6d]
- Updated dependencies [2bdabe6]
- Updated dependencies [ca326b5]
- Updated dependencies [8f404a5]
- Updated dependencies [68437d4]
- Updated dependencies [abb140c]
- Updated dependencies [8333a6c]
- Updated dependencies [3e3ecb0]
- Updated dependencies [3030369]
- Updated dependencies [d5d8d50]
- Updated dependencies [e08892d]
- Updated dependencies [ae05f2e]
- Updated dependencies [b548e43]
- Updated dependencies [c463d03]
- Updated dependencies [64bd6a3]
- Updated dependencies [13c48c2]
- Updated dependencies [b0529e1]
- Updated dependencies [66dc6ab]
- Updated dependencies [6f94458]
- Updated dependencies [6e67b86]
- Updated dependencies [132742f]
- Updated dependencies [85a2459]
- Updated dependencies [50dc214]
- Updated dependencies [e89fa92]
- Updated dependencies [e9fcd6b]
- Updated dependencies [8976ea1]
- Updated dependencies [56fe8c2]
- Updated dependencies [acabd24]
- Updated dependencies [ab50c8f]
- Updated dependencies [6491463]
- Updated dependencies [89cf4d6]
- Updated dependencies [21c5dcb]
- Updated dependencies [6d4d5d3]
- Updated dependencies [ed5d557]
- Updated dependencies [bca21f7]
- Updated dependencies [e9fcd6b]
- Updated dependencies [2025b1f]
- Updated dependencies [1a7a7c9]
- Updated dependencies [e9fcd6b]
- Updated dependencies [ef3a138]
- Updated dependencies [68d5dfd]
- Updated dependencies [3e21cf0]
- Updated dependencies [4cfc93b]
- Updated dependencies [efd6b43]
- Updated dependencies [859ded3]
- Updated dependencies [fa125f3]
- Updated dependencies [74628d9]
- Updated dependencies [a646120]
- Updated dependencies [6f1ce7d]
- Updated dependencies [7778115]
- Updated dependencies [2c753fe]
- Updated dependencies [52804cd]
- Updated dependencies [3f89967]
- Updated dependencies [53cf263]
- Updated dependencies [21aabbc]
- Updated dependencies [9c270bb]
- Updated dependencies [76c8c5a]
- Updated dependencies [088f761]
- Updated dependencies [a84e1ce]
- Updated dependencies [bf1054a]
- Updated dependencies [d8d2776]
- Updated dependencies [222dc0f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [32c917d]
- Updated dependencies [f9a3c32]
- Updated dependencies [f502898]
- Updated dependencies [51ae731]
- Updated dependencies [af7edfe]
- Updated dependencies [b60f48b]
- Updated dependencies [c78c918]
- Updated dependencies [cf9bda4]
- Updated dependencies [784cb92]
- Updated dependencies [7629f4d]
- Updated dependencies [51df9fd]
- Updated dependencies [a7da4de]
- Updated dependencies [de0bcdd]
- Updated dependencies [70f7d6d]
- Updated dependencies [c677cda]
- Updated dependencies [554a160]
- Updated dependencies [f7da71e]
- Updated dependencies [7f745c3]
- Updated dependencies [5eb24f8]
- Updated dependencies [2a3decc]
- Updated dependencies [cc00df2]
- Updated dependencies [cc00df2]
- Updated dependencies [f4e6adf]
- Updated dependencies [ee4a59b]
- Updated dependencies [4db3c61]
- Updated dependencies [5ca314a]
- Updated dependencies [e0af1a8]
- Updated dependencies [4771bd9]
- Updated dependencies [414c1fc]
- Updated dependencies [22c0279]
- Updated dependencies [0db2947]
- Updated dependencies [92b5d7f]
- Updated dependencies [613bfbd]
- Updated dependencies [abae16a]
- Updated dependencies [094b8fd]
- Updated dependencies [c7aca0d]
- Updated dependencies [c1d8f98]
- Updated dependencies [8e0b297]
- Updated dependencies [d4f9b2a]
- Updated dependencies [5f7fa1d]
- Updated dependencies [87f0ccc]
- Updated dependencies [aedbaef]
- Updated dependencies [a727043]
- Updated dependencies [c5d6803]
- Updated dependencies [10d05bb]
- Updated dependencies [69602e5]
- Updated dependencies [c3ce76c]
- Updated dependencies [7936b29]
- Updated dependencies [46803fa]
- Updated dependencies [c2a336c]
- Updated dependencies [9f890d3]
- Updated dependencies [0bb2318]
- Updated dependencies [f7db8f4]
- Updated dependencies [1ecee3e]
- Updated dependencies [9408b7f]
- Updated dependencies [e9fcd6b]
- Updated dependencies [9bcd9be]
- Updated dependencies [b398ad2]
- Updated dependencies [99261a7]
- Updated dependencies [81b426f]
- Updated dependencies [001af1c]
- Updated dependencies [fb77aa5]
- Updated dependencies [3d3f60e]
- Updated dependencies [581d8f8]
- Updated dependencies [f81afe3]
- Updated dependencies [40a44b9]
- Updated dependencies [f89812e]
- Updated dependencies [7a7fb03]
- Updated dependencies [8fd246d]
  - @objectstack/spec@17.4.0
  - @objectstack/core@17.4.0
  - @objectstack/types@17.4.0

## 17.3.0

### Minor Changes

- 74cee59: Resolve `{current_user_id}` (and every other filter placeholder) on the direct analytics query path, at parity with the list path and the dashboard dataset path.
  
  What changes for an app author: a widget or report whose filter says `owner: '{current_user_id}'` used to render `0` for every viewer whenever the query reached the SQL strategy — the literal text was bound into the `WHERE` and matched no row, silently. Now the same filter expression means the same thing on every surface: `AnalyticsService.query` and `generateSql` expand `where`, `timeDimensions[].dateRange`, and a registered dataset's own filter / measure filters against the requesting user before any strategy compiles, so each viewer gets their own rows. A placeholder that cannot be resolved — an unknown spelling, or `{current_user_id}` on an unauthenticated request — now refuses loudly with `FILTER_TOKEN_UNKNOWN` / `FILTER_TOKEN_UNRESOLVED` (HTTP 400) instead of charting a plausible zero.
  
  This also closes a gap on the dashboard dataset door: the dataset-scope channel used to hand strategies the registry's unresolved filter copy, which was ANDed in beside the resolved one (`owner = $viewer AND owner = '{current_user_id}'`) and selected nothing.
- 399ecad: `ObjectQLStrategy` now refuses a cross-object leaf in a compiled measure's own `filter`, on both of its doors, instead of sending it to an engine that cannot join (#11461). This is the third producer of a predicate on that path — after the caller's `where` and the dataset's definition-level `filter` (#10861) — and the one `filterMemberView` did not fold in: #10413 phase 2 lowers `measureFilters[m]` onto that measure's `aggregations[].filter` entry (#10576), and the envelope check enumerated only two origins while its `query.measures` arm read each measure's resolved *field* and never its filter.
  
  Measured on one fixture before the change, both doors in one run: a measure declaring `filter: { 'account.region': 'West' }` on a cube with `include: ['account']` was ACCEPTED, `engine.aggregate` received `{field:"*",method:"count",alias:"west_count",filter:{"account.region":"West"}}`, and an honest evaluator answered `west_count: 0` where the truthful answer was `2` — beside a correct `total_count: 3`, so the wrong number came back wearing the same response shape as the right one. The `/analytics/sql` echo rendered `COUNT(CASE WHEN account.region = $1 THEN 1 END)` over a `FROM` carrying no join at all. Both doors now answer `INVALID_FIELD`/400 before the engine is reached, naming the offending field, the dataset, and — the locator neither sibling refusal has — the measure whose declaration holds the leaf.
  
  Ordinary per-measure filters are unaffected and still reach the engine carrying their own `aggregations[].filter`, and a cross-object filter declared on a measure a query does not ask for changes nothing: only the measures in `query.measures` are judged, which is exactly the set both doors lower. The same definition remains valid on a native-SQL driver, which the refusal says.
- d5b330d: feat(spec,analytics): `AnalyticsResult.fields[].builtinAggregate` — a closed discriminator for a measure column whose display name is the server's built-in default (#14492)
  
  **What a consumer sees.** `queryDataset()` (and `POST /api/v1/analytics/dataset/query`,
  which relays the result verbatim) now carries an optional
  `fields[].builtinAggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'`
  on a measure column. It is present exactly when the dataset measure behind the
  column declares an `aggregate` and **no** `label` — the producer then has nothing
  but the aggregate to name the column by, so it says which aggregate that is. It is
  absent whenever the author declared a label (a plain string or an inline locale
  map, even one with no entry for the request locale: an author's text is never
  re-labelled by a consumer), and absent on dimension columns and derived measures.
  The vocabulary is `AggregationFunction` (`data/query.zod.ts`), the one closed
  aggregate enum — no second spelling. `AnalyticsResultResponseSchema`
  (`api/analytics.zod.ts`) mirrors the member, refusing a spelling outside the enum.
  
  **Why.** An AI-built dashboard's "count of customers by status" chart showed the
  English axis title "Count" on a Chinese UI. The renderer (objectui
  `buildChartSeries()` / `labelOf()`) treats `fields[].label` as resolved author
  content and passes it through verbatim — correctly, since a real custom label
  ("Tasks") must survive. What it could not tell apart was an author's text from
  the server's built-in default for a bare `count`. Guessing from the label text
  was refused (it would catch an author who really named a field `Count`, and break
  the moment the default is spelled in another language); translating on the
  server was not taken (it copies the front end's language decision into the
  producer and leaves nothing for a per-widget override). The ruling (2026-09-02,
  option B) is a structured discriminator on the contract: the consumer prefers a
  locale lookup keyed by `builtinAggregate` — mirroring its existing
  `report.aggregate.*` keys — and falls back to `label`, then `name`.
  
  **Producer-side changes.**
  
  - `@objectstack/service-analytics` — `queryDataset`'s measure enrichment sets
    `builtinAggregate` from the dataset measure's own `aggregate` when the measure
    has no authored `label`. Judged on the authored key, never on the resolved
    string.
  - `@objectstack/spec` — the `dataset` create seed (`metadata-create-seeds.ts`)
    drops its hardcoded `label: 'Count'` from the seeded `count` measure, so a
    dataset created from Studio is a built-in default (wire: `builtinAggregate:
    'count'`) instead of an authored English literal. `getMeta()` for such a
    dataset now titles the metric by its name (`count`) rather than `Count`;
    `CubeMeta.measures[].type` already carried the aggregate there.
  
  Purely additive: no key is removed or renamed, no authorable schema changes shape,
  and a consumer that ignores the member sees exactly the response it saw before.

### Patch Changes

- c8be110: refactor(service-analytics): derive the analytics auto-bridge's engine view from the declared contracts (#11833)
  
  `plugin.ts` named the data engine through a consumer-local structural
  `DataEngineLike` — the second of the two sites #11833 records, after the
  datasource half that landed as PR #12011. It is now derived from the declared
  contracts: `IDataEngine.aggregate` / `execute?` /
  `resolveEffectiveDatasource?` / `getDriverForObject?` and
  `IObjectQLEngine.getObject`. Optionality is preserved exactly — `aggregate`
  required, everything else `Partial<>` — because these probes are the plugin's
  graceful-degradation seam.
  
  **Why this is `patch` and not a type-only no-op.** Four of the five members
  substitute with no behaviour change. The fifth does not: the deleted structural
  type declared `aggregations[].function` as `string`, while the contract
  declares the six-value `AggregationFunction`. The bridge therefore forwarded
  whatever method string reached it. That forward is now parsed with the spec's
  own enum, so a method the engine contract does not declare is refused at the
  bridge — loudly, naming the aggregation and the legal vocabulary — instead of
  reaching the engine, where `driver-sql` blamed a `function` key the author
  never wrote and the in-memory evaluator answered `null` for every bucket under
  the author's own measure name.
  
  No authored analytics can trigger the new refusal: the one reachable producer
  of a non-aggregate method — a custom-SQL measure (`AggregationMetricType`
  `number` / `string` / `boolean`) — is already refused earlier, caller-facing,
  by `ObjectQLStrategy.resolveMeasureAggregation` (#12209). What is left is host
  drift (a cube object registered without meeting `CubeSchema`), which is why
  the new refusal is a bare `Error` in the undeclared-500 tier rather than an
  ADR-0112 400 that would blame the caller for something they did not write.
- aa16721: fix(service-analytics): the consumer-local `executeAggregate` config mirrors narrow `aggregations[].method` to `AggregationFunction` (#12940)
  
  #12776 narrowed the contract — `StrategyContext.executeAggregate`'s
  `aggregations[].method` went from `string` to the six-value
  `AggregationFunction` — but this package's two CONSUMER-LOCAL config mirrors
  of that same slot kept declaring `string`, so the compile-time vocabulary the
  narrowing bought for strategy authors stopped at the package boundary and
  never reached the people who write a custom bridge.
  
  FROM → TO, at all three sites the tree carries (the card enumerated two):
  
  - `AnalyticsServicePluginOptions.executeAggregate` (`plugin.ts`) —
    `aggregations[].method: string` → `AggregationFunction`. This is the
    declaration an app author's own `executeAggregate` bridge is typed against.
  - `AnalyticsServiceConfig.executeAggregate` (`analytics-service.ts`) — the
    same narrowing on the config twin whose own comment says it is kept in
    lockstep with `StrategyContext.executeAggregate`; that claim is true again,
    and now names the member so the next drift is visible.
  - `parseEngineAggregateFunction`'s `method` parameter (`plugin.ts`), the
    auto-bridge's runtime parse — narrowed for the same reason: it was the
    third place a reader was told this vocabulary is open.
  
  Who breaks at compile time on upgrade: CALLERS that fill `method` with a
  value typed `string` (or a literal outside the six) when invoking one of
  these bridges — the values the bridge already refused at runtime (#11833).
  IMPLEMENTORS are source-compatible: a handler that accepts `method: string`
  accepts a superset and stays assignable to the narrowed member (parameter
  contravariance), which is why the ~nine test doubles in this package that
  declare their own `{ field, method: string, alias }` mirrors still compile
  untouched.
  
  No runtime change. The auto-bridge's runtime parse-and-refuse (#11833) stays
  exactly where it was — with both ends of the `method` → `function` rename now
  declaring the same enum, it is defence in depth behind a compile-time check
  rather than the only check, and the two comments that explained it by
  pointing at the old `method: string` declaration say so instead.
- e7191ce: fix(build): give each `exports` condition its own `types` target in the 28 dual-build packages (#13112)
  
  **Published-surface change, zero runtime change.** No emitted byte moves; what
  moves is which declaration file a resolver READS. Maintainer ruling 2026-08-29
  (decision batch #3, verbatim 「同意」) chose declaring the files over deleting
  them.
  
  ## What was wrong
  
  These 28 packages are `"type": "module"` and dual-built, and each spelled one
  `types` condition as a **sibling** of `import`/`require`:
  
  ```json
  "exports": { ".": {
    "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs"
  } }
  ```
  
  A sibling `types` answers for **both** conditions, so a CommonJS consumer was
  handed `dist/index.d.ts` — an ES-module declaration, because the package is
  `"type": "module"` — for an entry point it reaches with `require`. Measured with
  `tsc --traceResolution` on a `"type": "commonjs"` fixture at `moduleResolution:
  node16`:
  
  ```
  error TS1479: The current file is a CommonJS module whose imports will produce
  'require' calls; however, the referenced file is an ECMAScript module and cannot
  be imported with 'require'.
  ```
  
  The JavaScript at `dist/index.cjs` loads perfectly (`check:dual-build-cjs-loads`
  has asserted that for months). It is the **types** that told the consumer the
  supported `require` entry point could not be required. The `dist/index.d.cts`
  twin tsup emits beside it — 36 files, 5,517,701 B on this build — was named by
  no condition at all and shipped in every tarball unreachable.
  
  ## What changed
  
  Each condition now names its own declaration, the shape TypeScript documents:
  
  ```json
  "exports": { ".": {
    "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  } }
  ```
  
  33 entry points across 27 packages, subpaths included. The root `types` field is
  untouched, so `node10` resolvers are unaffected; the `import` condition resolves
  exactly what it resolved before, measured as an unchanged control in the same
  run.
  
  ## `@objectstack/core` is deliberately NOT changed
  
  Splitting a declaration in two makes TypeScript compare it nominally, and
  `ObjectKernel` carries a `private plugins` member that reaches every plugin
  through `PluginContext.getKernel()`. With core split, whole-repo `pnpm build`
  fails in `@objectstack/verify` with 5 × TS2345 ("Types have separate
  declarations of a private property 'plugins'"); with core held back and the
  other 27 split, 71/71 tasks pass. So core keeps the sibling-`types` shape and
  its two `.d.cts` files (220,854 B) stay unreachable, declared as such in
  `check:dual-build-cjs-loads`. Splitting it needs a decision about core's public
  types, not about an exports map.
  
  ## For consumers
  
  - **ESM consumers: nothing changes.** Same declaration file, byte for byte.
  - **CJS consumers under `node16`/`nodenext`: TS1479 goes away** and the
    declarations they get are the ones built for CommonJS.
  - **`node10` / `moduleResolution: node` consumers: nothing changes** — they never
    read `exports`.
  - Nothing is removed: every path that resolved before still resolves.
  
  Packages that are CJS-first (`require` → `./dist/index.js`, no `"type": "module"`)
  were already correct and are untouched — their `dist/index.d.ts` really is the
  CommonJS declaration. Their ESM mirror (an unreachable `.d.mts` under the
  `import` condition) is a separate, larger population and is filed separately per
  the ruling, not fixed here.
  
  `check:dual-build-cjs-loads` grew a fourth invariant (TYPED) that reds on the old
  shape, so the drift cannot return silently.
- 017130a: The ObjectQL analytics strategy now refuses a custom-SQL measure (`AggregationMetricType` `number` / `string` / `boolean`) with a loud `400 INVALID_FIELD` naming the measure and its metric type, instead of forwarding the raw SQL expression into `engine.aggregate` — where `driver-sql` rejected it blaming a `function` key the author never wrote, and the in-memory evaluator silently answered `null` for every bucket under the measure's own name.
  
  What stops being served, and for whom: on deployments whose driver has no native SQL capability (the ObjectQL aggregate path — e.g. Mongo or in-memory), a query or dataset widget selecting a custom-SQL measure now answers a 400 that says to use an aggregate measure (count/sum/avg/min/max/count_distinct) or run the cube on a native-SQL driver. Those queries previously "succeeded" with a per-bucket `null` (or a mis-attributed driver error), never with a correct number. Native-SQL driver behaviour is unchanged: custom-SQL measures still run there, emitted verbatim.
- 466b389: **Fix:** `/api/v1/analytics/query` on the ObjectQL door (MongoDB, the memory driver, or any deployment whose driver reports `objectqlAggregate` but not `nativeSql`) now honours a measure's own scoped `filter` — `won_count` and `won_amount`-style conditional measures answer the same numbers the dashboard door and the native-SQL door already did (#10413 phase 2).
  
  `ObjectQLStrategy.execute` lowers each measure's `filter` into the ONE aggregation it belongs to, via the per-aggregation `filter` field #10576 added to `engine.aggregate`'s contract (SQL `FILTER (WHERE …)` semantics) — not into the whole-call filter, which would have narrowed every measure (a fix shaped that way would make a conditional measure right while making every unconditional sibling measure in the same query wrong). An aggregation with no measure filter is unchanged and keeps the native-pushdown-eligible shape.
  
  `ObjectQLStrategy.generateSql` (the `/analytics/sql` echo) renders the same conditional aggregate — `COUNT(CASE WHEN … THEN … END)`-style — so the preview stays an honest description of what `execute()` now actually runs, matching the native-SQL strategy's existing echo for the same class of measure.
  
  Phase 1 (PR #10758) already ANDed a dataset's definition-level `filter` into the whole-call filter on this door; this closes the remaining half of the two-door disagreement #10413 reported. `NativeSQLStrategy` (#10298 / PR #10411) is unaffected by this change.
- b0d7d54: `ObjectQLStrategy` now refuses a read scope that does not bind, before handing it to the engine (`READ_SCOPE_COMPILE_FAILED` / 500). That strategy merges `StrategyContext.getReadScope` output straight into the `FilterCondition` it gives `engine.aggregate` and never reaches `compileScopedFilterToSql`, so the empty-`$nin` refusal that compiler gained guarded the NativeSQL path and the `/analytics/sql` echo only. Measured against a real engine, a non-RLS scope provider handing `{ f: { $nin: [] } }`, `{ $not: { f: { $in: [] } } }`, `{ $not: { f: [] } }` or `{ $not: { f: { $in: [], $ne: 'x' } } }` received the WHOLE TABLE on any query this strategy served; all four are now refused, at both engine-bound merges (the aggregate filter and the FK→attribute resolution). Deliberately unchanged: `$in: []` keeps its ruled constant-FALSE fold, so the RLS compiler's live composite — an emptied membership `$or`-ed beside an own-rows grant — still admits exactly the own rows; and the NativeSQL path and the SQL echo keep the disposition they already had.
- 967402a: The analytics read-scope compiler (`read-scope-sql.ts`) now refuses an empty `$nin` (`READ_SCOPE_COMPILE_FAILED` / 500) instead of folding it to constant TRUE. An emptied exclusion ("NOT IN () excludes nothing") vacated the whole read scope — every row admitted — on the ADR-0021 lowering, where a widening is scope over-reach; no in-repo producer can emit the shape (the CEL lowering never emits `$nin`, and the RLS guard drops even-polarity empty-`$nin` policies upstream), so the refusal costs no live traffic. Deliberately asymmetric: `$in: []` keeps its ruled constant-FALSE fold (#5322/#5243), which the RLS compiler's inert positive composite — an emptied membership `$or`-ed beside an own-rows grant — depends on.
- 5c7cbe3: Refuse a non-binding (vacating) read scope at the two remaining `getReadScope` merge sites: the `/analytics/sql` echo (`ObjectQLStrategy.generateSql`) and `NativeSQLStrategy.applyReadScope`. The `$not`-over-`$in: []` family compiled to a constant-TRUE predicate on those routes, so the echo rendered — and the native strategy actually executed — a whole-table `WHERE` for a scope the ObjectQL execution path already refused (#13640). All three faces now answer one verdict, in the same `READ_SCOPE_COMPILE_FAILED` / 500 envelope; the ruled `$in: []` zero-rows reduction, the live RLS empty-membership composite, and `compileScopedFilterToSql` itself (the ruled #13571 residue included) are unchanged.
- a3c4215: fix(service-analytics): wire the `typecheck` script so turbo stops silently no-opping the gate, and clear the 10 type errors it was hiding (#12939)
  
  `packages/services/service-analytics/package.json` declared only `build` and
  `test`. Root `typecheck` is `turbo run typecheck`, which **no-ops a package
  that has no such script and reports success** — so no tsc read this package's
  `src/` from the typecheck lane at all. `build` is tsup (esbuild; the DTS pass
  processes declarations only) and `test` is vitest (esbuild transform), and
  neither type-checks. The package was reached only by the `check:type-check-debt`
  ratchet, which asserts the error count does not *grow* — never that it is zero.
  
  Adding the one-line script (mirroring its sibling `service-settings`, repaired
  the same way in #7925) makes the task real. The tests are already inside the
  program — the package `tsconfig.json` includes `src` and the tests live in
  `src/__tests__/**` — so `tsc --noEmit --listFiles` lists **83 of the 83**
  `*.test.ts` files on disk. The new gate reads the tests, not just the source.
  
  All 10 errors were stale tests, not source defects; no non-test source file
  changed. Nothing was silenced: no `any` added, no `@ts-expect-error`, no
  `@ts-nocheck`, `strict` untouched, and the tsconfig `include`/`exclude` are
  byte-identical — excluding the tests would have converted a missing gate into
  a lying one.
  
  - `__tests__/measure-source-field-gate.test.ts` (7 x TS2339). `promise.catch(fn)`
    does not drop the resolved branch from the type, so
    `service.query(...).catch((e) => e as Error)` was `AnalyticsResult | Error`
    and every `err.message` / `err.field` / `err.member` / `err.param` read was a
    property access on `AnalyticsResult`. A local `refusalOf()` helper narrows it
    once via `then<never, Refusal>`; as a bonus the resolved branch now fails by
    name instead of surfacing later as `expect(undefined).toMatch(...)`.
  - `__tests__/objectql-timedimension-projection.test.ts` (2 x TS7053). The
    `TABLE` fixture was inferred as `{ id: number; due_date: string; priority:
    string }[]` and the aggregate stand-in indexes it by a computed `string` key.
    Annotated as the `Row` (`Record<string, unknown>`) the file already declares.
  - `__tests__/analytics-service.test.ts` (1 x TS6133). An unused
    `AnalyticsDriverCapabilities` type import. The capability literals in this
    file are inline `ctx` objects checked contextually at each `canHandle` call
    site, so the import added no coverage and is removed.
  
  `service-analytics` graduates out of the `check:type-check-coverage` DEBT
  ledger: 65/78 -> 66/78 workspace packages type-checked, 382 -> 372 frozen raw
  errors, 13 -> 12 ledger entries.
- d028b37: fix(spec): `StrategyContext.executeAggregate` `aggregations[].method` narrows from `string` to `AggregationFunction` (#12776)
  
  <!-- adr-0087: registered strategy-context-aggregation-method-narrowed -->
  
  **BREAKING** accept-set narrowing on a published contract, landing after the
  v17.0.0 cut (the lockstep launch-window convention ships it as `minor`).
  
  Two spec-declared surfaces described the same slot and disagreed about its
  type: `IDataEngine.aggregate`'s `aggregations[].function` is the closed
  six-value `AggregationFunction` enum, while the analytics strategy contract's
  `StrategyContext.executeAggregate` declared the same value as
  `aggregations[].method: string`. The analytics bridge renames one to the
  other, so nothing on the analytics side of that seam was compile-checked
  against the engine's vocabulary — a strategy author (very often an AI) got
  no compile-time help and hit the bridge's runtime refusal instead.
  
  FROM → TO:
  
  - `aggregations[].method: string` →
    `aggregations[].method: AggregationFunction`
    (`'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'`, the spec's
    own enum from `@objectstack/spec/data`). One slot, one declaration.
  
  Who breaks at compile time on upgrade:
  
  - external CALLERS of `StrategyContext.executeAggregate` that fill `method`
    with a value typed `string` (or a literal outside the six) — the values the
    bridge already refused at runtime (#11833) now fail `tsc`.
  - external IMPLEMENTORS of `StrategyContext` stay source-compatible: a
    handler that accepts `method: string` accepts a superset and remains
    assignable to the narrowed member.
  
  The bridge's runtime parse-and-refuse (#11833) stays as defence in depth.
  In-repo, `ObjectQLStrategy`'s aggregation locals now carry the enum
  end-to-end (`@objectstack/service-analytics`, runtime behaviour unchanged —
  the census measured every reachable producer already emitting enum-legal
  values only).
- a40c0f9: Guard the analytics record-label lookup with `assertReadScopeCannotVacate` — the fourth read-scope door
  
  `AnalyticsServicePlugin`'s `fetchRecordLabels` hook `$and`s the **referenced** object's read scope with an `id $in [...]` filter and hands the result straight to `executeAggregate`. Unlike the three faces unified previously (the ObjectQL engine merge, the `/analytics/sql` echo merge, and `NativeSQLStrategy.applyReadScope`), it met neither `compileScopedFilterToSql` nor the vacancy guard, so a read scope that lowers to a boolean constant — the `$not`-over-`$in: []` family reachable from any out-of-repo `StrategyContext.getReadScope` producer — let that per-record read run effectively unscoped for the ids in hand, surfacing the display names the referenced object's RLS exists to hide.
  
  The hook now calls the already-exported `assertReadScopeCannotVacate` on the referenced object's scope before composing the filter, refusing in the same envelope as its siblings (`READ_SCOPE_COMPILE_FAILED` / 500). No behaviour changes for scopes that bind: an ordinary referenced-object scope still narrows the label lookup, and the `$in: []` zero-rows reduction (including the live RLS composite that pairs it with an own-rows grant) still passes through untouched. The read-scope SQL compiler is unchanged.
- Updated dependencies [809d417]
- Updated dependencies [387e231]
- Updated dependencies [f794e4e]
- Updated dependencies [cae2169]
- Updated dependencies [b812a54]
- Updated dependencies [2d4fa75]
- Updated dependencies [0e4e51b]
- Updated dependencies [e84bbf6]
- Updated dependencies [effae80]
- Updated dependencies [efb3513]
- Updated dependencies [d62f990]
- Updated dependencies [c45d8e6]
- Updated dependencies [2e3e8c7]
- Updated dependencies [e621291]
- Updated dependencies [655b106]
- Updated dependencies [40a93b5]
- Updated dependencies [101ad2c]
- Updated dependencies [d5b330d]
- Updated dependencies [dda969c]
- Updated dependencies [1f45690]
- Updated dependencies [277948f]
- Updated dependencies [8bdd955]
- Updated dependencies [f3bbbef]
- Updated dependencies [4f24e9d]
- Updated dependencies [e27583e]
- Updated dependencies [4bd6faa]
- Updated dependencies [86cbe37]
- Updated dependencies [6a180e4]
- Updated dependencies [474242f]
- Updated dependencies [63cd487]
- Updated dependencies [bd4aa4e]
- Updated dependencies [803eaab]
- Updated dependencies [f8e8f03]
- Updated dependencies [983edf1]
- Updated dependencies [eae824e]
- Updated dependencies [f6fa22c]
- Updated dependencies [8a483b3]
- Updated dependencies [97bcd99]
- Updated dependencies [df59de0]
- Updated dependencies [96e25a8]
- Updated dependencies [f75a38a]
- Updated dependencies [7a25e7d]
- Updated dependencies [1fa05a6]
- Updated dependencies [c85a265]
- Updated dependencies [dcb10a5]
- Updated dependencies [773a999]
- Updated dependencies [35dffea]
- Updated dependencies [d8024f0]
- Updated dependencies [8120808]
- Updated dependencies [776a098]
- Updated dependencies [5060877]
- Updated dependencies [4f6325d]
- Updated dependencies [52954c0]
- Updated dependencies [2aa8456]
- Updated dependencies [93809a3]
- Updated dependencies [7c0d0c3]
- Updated dependencies [daae7aa]
- Updated dependencies [8dc22d6]
- Updated dependencies [279431e]
- Updated dependencies [948dd6b]
- Updated dependencies [3b4c56c]
- Updated dependencies [ae8edd2]
- Updated dependencies [e25403c]
- Updated dependencies [a81aa9d]
- Updated dependencies [64baa68]
- Updated dependencies [9fa70d7]
- Updated dependencies [09db64a]
- Updated dependencies [92916e7]
- Updated dependencies [a84f3ea]
- Updated dependencies [f2eaae8]
- Updated dependencies [56c093c]
- Updated dependencies [c09451b]
- Updated dependencies [ba64877]
- Updated dependencies [7345308]
- Updated dependencies [79b6a22]
- Updated dependencies [30d96ab]
- Updated dependencies [f658793]
- Updated dependencies [c95ad19]
- Updated dependencies [e58ea8b]
- Updated dependencies [4a17645]
- Updated dependencies [3795c5f]
- Updated dependencies [8ab926b]
- Updated dependencies [7317cf2]
- Updated dependencies [e25e839]
- Updated dependencies [5997207]
- Updated dependencies [8b13cc8]
- Updated dependencies [4a4a35d]
- Updated dependencies [86e765a]
- Updated dependencies [1d7e76a]
- Updated dependencies [53dc739]
- Updated dependencies [fd289be]
- Updated dependencies [03bf7b1]
- Updated dependencies [f90e820]
- Updated dependencies [18d816a]
- Updated dependencies [e8bd715]
- Updated dependencies [b91c351]
- Updated dependencies [a28a3c0]
- Updated dependencies [daeaaf9]
- Updated dependencies [c459da6]
- Updated dependencies [e914733]
- Updated dependencies [f887e52]
- Updated dependencies [881f8d8]
- Updated dependencies [3bfa1e6]
- Updated dependencies [0a8ebf3]
- Updated dependencies [901355c]
- Updated dependencies [34ce8e7]
- Updated dependencies [33681ea]
- Updated dependencies [bfe13c8]
- Updated dependencies [0fb3044]
- Updated dependencies [4635f3e]
- Updated dependencies [fd289be]
- Updated dependencies [ee3595c]
- Updated dependencies [b2eab95]
- Updated dependencies [93940d4]
- Updated dependencies [3a04b01]
- Updated dependencies [45b9051]
- Updated dependencies [b9e9227]
- Updated dependencies [d395692]
- Updated dependencies [5894d30]
- Updated dependencies [a3765f6]
- Updated dependencies [2d5cee3]
- Updated dependencies [e22158f]
- Updated dependencies [7404925]
- Updated dependencies [0c2334f]
- Updated dependencies [778c59f]
- Updated dependencies [d2619fd]
- Updated dependencies [af56546]
- Updated dependencies [6acb11a]
- Updated dependencies [33c5fd3]
- Updated dependencies [20b0fdb]
- Updated dependencies [905019b]
- Updated dependencies [a286411]
- Updated dependencies [98c0d33]
- Updated dependencies [368a82e]
- Updated dependencies [a3d5724]
- Updated dependencies [93ea19b]
- Updated dependencies [9ee2dcf]
- Updated dependencies [8cb96ec]
- Updated dependencies [8f10a79]
- Updated dependencies [6269a55]
- Updated dependencies [a17da05]
- Updated dependencies [a8c00e2]
- Updated dependencies [22e5236]
- Updated dependencies [0fb8760]
- Updated dependencies [e5ce2ed]
- Updated dependencies [be21955]
- Updated dependencies [bc56e18]
- Updated dependencies [be21955]
- Updated dependencies [a9ee989]
- Updated dependencies [4d0d944]
- Updated dependencies [15d58db]
- Updated dependencies [d63b014]
- Updated dependencies [9abe4e4]
- Updated dependencies [2cc7122]
- Updated dependencies [50d6c92]
- Updated dependencies [9e0ba21]
- Updated dependencies [311433f]
- Updated dependencies [3e5ad08]
- Updated dependencies [9abe4e4]
- Updated dependencies [b7131f3]
- Updated dependencies [e5812fa]
- Updated dependencies [7085f90]
- Updated dependencies [dee4dd4]
- Updated dependencies [ce7e497]
- Updated dependencies [51ecb2f]
- Updated dependencies [9086761]
- Updated dependencies [42a117b]
- Updated dependencies [1401ae7]
- Updated dependencies [4297fe7]
- Updated dependencies [e398863]
- Updated dependencies [d16df74]
- Updated dependencies [f11fc61]
- Updated dependencies [e808890]
- Updated dependencies [8f79379]
- Updated dependencies [e6ca40e]
- Updated dependencies [0c77ea4]
- Updated dependencies [52954c0]
- Updated dependencies [89eb997]
- Updated dependencies [7131f12]
- Updated dependencies [aa5994e]
- Updated dependencies [be93457]
- Updated dependencies [a65db76]
- Updated dependencies [2cf5a96]
- Updated dependencies [15eb2c9]
- Updated dependencies [5691b07]
- Updated dependencies [2a6122b]
- Updated dependencies [225e769]
- Updated dependencies [8af88dd]
- Updated dependencies [fb5fbb8]
- Updated dependencies [d7b3963]
- Updated dependencies [33184fd]
- Updated dependencies [7c41693]
- Updated dependencies [b72db01]
- Updated dependencies [dce5cd4]
- Updated dependencies [9688f58]
- Updated dependencies [556ebc1]
- Updated dependencies [177ebdc]
- Updated dependencies [8d237b4]
- Updated dependencies [2d2e6f0]
- Updated dependencies [2d8dd8d]
- Updated dependencies [22d573e]
- Updated dependencies [b5a2398]
- Updated dependencies [348860c]
- Updated dependencies [5383fa6]
- Updated dependencies [5b3ff63]
- Updated dependencies [1a6a19c]
- Updated dependencies [527e050]
- Updated dependencies [dd33bf9]
- Updated dependencies [4cb2a90]
- Updated dependencies [74a7804]
- Updated dependencies [53d3689]
- Updated dependencies [b3a63d3]
- Updated dependencies [49f0dcf]
- Updated dependencies [033a34c]
- Updated dependencies [4d25d22]
- Updated dependencies [1ffee51]
- Updated dependencies [5ae4303]
- Updated dependencies [ece4dad]
- Updated dependencies [e9b377e]
- Updated dependencies [146f448]
- Updated dependencies [735f5c7]
- Updated dependencies [a7e18de]
- Updated dependencies [366f895]
- Updated dependencies [dc75ba8]
- Updated dependencies [cce0aa9]
- Updated dependencies [e764507]
- Updated dependencies [cff17af]
- Updated dependencies [39404f3]
- Updated dependencies [ca1965f]
- Updated dependencies [8619f95]
- Updated dependencies [b706af9]
- Updated dependencies [db8c288]
- Updated dependencies [0e5fe7f]
- Updated dependencies [add4360]
- Updated dependencies [fc9ba76]
- Updated dependencies [0f94cc7]
- Updated dependencies [a11c1a5]
- Updated dependencies [71f9cd1]
- Updated dependencies [ee17d86]
- Updated dependencies [cdbd920]
- Updated dependencies [18c432e]
- Updated dependencies [3c418c4]
- Updated dependencies [fa8715a]
- Updated dependencies [a933ed7]
- Updated dependencies [b3ca463]
- Updated dependencies [a933ed7]
- Updated dependencies [0d4a6a8]
- Updated dependencies [518d5e5]
- Updated dependencies [6643ba1]
- Updated dependencies [eeba2ef]
- Updated dependencies [ec4c4d2]
- Updated dependencies [424f73c]
- Updated dependencies [cccbe51]
- Updated dependencies [a8d6b1d]
- Updated dependencies [e4a7695]
- Updated dependencies [87075b1]
- Updated dependencies [fc58a99]
- Updated dependencies [14cfc00]
- Updated dependencies [1c6f7b4]
- Updated dependencies [e854a53]
- Updated dependencies [dfebfc8]
- Updated dependencies [d028b37]
- Updated dependencies [f7b25c5]
- Updated dependencies [122ef38]
- Updated dependencies [4a37870]
- Updated dependencies [428f9b2]
- Updated dependencies [aa7ff56]
- Updated dependencies [c41b42e]
- Updated dependencies [c4db311]
- Updated dependencies [750fff5]
- Updated dependencies [c19035e]
- Updated dependencies [ececf7a]
- Updated dependencies [d173125]
- Updated dependencies [8eeca27]
- Updated dependencies [8425c17]
- Updated dependencies [a5ef1d8]
- Updated dependencies [87ad30c]
- Updated dependencies [772d5de]
- Updated dependencies [ce80ec2]
- Updated dependencies [b372318]
- Updated dependencies [97a2263]
- Updated dependencies [29d0676]
- Updated dependencies [0169d49]
- Updated dependencies [6bd3231]
- Updated dependencies [d2b5ba8]
- Updated dependencies [b799ac5]
- Updated dependencies [8f74307]
- Updated dependencies [d23dc08]
- Updated dependencies [644ad50]
- Updated dependencies [9735662]
- Updated dependencies [4d5b4f8]
- Updated dependencies [0da7cd2]
- Updated dependencies [28a5c3e]
- Updated dependencies [4bc18e5]
  - @objectstack/spec@17.3.0
  - @objectstack/core@17.3.0
  - @objectstack/types@17.3.0

## 17.2.0

### Minor Changes

- 57e4571: **BREAKING**: `/analytics/query` now refuses a cross-object filter nested inside a
  combinator on the ObjectQL path, instead of silently answering the wrong number
  (#10759).
  
  `ObjectQLStrategy` runs one cross-object envelope check, from two call sites.
  `generateSql()` (the `/analytics/sql` preview) asked it about every member the
  `where` touches, flattened out of the filter tree. `execute()` asked it about the
  built engine filter — where an AND-ed leaf sits at the top level and is seen, but
  anything structural (an `$or`, a `$not`, a nested `$and` that cannot merge) has
  been folded into `filter.$and`, so the only key readable for it was the literal
  `$and`, which is never a field name.
  
  One query therefore got two answers, measured over one fixture in one run:
  
  ```
  where: { $or: [{ 'account.region': 'West' }, { stage: 'won' }] }
  
  before   /analytics/sql     400 INVALID_FIELD  cross-object filter "account.region"
           /analytics/query   200, rows
  after    both               400 INVALID_FIELD  cross-object filter "account.region"
  ```
  
  `engine.aggregate` cannot join. The half that returned rows was not answering the
  cross-object query: the disjunct naming a column the base object does not have
  can never match, so the query silently collapsed to its remaining branches and
  reported a narrower figure as if it were the answer. Both call sites now derive
  the member list from one shared view, so the invariant the strategy already
  stated for itself — the preview accepts and rejects the same set the execution
  door does — holds by construction rather than by two call sites agreeing.
  
  Who is affected: a deployment whose driver reports `objectqlAggregate` but not
  `nativeSql` (Mongo, the memory driver), running an analytics query that puts a
  related object's field inside `$or` or `$not`. Such a query now returns
  `400 INVALID_FIELD` naming the member. The refusal already existed and already
  had these words; what changed is that the execution door reaches it too. Nothing
  an author writes in metadata changes, no stored shape is affected, and queries
  whose combinators name only base-object fields are untouched — that set is pinned
  in `crossobject-conjunct-refusal.test.ts` alongside the new refusal, because a
  fix that refused every combinator would have looked identical from the refusal
  side alone.
  
  The remedy for an affected query is the one the error message has always carried:
  run it on a native-SQL driver, which can join, or drop the cross-object member
  from the filter.
  
  <!-- adr-0087: not-required (no-migration-prescription) A runtime query-shape refusal on /analytics/query, not a metadata surface: no authorable key, export or config field is removed or renamed, so `objectstack migrate meta` has nothing to rewrite and an upgrader has no stored shape to convert. The affected input is an ad-hoc request body, and the error itself names the member and the two ways out. -->
- 13a3dca: **BREAKING**: on the ObjectQL path, a compiled dataset whose definition-level
  `filter` is itself cross-object is now refused by both analytics doors instead
  of reaching `engine.aggregate` with a predicate it cannot join (#10861).
  
  PR #10758 gave the dataset's own definition-level `filter` a route onto this
  door for the first time. That route was outside the member view the cross-object
  envelope check judges, so nothing ever saw it:
  
  ```
  dataset: object 'opportunity', include: ['account'],
           filter: { 'account.region': 'West' }
  
  before   /analytics/query   200, rows   -> engine.aggregate received
                                             {"$and":[{"account.region":"West"}]}
           /analytics/sql     200, SQL
  after    both               400 INVALID_FIELD, member "account.region",
                              cube "<dataset>"; the engine is never reached
  ```
  
  `engine.aggregate` cannot join. `account.region` is not a column of
  `opportunity`, so on any driver that evaluates the predicate honestly it matches
  nothing, and the widget answered a number that was neither the scoped number nor
  the unscoped one — with no error anywhere. That is the silent mis-bucket #3654's
  loud refusal exists to prevent, arriving through a producer #3654 predates.
  
  **Breaking, and argued rather than assumed.** A query that returns `200` with
  rows today starts answering `400`, on a *saved* dataset rather than on anything
  in the request — a dashboard that renders today can start showing an error. That
  is the strongest reading of "breaking" and it is why this is called out here
  rather than filed as a quiet fix. What is *not* lost is any correct answer: the
  rows that stop being served were already wrong, and wrong in the way that hides
  itself. The refusal names the member, names the dataset, and says the same
  definition is valid on a native-SQL deployment, so the operator has somewhere to
  go; the previous behaviour gave them a plausible number and nothing to notice.
  Rejecting the dataset at compile time in `dataset-compiler.ts` was considered and
  not taken (maintainer ruling, 2026-08-22): the compiler cannot see which driver
  will serve the dataset, and the same definition is legal on a native-SQL one.
  
  Who is affected: a deployment whose driver reports `objectqlAggregate` but not
  `nativeSql` (Mongo, the memory driver), serving a dataset whose definition-level
  `filter` names a field on a related object. Nothing an author writes changes
  shape, no stored document is rewritten, and an **ordinary** dataset scope
  (`filter: { is_deleted: false }`) still passes both doors and still reaches the
  engine carrying its predicate — that direction is pinned one character away from
  the new refusal in `crossobject-conjunct-refusal.test.ts`, because an
  implementation that refused *every* dataset scope would look identical from the
  refusal side alone and would break every scoped dataset shipping today.
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable surface is
  retired, renamed or re-shaped: `DatasetSchema`'s `filter` key stays exactly as it
  is, every stored dataset document stays valid as written, and the very same
  document remains correct on a native-SQL deployment. There is therefore nothing
  `objectstack migrate meta` could rewrite — a mechanical rewrite would have to
  know which driver will serve the dataset, which is precisely the capability the
  2026-08-22 ruling records as invisible to the compile-time placement. This is a
  query-time refusal on one driver family, not a surface retirement, so the ledger
  has no entry to carry and the upgrade guide has no prescription to print. -->

### Patch Changes

- 7bf3fb7: Point every documentation link in these packages' published READMEs — and in
  the project `create-objectstack` scaffolds — at the canonical docs origin
  `https://objectstack.ai`, replacing the `docs.objectstack.ai` spelling.
  
  Both spellings reach the same pages (the alias redirects to the apex,
  path-preserving), so no link was broken. The reason it needs a release rather
  than an in-repo fix alone: a README ships inside the npm tarball, so the
  version already on npm keeps showing the old host to every reader of the
  package page until a new one is published.
- 112a8c6: Apply a dataset's definition-level `filter` on the ObjectQL analytics path
  (#10413, phase 1). `/api/v1/analytics/query` served by a driver that reports
  `objectqlAggregate` but not `nativeSql` (MongoDB, the memory driver) reached
  `engine.aggregate` with no `filter` key at all: the dataset's own scope — a
  `filter: { is_deleted: false }` on the dataset definition — was dropped, so
  every measure aggregated the whole table while the dashboard door, on the same
  cube and the same measure names, answered the scoped numbers. The scope is now
  ANDed into the strategy's whole-call filter (never merged key-by-key, so a
  caller's own `where` and the time windows cannot be overwritten by it), and the
  representative SQL echo renders it too.
  
  Per-MEASURE `filter`s on this path are still not applied: an
  `engine.aggregate` aggregation is `{ field, method, alias }` and cannot carry a
  predicate of its own. Widening that contract is #10576; lowering the measure
  filters into it is phase 2 of #10413. The native-SQL path already applies both
  (#10298).
- 6439f8b: Analytics measures are now compiled from everything they declare — `aggregate`, `field` **and** `filter` — on both the dashboard path and `POST /api/v1/analytics/query`.
  
  **Reported figures change, and the new ones are the declared ones.** Two corrections, both of which move numbers a dashboard or an API consumer is already reading:
  
  - A measure written `{ aggregate: 'count', field: 'some_column' }` used to compile to `COUNT(*)` and count **rows**. It now compiles to `COUNT("some_column")` and counts **non-null values**. Any such measure will report the same number as before or a **smaller** one, and a rate built on top of it (a numerator over a total) will drop accordingly — a "100%" tile whose column was mostly empty was reading its own denominator.
  - `POST /api/v1/analytics/query` used to drop every per-measure `filter`, and the dataset's definition-level `filter` with it, returning unfiltered aggregates under the author's measure names. It now applies both, so the endpoint answers what the dashboard already answered for the same cube. Figures pulled through the API — agent tools, exports, downstream reports — will move to the filtered values; a measure declaring `filter: { stage: 'closed_won' }` stops counting every row.
  
  Measures that declare no `field` still compile to `COUNT(*)`, and a cube that is not a compiled dataset (an inferred or manifest cube) emits byte-for-byte the statement it did before. Measure filters lower to portable `CASE WHEN` conditional aggregates rather than `FILTER (WHERE …)`, which MySQL does not have.
  
  If a saved figure or a screenshot disagrees with what the platform now reports, the new number is the one the metadata declares.
- Updated dependencies [6936d07]
- Updated dependencies [59eb04d]
- Updated dependencies [9f05b7d]
- Updated dependencies [3b2af5e]
- Updated dependencies [7d2d112]
- Updated dependencies [5fa0d72]
- Updated dependencies [02b3b07]
- Updated dependencies [46d34ab]
- Updated dependencies [914c413]
- Updated dependencies [55809a0]
- Updated dependencies [ee2ff45]
- Updated dependencies [47cd3ec]
- Updated dependencies [52db1d1]
- Updated dependencies [5649efb]
- Updated dependencies [9d7d2de]
- Updated dependencies [c815c50]
- Updated dependencies [795ea05]
- Updated dependencies [2306a76]
- Updated dependencies [e5ea701]
- Updated dependencies [a40dcc1]
- Updated dependencies [def0d3e]
- Updated dependencies [8d0bb79]
- Updated dependencies [5acb58d]
- Updated dependencies [2e3cf95]
- Updated dependencies [4c93387]
- Updated dependencies [504c8d5]
- Updated dependencies [a037f7c]
- Updated dependencies [3ee8ddf]
- Updated dependencies [16cef97]
- Updated dependencies [a79bd35]
- Updated dependencies [6ceaa4b]
- Updated dependencies [15ea214]
- Updated dependencies [de19489]
- Updated dependencies [c684d00]
- Updated dependencies [923c424]
- Updated dependencies [1ec36b7]
- Updated dependencies [5f2e54c]
- Updated dependencies [189373b]
- Updated dependencies [35ad101]
- Updated dependencies [ceb33a9]
- Updated dependencies [73d9795]
- Updated dependencies [8012960]
- Updated dependencies [f34f56b]
- Updated dependencies [f399618]
- Updated dependencies [75e9301]
- Updated dependencies [2810695]
  - @objectstack/spec@17.2.0
  - @objectstack/core@17.2.0
  - @objectstack/types@17.2.0

## 17.1.0

### Patch Changes

- d09d0fd: Source the comparand-type allow-list and the accepted-set refusal sentence from the shared `@objectstack/spec/data` door instead of re-spelling them locally.
  
  `comparand-shape.ts`'s `isBindableComparand` / `isRenderableTextComparand` spelled the same six accepted comparand types (`string | number | bigint | boolean | null | Date`) that `isAcceptedFilterComparand` single-sources for the SQL driver family, and two refusal messages hand-copied the accepted-set sentence. Both predicates now delegate the type membership to the door and quote `ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE`, matching how `driver-sql` and `driver-turso` consume it.
  
  No comparand is accepted or refused differently: the local copies already agreed with the door, and the full accept/refuse matrix is pinned end to end at both analytics filter doors, in three comparand positions each, measured before the change and re-run unchanged after it.
  
  One user-visible wording correction falls out of removing the copy: the hand-copied sentence omitted `bigint`, a type both predicates have always accepted and both doors have always compiled, so a refusal message under-described the values it accepts. The message now names the full set. The package-local extras — a binary bindable, and the `undefined` arm both doors already refuse upstream — are unchanged and recorded at their use sites.
- 0425db9: Published READMEs link to the docs site in the one form that works on npm, on GitHub and on the docs site (#9632)
  
  **Seven docs links in these READMEs pointed nowhere.** They were spelled as a repo
  path rooted at `/` — `[Flows](/content/docs/automation/flows.mdx)` — and a README in a
  package's `files` array with `private` unset is rendered on the **npm package page** and
  on **GitHub**, not only in this repository. There a root-relative href resolves against
  `npmjs.com` and `github.com` respectively. It was not a docs-site route either:
  `apps/docs/lib/source.ts` mounts `loader({ baseUrl: '/docs' })` over `content/docs`, so
  the route for that first link is `/docs/automation/flows`, and `apps/docs/redirects.mjs`
  carries no `/content` source that would rescue the written form. Every target page
  existed and every one of them was reachable — only the links were not.
  
  All seven now use the absolute form the repo had already established in
  `create-objectstack`'s published READMEs: `https://docs.objectstack.ai/docs/...`, with
  the path taken under `content/docs` and the page extension dropped, because the route
  carries none. Each target was re-verified at the route level rather than as a file — the
  two that named a **directory** (`/content/docs/automation/`,
  `/content/docs/references/automation/`) resolve only because those directories carry an
  `index.mdx`; a directory without one is a 404, not a section.
  
  **Two more links in the same class were converted in the same pass.**
  `service-knowledge` and `knowledge-ragflow` pointed at
  `../../../content/docs/protocol/knowledge.mdx`. Those relative paths do resolve on both
  GitHub and npm, so they are a milder defect than the seven — but they land the reader on
  **raw MDX source** instead of the rendered page. They now point at the rendered page as
  well. `service-knowledge`'s link text changed with it: it was the source filename in a
  code span, which stops being an honest label once the destination is the page.
  
  No API, behaviour or type surface changes — this is the published documentation these
  packages ship.
- f01c0ee: docs: five published service READMEs stop documenting an API that does not exist (#9532)
  
  A version bump is the point, not a side effect: these five READMEs are in their
  packages' `files` arrays with `private` unset, so they are the pages npm renders —
  and a docs-only fix with no bump never reaches npm at all.
  
  Each of the five told a reader to an import of a `Service…` class from its own package
  and call a static `.configure({...})` on it. Neither has ever existed: no class in
  this repo exposes a static `configure`, and none of `ServiceAnalytics`,
  `ServiceAutomation`, `ServiceCache`, `ServiceI18n` or `ServiceJob` is exported by
  anything. A reader following any of them wrote code that could not compile. The real
  entry point in every case is a kernel plugin constructed with `new`:
  `AnalyticsServicePlugin`, `AutomationServicePlugin`, `CacheServicePlugin`,
  `I18nServicePlugin`, `JobServicePlugin`.
  
  ⛔ A name swap alone would not have been enough, and the gate landed in #9546 is what
  proves it: substituting the genuine class while keeping `.configure(...)` turns the
  import finding into a call-site finding rather than into silence. Each README is
  rewritten against the package's built type surface, and each package's entry is
  deleted from `scripts/published-readme-exports.baseline.json` in the same change
  (the baseline is reconciled in both directions, so a stale entry fails too).
  
  What was removed as fabricated, beyond the entry point:
  
  - **service-analytics** — a nine-endpoint REST surface (`/analytics/count`, `/sum`,
    `/avg`, `/min`, `/max`, `/group-by`, `/time-series`, `/metrics`, `/metrics/:name`)
    of which none exists; the real surface is `POST /analytics/query`,
    `GET /analytics/meta`, `POST /analytics/sql` and `POST /analytics/dataset/query`.
    Also removed: `defineMetric`, `getMetric`, `compare`, `funnel`,
    `executeDashboard`, `invalidateCache`, and an `AnalyticsServiceConfig` block whose
    four keys (`defaultDriver`, `enableCaching`, `cacheTTL`, `maxMemoryResults`) are
    none of the real ones.
  - **service-automation** — `executeFlow`/`getFlow`/`listFlows`/`getFlowHistory`/
    `registerTrigger` as the contract (the real contract is `execute(flowName, context?)`
    plus `listFlows()` and a set of optional members), and a five-endpoint REST list that
    matches no mounted route. The flow-authoring half of that README was already accurate
    and is kept.
  - **service-cache** — `mget`/`mset`/`del`/`delPattern`/`namespace`/`ttl`/`expire`/
    `persist`/`incr`/`incrby`/`decr`/`getOrSet`/`invalidateTag`/`resetStats`, none of
    which exist; `ICacheService` has six members. `CacheStats.keys`/`hitRate` corrected to
    `keyCount` (there is no `hitRate`), and `set(key, value, { ttl })` corrected to the
    real positional `set(key, value, ttl?)` in seconds.
  - **service-i18n** — an `await i18n.t('ns:key')` dialect with namespaces, plural
    suffixes, `context`, `returnObjects`, `setLocale`/`getLocale`, `formatDate`/
    `formatNumber`/`formatRelative`, `addLocale`/`removeLocale`/`reload`, `getCoverage`/
    `getMissingKeys`, and a `{{lng}}/{{ns}}` file layout. The real `t()` is synchronous
    and takes the locale positionally — `t(key, locale, params?)` — over one
    `{locale}.json` file per locale. The `POST /i18n/translate` endpoint does not exist.
  - **service-job** — `scheduleInterval`/`scheduleOnce`/`getJob`/`stopJob`/`resumeJob`/
    `deleteJob`/`runNow`/`getJobHistory`/`clearHistory`/`getLastExecution`, and a
    `schedule({ name, schedule, handler })` options-object call. The real `schedule` is
    positional — `schedule(name, schedule, handler, options?)` — and returns `void`.
    Retry defaults corrected to the enforced ones (`maxRetries: 0`,
    `backoffMultiplier: 1`).
  
  Two capability claims are corrected rather than deleted, because the source is what
  decides:
  
  - **service-cache** advertised Redis as production support. `RedisCacheAdapter` throws
    `RedisCacheAdapter not yet implemented` from every method, and
    `new CacheServicePlugin({ adapter: 'redis' })` throws during `init` rather than
    falling back to memory. The README now says so at the top and points at registering
    a custom `ICacheService` under the slot instead.
  - **service-job**'s `adapter: 'interval'` stores cron registrations that never fire.
    That is now stated in the adapter table rather than left for a reader to discover.
  
  No compliance claim (SOC 2 / HIPAA / GDPR or similar) was found in any of the five —
  the shape that raised `plugin-audit`'s severity in #9517 is absent here.
- 402c125: fix(objectql): a temporal filter comparand the platform cannot interpret is refused at the engine door instead of answering 200 with zero rows (#8690)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  renamed, retired or tombstoned — no spec schema is touched at all. The change
  is a new runtime refusal at the engine's filter collection point, plus the
  routing decline that stops the raw-SQL analytics path bypassing it. -->
  
  A `datetime` / `date` / `time` field filtered with a bare string the platform
  cannot read — `last_30_days`, `not-a-date-at-all` — was bound **as written**
  all the way to the driver, where the comparison is false for every row. The
  caller received `HTTP 200`, an empty result set, and nothing to indicate the
  filter was meaningless. An unknown `{placeholder}` in the same position was
  already refused loudly (`FILTER_TOKEN_UNKNOWN` / 400, listing the resolvable
  tokens), so one API answered two shapes of unusable comparand two different
  ways.
  
  It is concretely reachable rather than theoretical: `last_7_days` /
  `last_30_days` / `last_90_days` are **declared preset names** in the dashboard
  schema. The shipped console lowers them to `{N_days_ago}` macros before they
  reach the API, so the console path was always safe — but a saved report, an
  integration, an MCP client or an AI-authored query sends the preset name itself
  and got a silent zero. An empty chart is the hardest failure to debug: it is
  indistinguishable from "there is genuinely no data".
  
  Such a comparand is now refused at the ObjectQL engine's single filter
  collection point, with `code: 'INVALID_FILTER'` and `status: 400`, naming the
  field, the value, the key path and the spellings that would work. That seam is
  the one place holding the caller's comparand and the field's **declared type**
  at the same moment, and every verb (`find` / `findOne` / `count` / `aggregate`
  / `update` / `delete`) and both filter spellings (the array sugar and the
  lowered condition) pass through it, so all four backends inherit one answer
  rather than four. `NativeSQLStrategy` additionally **declines** such a query so
  the raw-SQL analytics path falls through to that door instead of binding the
  value into its own statement.
  
  Deliberately unchanged, each by ruling: a `{placeholder}` keeps its existing
  refusal one layer down (the door runs before token resolution and steps around
  them, so `{30_days_ago}` still resolves normally); non-string comparands are
  untouched (a number is epoch milliseconds, a `Date` is an instant); and the
  **empty string** keeps today's behaviour exactly — it binds as `''` and matches
  every non-null row, which is a separate question that remains its own card.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

### Major Changes

- d17df80: **BREAKING — `dashboard.widgets[].compareTo` converges on the analytics executor's contract (#5011).**

  The widget declared three period-over-period arms with confident TSDoc. The analytics
  executor implements one shape, and it was never the same one — so on the ADR-0021 dataset
  path (the spec's own "single author-facing analytics shape") **all three arms were
  broken**, in two different ways:

  - `compareTo: 'previousPeriod'` / `'previousYear'` were **silently DROPPED** by the dataset
    renderer. The widget rendered its base numbers and the comparison the author asked for
    simply was not there.
  - `compareTo: { offset: '7d' }` was forwarded into `DatasetSelection.compareTo`, whose
    contract is `{ kind, dimension }` and has no `offset` in it — so the executor threw
    `compareTo requires a timeDimension "undefined"` and the whole widget errored out.

  All three worked on the legacy inline chart path. Same key, two fates, and the failing one
  was the path the spec calls canonical.

  `compareTo` is now a thin projection of the contract that is actually implemented:

  ```ts
  compareTo?: { kind: 'previousPeriod' | 'previousYear'; dimension?: string }
  ```

  There is no widget-side vocabulary left to drift from the executor's, so `declared =
enforced` holds by construction rather than by review.

  ## FROM → TO

  | v16                                        | v17                                     | Fix                                                                                                                                   |
  | :----------------------------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
  | `compareTo: 'previousPeriod'`              | `compareTo: { kind: 'previousPeriod' }` | `os migrate meta --from 16` rewrites it                                                                                               |
  | `compareTo: 'previousYear'`                | `compareTo: { kind: 'previousYear' }`   | `os migrate meta --from 16` rewrites it                                                                                               |
  | `compareTo: { offset: '1y' }`              | `compareTo: { kind: 'previousYear' }`   | `os migrate meta --from 16` rewrites it — `1y` **is** `previousYear`                                                                  |
  | `compareTo: { offset: '7d' \| '1M' \| … }` | **no faithful target**                  | State the window on the widget's own `filter` and compare with `{ kind: 'previousPeriod' }`, which shifts by that window's own length |

  The last row is deliberately _not_ rewritten. `previousPeriod` shifts by the length of
  whatever window the filter resolves to, which equals `7d` only when that window happens to
  be seven days — a mechanical rewrite would silently change which rows the comparison
  column counts, turning a loud failure into a wrong number. It is registered as the
  `dashboard-widget-compareto-offset` semantic migration; the schema rejects the key with the
  prescription in hand.

  Retired at the schema, so every old spelling is a parse error carrying its own upgrade —
  including the bare strings, which are dispatched by value so a _typo_ is still told it is a
  typo rather than told it "was removed".

  ## `dimension` is optional — resolved by the executor, not by a renderer

  Omit it and `dataset-executor.ts` resolves it, by its own long-standing criterion (a
  `timeDimensions` entry carrying a `dateRange`):

  - exactly one candidate → that one is shifted;
  - **zero** → a loud error: a comparison is only defined against a bounded window;
  - **two or more** → a loud error **listing the candidates by name**, never a silent
    first-wins. Picking `created_at` when the author meant `close_date` produces a comparison
    that is _wrong_ rather than _missing_, which is the failure nobody audits.

  This is a producer-side resolution rule, not consumer-side tolerance (Prime Directive
  #12): every caller — dashboard widget, report, raw `queryDataset` — gets the same dimension
  or the same error, and no renderer is ever in a position to guess one.

  ## Notes

  - `DatasetCompareTo.dimension` is now optional. Callers that always passed it are
    unaffected; callers that relied on the old "must be present" typing get a wider type.
  - The converged slot is **union-free**. That is not cosmetic: zod collapses a failed union
    into one bare `Invalid input`, so curated guidance written inside a union arm never
    reaches the author (#5014). This slot's prescriptions are top-level and do.
  - objectui's legacy inline chart path adapts separately (objectui#3337), which also deletes
    the `DatasetWidget` string-drop workaround this change makes unnecessary.

- 3c7bcc0: feat(spec)!: converge the 11 contracts-vs-domain dual-source type names (#4538)

  `packages/spec/src/contracts/` hand-wrote parameter/result interfaces whose
  names collided with same-named zod-derived types in the domains — the #4411
  trap, tracked as 11 rows of `dual-source-exports.baseline.json`. Each name was
  judged individually against a three-repo import-level scan (framework, cloud,
  objectui): which declaration actually flows at runtime decides the direction.
  All 11 rows are deleted from the baseline; no name below is exported twice
  anymore.

  **Converged — `./contracts` now re-exports the domain zod type (same
  declaration on both entries, imports keep compiling from either):**

  - `NotificationChannel` → `system/notification.zod`'s
    `z.infer<NotificationChannelSchema>` (member sets were identical).
  - `ValidationResult` → `kernel/plugin-validator.zod` (shapes were identical).
  - `HealthStatus` → `kernel/startup-orchestrator.zod` (`details` narrows
    `Record<string, any>` → `Record<string, unknown>`).
  - `PluginStartupResult` → `kernel/startup-orchestrator.zod`. FROM `plugin:
Plugin` (live object) and `error?: Error` TO the serializable projection
    (`plugin: { name, version? }`-passthrough, `error?: { name, message,
stack?, code? }`). Neither side had any consumer outside spec; the
    zod-validatable shape wins.
  - `StartupOptions` → `kernel/startup-orchestrator.zod` — the PARSED tier
    (defaults applied). `IStartupOrchestrator.orchestrateStartup` now takes
    `StartupOptionsInput` (the caller-authored all-optional tier, also
    re-exported from `./contracts`). Fix for callers typed to the old
    all-optional `StartupOptions`: rename to `StartupOptionsInput`.
  - `JobExecution` → `system/job.zod`. The system schema's `duration` field is
    RENAMED `durationMs` — that is what every job adapter produces and what the
    `sys_job_run.duration_ms` column round-trips; the schema described records
    nothing ever wrote. Fix: `duration` → `durationMs` when parsing
    `JobExecutionSchema` payloads.
  - `AnalyticsQuery` → `data/analytics.zod`. The domain schema aligned to the
    contract's semantics first: `timezone` LOST its `.default('UTC')` — absence
    is meaningful (the engine resolves org timezone, #1982/#2018; the
    `/analytics` entry always refused to apply that default). The schema is now
    transform-free, so `AnalyticsQuery` ≡ `AnalyticsQueryInput` (both kept
    exported). Fix for code that relied on `.parse()` injecting `timezone:
'UTC'`: pass the timezone explicitly or resolve it via the engine chain
    (`selection.timezone ?? context.timezone ?? 'UTC'`).

  **Renamed — two genuinely different concepts were sharing one name (both
  flow at runtime):**

  - `./contracts` `DriverCapabilities` → **`AnalyticsDriverCapabilities`**
    (`{ nativeSql, objectqlAggregate, inMemory }`, the analytics strategy-chain
    execution-path probe). The `DriverCapabilities` name now belongs solely to
    the data domain's driver feature-flag record (`DriverCapabilitiesSchema`,
    what `IDataDriver.supports` declares). Fix: importers of the trio from
    `@objectstack/spec/contracts` (or `@objectstack/service-analytics`, whose
    re-export is renamed in lockstep) rename the import; importers who meant
    the driver flags import `DriverCapabilities` from `@objectstack/spec/data`.

  **Removed — the domain-side declaration was dead (zero import-level consumers
  in framework/cloud/objectui; the #4411 family's last survivors):**

  - `system` `MetadataExportOptionsSchema` / `MetadataExportOptions` and
    `MetadataImportOptionsSchema` / `MetadataImportOptions` (the
    `output`/`source`-directory bags). The names now have ONE declaration each:
    the `IMetadataService.exportMetadata` / `importMetadata` parameter
    interfaces on `./contracts` (`types`/`namespaces`/`format` and
    `conflictResolution`/`validate`/`dryRun`), which `MetadataManager`
    implements. No tombstone/D2 conversion, deliberately — these are runtime
    option-bag types, not authorable metadata (same reasoning as #4458).
    `@objectstack/metadata` re-exports the two names from `./contracts` now
    (it previously re-exported the dead system-side shapes its own manager
    did not accept).
  - `system` `JobSchedule` (the `= Schedule` back-compat alias). The name's one
    declaration is the `IJobService.schedule` boundary shape on `./contracts`
    (plain-string cron `expression`); the authored metadata type keeps its real
    name `Schedule`. Fix: `import type { JobSchedule } from
'@objectstack/spec/system'` → `Schedule` (authoring tier) or the
    `./contracts` `JobSchedule` (service boundary), whichever you meant.

### Minor Changes

- 9a75790: feat(service-analytics): a field-to-field (`$field`) RLS rule is served on the analytics path — native SQL declines and routes to the engine (#7598)

  A CEL permission / RLS rule that compares two columns of the same record —
  `compileCelToFilter` lowers it to `{ amount: { $gt: { $field: 'budget' } } }` —
  now **works** on `/analytics/query`, whether it arrives in the caller's `where`
  or in the read scope the platform compiles from an admin-authored sharing rule.

  Before #7694 the two analytics SQL compilers **bound the reference object as the
  comparison's value**: the statement compiled perfectly and compared a column
  against the text `{"$field":"budget"}`, which no row can hold — an empty chart,
  or an RLS predicate quietly answering the wrong row set, with nothing to read.
  #7694 stopped that by refusing the shape. This change replaces the refusal with
  the answer.

  **How.** `NativeSQLStrategy.canHandle` declines a query whose `where` or read
  scope carries a reference in a scalar comparand position, so the query falls
  through to the lower-priority ObjectQL/engine path — the same decline-and-route
  mechanism this strategy already uses for federated objects (ADR-0062 D6) and for
  date-bucketed queries. `driver-sql` then compiles the comparison and enforces the
  four #5222 security rulings — same-table columns only, declared-only enumeration,
  the tenant-isolation column forbidden on both sides, and a matching comparison
  class — using the `initObjects` metadata it owns. Those rules stay in exactly one
  place; the alternative considered was a `StrategyContext` enumeration hook plus a
  second implementation of them inside this package, and a guard that exists twice
  is a guard that will eventually disagree with itself.

  ⚠️ **Query routing now depends on filter CONTENT, not only on query shape.** That
  is new behaviour for `canHandle`, and it is deliberate: a query carrying a
  cross-field comparison takes the engine path rather than raw SQL, so it is served
  by `engine.aggregate` and is slower than a pushed-down statement. Every other
  query is unaffected — a literal comparand, a literal read scope and a filterless
  query all keep the native-SQL path exactly as before.

  **Two positions deliberately still refuse**, and both converge with what
  `driver-sql` itself refuses rather than diverging from it:

  - `/analytics/sql` — the display echo declines a cross-field comparison instead
    of half-rendering one. It describes an execution it does not perform, and the
    predicate the engine path actually runs is written total across NULLs; what
    this renderer can emit is a comparison against the reference as a bound value,
    which reproduces none of the rows the query returns. `/analytics/query` still
    serves those queries and returns rows — the response simply carries no `sql`
    string.
  - a `$field` in a `$between` **endpoint**. No backend serves it (`@objectstack/spec`
    removed the position in #7596), and this compiler splits `$between` into its two
    bounds — so routing it would hand the driver a `$gte` / `$lte` the author never
    wrote, and the range would quietly succeed here while the identical filter is
    refused everywhere else. The refusal message now names that, and points at the
    scalar spelling which _is_ served.

  The LIKE family and `$in` / `$nin` members keep their existing refusals and
  wordings, unchanged.

  **Read-scope error envelope: unchanged.** An unsupported rule on the read-scope
  lowering still answers `READ_SCOPE_COMPILE_FAILED` / 500 with the message
  withheld, exactly as the #5367 ruling set it — no new error code, no move to a
  4xx. A read scope is not the caller's document, so it is not the caller's 4xx.

  One further fix this needed, in the same class as #7597: `ObjectQLStrategy`
  lowered an equality comparand **bare** (`{ amount: 5 }` — correct for a literal),
  which for a reference produced `{ amount: { $field: 'budget' } }`, a field spec no
  backend reads as an equality. It now emits an explicit `$eq` when the comparand is
  a reference, branching on the comparand rather than on the operator. And a
  reference comparand no longer takes this door's NULL-safe `$ne` guard (#5298),
  which is right for a literal and wrong for a reference — measured, it admitted the
  both-NULL row that the shared corpus, both SQL drivers and the in-memory evaluator
  all exclude.

- 840ee4b: fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

  Two independent defects on the `/analytics` surface, found while verifying #3770
  against a real server. On an authenticated CRM dev server, before this change:

  ```
  POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
  → 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
         "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
  ```

  That is SQLite's internal schema table — never a registered object — read
  successfully through the analytics endpoint. Not merely "the name reaches the
  driver and errors": **any table the connection can see was readable.**

  **① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
  auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
  widget queries `crm_account` with no authored Cube — but it accepted _any_ string,
  so the endpoint could aggregate over an arbitrary physical table. The
  analytics-side twin of the data-path gap #3770 closed, and it was not covered by
  that fix: #3770 gated the protocol's `analyticsQuery`, which is the _degraded
  fallback_; a deployment with `@objectstack/service-analytics` installed runs the
  real engine instead (`ctx.replaceService`).

  Inference is now gated on the same schema registry the data path consults, via a
  new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
  from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
  untouched (its `sql` is whatever it declares); an unregistered name that IS an
  object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
  raised before any SQL exists, naming both ways to make the request valid. With no
  probe configured the gate stands down and warns once — the same tiering #3770
  took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

  **② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
  is the single error exit for _every_ route the dispatcher plugin mounts —
  `/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
  `/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
  driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
  driver error on any of those routes shipped its SQL to the client. Unlike ①, this
  half is unconditional — it does not depend on the cube being invalid.

  The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
  `looksLikeInternalErrorLeak` (both packages already depend on it) and is now
  applied at both boundaries — one predicate, one place to widen when a new
  dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
  dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
  business/validation answer and must reach the caller intact. Sanitising costs no
  diagnostics — the untouched error still reaches `errorReporter` through the
  existing `__obsRecordedError` side-channel.

  **Also fixed in the same function:** `errorResponseBase` read only
  `err.statusCode`, while domain errors across this codebase carry `status` (and
  `HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
  4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
  the analytics fallback path — was rendered as a **500**. It now reads `status`
  then `statusCode`.

  **Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
  `CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
  previously the name was passed to the driver. Dashboards and KPI widgets pointed
  at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
  whose message looks like a driver dump now reads `Internal server error` — check
  server logs or your error reporter for the original.

- fa94b2c: fix(service-analytics): a measure a query never reported reads 0 for a count/sum on every merge seam (#4708)

  A dataset measure carrying its own `filter` runs as a separate grouped
  sub-query and is merged back onto the selected dimensions. A `GROUP BY` over a
  filtered row set emits **no group at all** for a dimension value the filter
  excludes entirely, so the measure comes back **absent**, not `0` — and
  `computeDerived` treats an absent operand as unknowable, so every ratio over it
  goes null too. The cell then renders blank, which is visually identical to "no
  data for this row" and means the opposite.

  The bias runs the worst possible way: the rows that blank are the ones whose
  numerator matched nothing — the **worst-performing rows**. A `lead_source` that
  won nothing rendered as "no data" while one that won everything rendered fine.

  The empty-group value is now filled **by aggregate kind** into every measure
  column the assembled grid lists but no query reported:

  | aggregate                 | over an excluded group | why                                                                 |
  | :------------------------ | :--------------------- | :------------------------------------------------------------------ |
  | `count`, `count_distinct` | `0`                    | "how many rows matched" has an exact answer when the answer is none |
  | `sum`                     | `0`                    | the identity element of the empty set                               |
  | `avg`, `min`, `max`       | stays `null`           | genuinely undefined — there is nothing to average                   |

  Filling all five with `0` would trade this lie for its mirror image, reporting a
  measurement nobody made, so the kinds are judged separately (via
  `emptyGroupValueFor`, shared with the authoring-side coherence checks).

  **Only cells are filled, never rows.** A dimension value no query reported at
  all has genuinely no data and stays out of the grid.

  **What changes beyond the measure-scoped seam.** The fill previously ran before
  the `compareTo` merge, and that merge _appends_ a row for every bucket the
  PREVIOUS window had and this one does not. Every base measure on those rows —
  including unfiltered ones — was absent, so a lead source that sold last month
  and nothing this month rendered as "no data" instead of `0`: the same worst-row
  bias, one merge later. The fill now runs after every merge and covers all base
  measures plus their `<measure>__compare` columns.

  Widgets that worked around this with `?? 0` in the consumer or a `coalesce` in
  the measure can drop it; the coercion belongs in the executor, which is the only
  layer that knows which aggregate produced the gap.

  **New export.** `fillEmptyGroups(rows, columnAggregates)` is exported from the
  package root beside `mergeByDimensions`, so a host assembling a grid outside
  `DatasetExecutor` can apply the same aggregate-kind rule rather than
  reimplementing it — which is what makes this a `minor` rather than a `patch`.

- 587fc91: feat(analytics): the executeAggregate bridge carries ExecutionContext — ADR-0021 D-C second belt

  The analytics→engine bridge now forwards the request's `ExecutionContext` to
  `engine.aggregate`, so the engine's own middleware chain scopes analytics reads
  independently of the analytics layer's `getReadScope`.

  **Why.** `BaseEngineOptions.context` has always been `.optional()`, so nothing
  forced the bridge to pass it — and it did not. An authenticated aggregate
  reached the engine with no principal, plugin-security's principal-less fall-open
  skipped its RLS injection, and the only thing left scoping the query was the
  strategy remembering to call `getReadScope`. #3597 was a strategy that did not,
  and both belts were off at once.

  `getReadScope` stays: the two resolve scope through different paths (engine
  middleware vs `security.getReadFilter`), and a deployment without
  plugin-security has only the analytics layer. This is depth, not a replacement.

  - `StrategyContext` gains `context?: ExecutionContext`, bound per call by
    `AnalyticsService` from `query()` / `generateSql()` / `queryDataset()`.
  - `StrategyContext.executeAggregate` and the `AnalyticsServicePlugin` /
    `AnalyticsService` `executeAggregate` config options gain `context?:
ExecutionContext`. **Custom bridges should forward it** to their engine; the
    built-in auto-bridge does. Purely additive — an existing bridge that ignores
    it keeps working exactly as before.
  - `DimensionLabelDeps.fetchRecordLabels` and `resolveDimensionLabels` each gain
    an optional trailing `context`, beside the `scope` / `resolveScope` that
    #3639 added — the same two-belt split as the aggregate path.
  - `BootOptions.analytics` (`@objectstack/verify`) overrides the
    AnalyticsServicePlugin instance, so a gate can boot with the analytics belt
    off and assert the engine-side belt alone still scopes.

  **Also fixed on the same seam:**

  - `fetchRecordLabels` — the dimension display-label lookup — is row-granular
    (one row per record, real display names). #3639 gave it the analytics-layer
    belt (the referenced object's own read scope); it now also carries the
    context, so the engine scopes the same read independently.
  - `ObjectQLStrategy.generateSql` emitted no `WHERE` at all, so the
    `/analytics/sql` preview read as an unscoped table scan while the real
    aggregate was scoped. It now renders the caller's filters and the read scope.
    The preview never executed, so this was misleading output rather than a leak.

- 79c3145: fix(analytics)!: a `{ $field }` comparand is refused on both SQL-lowering doors instead of being BOUND as the comparison's value (#7598)

  <!-- adr-0087: not-required (no-migration-prescription) This change retires NO key and adds none. `FieldReferenceSchema` stays declared in `packages/spec` exactly as it is, stays implemented by `@objectstack/formula`'s in-memory evaluator, and stays COMPILED by `driver-sql` / `driver-sqlite-wasm` under #5222 — `packages/spec` is untouched by this PR, no metadata schema gains or loses a key, and no authored or stored shape becomes unparseable. What moves is one COMPILER's posture at two doors of `@objectstack/service-analytics`: a shape that used to compile into a predicate binding the reference OBJECT as a value now refuses. There is therefore nothing for `objectstack migrate meta` to rewrite — the FROM shape is still valid metadata everywhere it was valid before, and rewriting it would be wrong, since the identical filter continues to execute on the ObjectQL engine path and on both SQL drivers. Nor is there a FROM/TO rule a ledger entry could state: the correct repair depends on which face the author's query routes to, which is a deployment fact rather than a metadata one. The channels that do reach an affected reader are this changeset's CHANGELOG text and the refusal message itself, which names the operator, the field, the referenced column, the faces that DO execute the shape, and why this compiler cannot — all shipped with this change. -->

  **⚠️ Behaviour change.** A filter whose comparand is a field reference —
  `{ amount: { $gt: { $field: 'budget' } } }`, the shape
  `FieldReferenceSchema` declares and `compileCelToFilter` emits for a
  field-to-field comparison in a CEL permission / RLS rule — used to COMPILE on
  both of this package's doors. It now refuses: `INVALID_FILTER` / 400 on the
  analytics `where` door, `READ_SCOPE_COMPILE_FAILED` / 500 on the read-scope
  lowering (each door's existing envelope, unchanged).

  #7598 was filed reading "these compilers still REFUSE `$field`". Measured on
  `origin/main` (`5823d593d`), nothing refused. For the six scalar comparison
  operators — exactly the ones #5222 taught `driver-sql` to compile into a
  same-table column-to-column comparison — the reference OBJECT went into the
  bind list:

  | face                            | `{ amount: { $gt: { $field: 'budget' } } }`                        |
  | ------------------------------- | ------------------------------------------------------------------ |
  | `read-scope-sql`                | `"person"."amount" > ?` · bound to `{"$field":"budget"}`           |
  | `where` → `NativeSQLStrategy`   | `WHERE amount > $1` · bound to the JSON TEXT `{"$field":"budget"}` |
  | `where` → `/analytics/sql` echo | `WHERE amount > $1` · bound to the reference OBJECT                |
  | `where` → ObjectQL engine       | reached `driver-sql`, which compiles it CORRECTLY since #5222      |

  So the defect was a silent wrong answer, not a refusal: a syntactically perfect
  predicate comparing a column against a value no row can hold. Three of the four
  faces answered differently, and on the read-scope door the one answering wrongly
  is an administrator's RLS predicate. The gates assumed to be catching this
  (`isBindableComparand` / `isRenderableTextComparand`) had not drifted from
  `driver-sql` — they are simply never ASKED about that position, only about the
  LIKE family and `$in` / `$nin` / `$between` MEMBERS.

  **What this does not do:** it does not bring the capability to these compilers.
  The four maintainer rulings that make a referenced column name safe in a SQL
  identifier position (same-table only, declared-only enumeration, tenant-isolation
  column forbidden on both sides, same comparison class) all turn on metadata
  `StrategyContext` does not expose — neither an object's declared field set nor its
  tenant-isolation column — so these compilers cannot enforce them, and shipping a
  port without them would open a comparison surface onto the tenant boundary.
  Implementing it here is a `packages/spec` contract question, left open on #7598.

  Field-to-field RLS rules continue to work on the ObjectQL engine path, where the
  driver compiles them with the metadata it owns; they are now loudly refused,
  rather than silently mis-answered, on the raw-SQL analytics path.

  Positions already refused before this change keep their exact wording — the LIKE
  family, `$in` / `$nin` members, and a bare `{ field: { $field: … } }` — because
  each of those refusals already CONVERGES with `driver-sql`'s own #5222 refusal
  arm. `minor` rather than `patch` follows #5234, the same class of change on the
  same two doors.

- 1792384: fix(service-analytics)!: 分析查询的 `where` —— `$not` 变 NULL-safe、`{$not:{}}` 变零行、`$or` 的 `{}` 析取项不再被丢 (#5325)

  `filter-normalizer.ts` 的 `buildNode` 是这个包里**第二份**同缺陷拷贝:第一份
  (`read-scope-sql.ts` 的 `compileNode`,RLS 读作用域)已由 #5297 修好,而这一份编译的是
  **作者自己写的 `where`** —— dashboard widget / dataset 的筛选器。两者是各自独立的函数,
  所以那一单合入后这三条仍然在。以 `driver-sql` 同一份 fixture 实测(4 行,行 3、4 的
  `stage` 为 NULL,行 3 的 `amount` 为 NULL,行 4 的 `owner` 为 NULL):

  | widget 的 `where`                                 | 改前取到的行 | 改后(= driver-memory / formula / #5296 后的 driver-sql) |
  | ------------------------------------------------- | ------------ | ------------------------------------------------------- |
  | `{ $not: { stage: 'won' } }`                      | `2`          | `2,3,4`                                                 |
  | `{ $not: { stage: { $in: ['won'] } } }`           | `2`          | `2,3,4`                                                 |
  | `{ $not: {} }`                                    | **全表**     | **零行**                                                |
  | `{ $or: [{ stage: 'won' }, {}] }`                 | `1`          | 全表                                                    |
  | `{ $not: { $or: [{stage:'won'},{owner:'u1'}] } }` | `2`          | `2,4`                                                   |

  **这是可观察的行为变更,不是内部重构 —— 已有的图表数值会变:**

  - **`{$not: {}}` 的 widget 此前画的是整个数据集,现在是零行。** `buildNode({})` 返回
    `null`(= 无约束 = TRUE),`$not` 分支的 `if (inner)` 因此为假,整条 `$not` 消失,
    WHERE 一个字都不发 —— 一条意思是「什么都不显示」的筛选器显示了全部。`NOT TRUE ≡ FALSE`,
    现在它编译成 `1 = 0`。
  - **`$not` 下 NULL 行的去留变了,所以图上的数字会变。** SQL 是三值逻辑而 `WHERE` 只保留
    TRUE,裸 `NOT (stage = ?)` 把 `stage` 为 NULL 的行全部丢掉;`driver-memory`、`formula`
    和(#5296 之后的)`driver-sql` 都把它们算进来。同一条 widget filter,在分析查询和普通
    `find()` 上给出不同的行集,取决于哪个后端接住它。#5146 已拍板 JS 家族的答案为准,本次
    按同一口径把守卫**下推到叶子**(`{col: {$null: false}}` / `{$or: [{col:{$null:true}}, …]}`,
    极性逐算子决定)。**受影响的图表数值会上升**(负向筛选现在包含空值行)。
  - **`$or` 里的 `{}` 析取项不再被丢。** TRUE 是 AND 的单位元但**吸收** OR,所以
    `{$or: [{stage:'won'}, {}]}` 整条为 TRUE;此前它被 `.filter(n => n !== null)` 丢掉,
    查询被静默**收紧**成剩余分支。
  - **空集合是布尔常量,不再是「没有谓词」。** `{stage: {$in: []}}` 此前编译成空子句
    → 无约束 → 画全表,现在是零行(`1 = 0`);`{$nin: []}` 不排除任何行。
  - **两处新的响亮拒收(此前静默放宽):** `$not` / `$or` / `$and` 的**非对象**操作数
    (`{$not: null}` 曾整条消失 → 等于不筛),以及**零个操作符的字段约束** `{a: {}}`
    —— 后者按 #5240 的拍板拒收,与 driver-sql / driver-memory / formula 一致;不这么做的话,
    「TRUE 吸收 OR」会把 `{$or: [{a: {}}, {b: 2}]}` 从 `b = 2` 放宽成全表。

  实现落在 normalizer 而不是某个 strategy:守卫在这一层是**结构**(多一个 `$null` 合取项),
  经 `filterNodeToCondition` 交给 ObjectQL 引擎后在**任何驱动上都成立**,包括本身不 NULL-safe
  的那些;只加在 raw-SQL 那条路径,等于说「分析查询的 `$not` 是什么意思取决于哪个驱动接住它」。
  代价是引擎路径会**双重加守卫**,已实测幂等(`NOT (c IS NOT NULL AND (c IS NOT NULL AND c = v))`
  与单层等价),只是 SQL 多一层冗余谓词。

  `NormalizedFilterNode` 因此新增布尔常量 kind —— 该联合此前只有 `leaf | and | or | not`,
  没有 FALSE 的表示法,这正是 `{$not:{}}` 只能编译成「什么都不发」的根本原因。三个编译器
  (`native-sql-strategy.compileFilterNode`、`objectql-strategy.filterNodeToCondition`、
  回显给浏览器的 `renderFilterNodeSql`)各自实现它;引擎路径用的是 `{$not: {}}`,即
  driver-sql / formula / driver-memory 参考匹配器早已钉住的零行写法(#5134),没有另造第二种。

  `$and: []` / `$or: []` 的空组合子**不在本次范围**,仍然 fail-closed 抛错(独立裁定见 #5322),
  并已加用例钉在抛错这一侧。

- 328ccc5: fix(security,analytics): scope /analytics/query to the caller's readable records, and refuse a measure over a missing field (#4467, #4437)

  Two defects on the analytics query path, both found by the v17 verification run
  (#3909 / #4482), both reproduced against a live showcase server before the fix
  and re-verified with the same requests after.

  ## #4467 — `/analytics/query` applied no record-level scoping

  `ISecurityService.getReadFilter` documents itself as "the same filter the engine
  middleware AND-s into every find", and exists precisely for paths that bypass
  that middleware — its own doc comment names the analytics raw-SQL path. But the
  chain it mirrors is TWO sibling middlewares: plugin-security's RLS injection and
  plugin-sharing's owner/share visibility filter (`buildSharingMiddleware` AND-s
  `buildReadFilter` into `ast.where` for `find`/`findOne`/`count`/`aggregate`).
  Only the RLS half was ever computed here, and analytics has no other source of
  scope, so the OWD/share predicate simply never existed on that path.

  Live repro: `showcase_private_note` is `sharingModel: 'private'`; an admin owns
  5 notes, a member holds read shares on exactly 2 and no `viewAllRecords`.
  `GET /data/showcase_private_note` correctly returned 2 for the member, while
  `POST /analytics/query {measures:['count']}` returned 5 — and adding
  `dimensions:['title']` returned all five titles, i.e. the VALUES of a column
  that caller may not read, not merely a bad count. Any authenticated caller who
  could reach `/analytics` could enumerate the field values of every row of any
  object exposed as a cube, regardless of OWD, sharing rules, or RLS.

  `getReadFilter` now resolves plugin-sharing's `buildReadFilter` through the
  late-bound `sharing` service and AND-composes it with the RLS filter — the same
  composition the two middlewares reach by both writing into `ast.where`. It also
  computes the ADR-0057 D1 `__readScope` depth that the security middleware
  normally stashes on the context for plugin-sharing to widen its owner-match
  with, using the same `getEffectiveScope` call the middleware makes: no
  middleware runs on this path, and without it a caller granted `unit`/`org` read
  depth would be silently narrowed to `own`. The sharing predicate is resolved for
  every non-system caller AHEAD of the RLS stand-down branches, because those are
  the RLS middleware's own early exits and none of them is a reason to drop a
  sibling middleware's predicate; a sharing-resolution failure denies outright
  rather than falling through to half a scope.

  **Why `minor` rather than `patch`.** This is an observable behaviour change on a
  public read surface, in the narrowing direction: analytics results that a
  principal could previously read they now cannot. Counts drop, `dimensions`
  groupings lose rows, and any dashboard, report, or export built on
  `/analytics/query` over an owner-private object will show smaller numbers for
  non-superuser principals — correctly, but visibly. Deployments that had (however
  unknowingly) come to depend on the unscoped totals will see them change on
  upgrade, so this warrants more than a patch-level note even though it is a
  security fix. No API signature changed: `ISecurityService.getReadFilter`'s
  declaration is untouched — the implementation merely started honouring the
  contract it already documented.

  ## #4437 — a measure naming a missing field 500'd with SQLITE_ERROR

  `inferMeasure('ghost_sum')` maps a suffix convention onto a field name and has
  no way to know the field exists, so it built `SUM(ghost)`, the driver threw
  `no such column`, and the caller got
  `500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver error
  class as the `error.code` for what is a plain typo, which ADR-0112 forbids. A
  dotted spelling took the same path (`measures:['total.sum']` prefix-strips to
  `sum` → `SUM(sum)` → 500). The DATA route has refused the identical mistake with
  a `400 INVALID_FIELD` naming the field since #4315/#4254.

  `AnalyticsService.ensureCube` now validates each measure's resolved source field
  against the backing object's field names before any SQL is built, and rejects
  with the same envelope the data route produces (`400 INVALID_FIELD` carrying
  `field`, `object`, `param`, `measure`) so one mistake has one shape across
  `/data` and `/analytics`. The new `getObjectFieldNames` config hook reads the
  same schema registry `isRegisteredObject` already consults and the data path's
  own gate reads, so "which fields exist" has a single answer across both routes.

  The gate is tiered exactly like the #3867 cube-inference gate, deliberately
  narrow: it applies only when the cube's `sql` is a bare object name (an authored
  cube whose `sql` is a real SQL expression has no field list to check against),
  only when the probe answers (no data engine, or an external datasource whose
  columns are not mirrored locally, stands down), and only to measures whose
  source is a bare column — `count(*)` has no source field, and a dotted
  cross-object reference resolves through a join this layer cannot see, so both
  pass through untouched. `id`/`created_at`/`updated_at` are admitted
  unconditionally, matching the data path's `resolveQueryFields`: a gate stricter
  than the engine it guards would reject queries that used to work. Validation
  runs before the cube is registered, so a rejected query leaves no trace in the
  registry — otherwise a retry would find a "registered" cube carrying the bogus
  measure and sail straight into SQL.

  This half is `minor` for the same envelope reason: a request that used to return
  500 now returns 400 with a different `code`, which is a visible contract change
  for any caller branching on the response.

- 1f0e7cb: fix(service-analytics): reject a dataset's cross-datasource JOIN when it is compiled, not when it is queried (#5115)

  #5033 routed a dataset's raw SQL to its base object's own datasource, which
  turned a JOIN whose target lives in another database into a **loud query-time
  failure** — correct, but late: the dataset can still be saved, published and
  put on a dashboard, and the failure lands in front of whoever opens that
  dashboard, usually in another environment on another day. It is a pure metadata
  error, decidable the moment the dataset is compiled: the whole dataset is
  lowered into ONE statement on the base object's datasource, so a join target
  bound elsewhere is simply not there.

  `compileDataset` now decides it. `AnalyticsService.registerDataset` — the single
  door every dataset passes through, whether pre-registered at boot, saved, or
  previewed as a Studio draft — hands the compiler the datasource and federation
  probes that already existed on `AnalyticsServiceConfig`, and a proven conflict
  is rejected before any SQL is built. The message names both objects, both
  datasources, the offending `include` path, and the two ways out (bind both
  objects to the same datasource, or drop the relationship), in the same wording
  family as the #5033 query-time diagnostic so the two never read as two bugs.

  **Who is affected.** This is a tightening: a dataset that used to compile and
  then fail (or, before #5033, silently read the wrong database) now fails at
  registration. It fires only where the metadata _proves_ the conflict — the base
  object and a join target each declare an explicit `object.datasource` and the
  two names differ. A dataset registered at boot is skipped with a WARN naming the
  conflict, as before; the rest of the host's datasets still register.

  **What is deliberately not rejected** ("cannot answer, do not block", the same
  tiering as `isRegisteredObject` / `getObjectFieldNames`):

  - a host that wires no datasource probe at all (no data engine) — compiles
    exactly as it did before;
  - either side leaving `datasource` at its default. `'default'` is the schema's
    default _value_, not a routing decision: `ObjectQL.getDriver` short-circuits
    only on an explicit non-`'default'` name, then falls through to
    `datasourceMapping` rules, the ADR-0057 §3.6 lifecycle split
    (audit/telemetry/event) and the owning package's `defaultDatasource` — none of
    which are visible to the compiler. Treating `'default'` as "the primary DB"
    would reject datasets whose objects a mapping rule in fact lands on the _same_
    database;
  - a federated (external) participant on either side. `NativeSQLStrategy` already
    declines such a cube (ADR-0062 D6), so the query is served by the ObjectQL
    FK-expand path, which crosses datasources by construction.

  Everything not proven here keeps failing loudly at query time via #5033.
  Making cross-datasource dashboards actually _work_ (declining in
  `NativeSQLStrategy` and serving the join with two reads) is separate and not
  part of this change.

- 6117f7b: fix(spec,service-analytics): a percentage measure carries its SCALE, so a ratio of 1 is 100% (objectui#3136)

  A `%` format string says how to PRINT a number, not what scale that number is
  on — and the two readings collide at exactly `1`, which is both "100%" (a 0–1
  ratio at full compliance) and "1%" (a single percentage point). With nothing on
  the wire to tell them apart, renderers guessed from the value's magnitude and
  resolved the collision the wrong way: an SLA / pass-rate dashboard reporting
  `sla_rate = 1` displayed **"1.0%"** — "everything met the SLA" read as "1% met
  the SLA" — on both the KPI card and the dataset table.

  The scale was never actually unknowable; it just never left the server. A
  measure declaring `derived: { op: 'ratio' }` is a 0–1 fraction _by definition_,
  and a measure aggregating a `percent` field has whatever scale that field
  stores. Both facts sit in metadata the enrichment pass already reads for the
  ADR-0053 currency chain — which walks back to the source field, checks
  `type === 'currency'`, and rides the resolved code onto the result column.
  Percentages got no such treatment. They do now, through the same seam.

  **`percentScaleOf(field)` (`@objectstack/spec/data`)** is the one place the
  question is answered. A `percent` field stores a FRACTION unless it declares
  `max > 1` (e.g. `min: 0, max: 100`), which marks whole-percent storage — the
  same rule the percent edit widget already writes by, so a value round-trips.
  Non-`percent` fields get no opinion: a plain `number` an author formatted with
  a `%` keeps meaning exactly what their format string says.

  **`AnalyticsResult.fields[].percentScale`** carries the answer: `'fraction'`
  (`1` ⇒ "100%") or `'whole'` (`1` ⇒ "1%"), absent when the column is not a
  percentage. `queryDataset` sets it from the measure's `derived.op === 'ratio'`
  first, then the source field's scale. `currency` — emitted since ADR-0053 but
  only ever written through a cast — is now declared on the same interface.

  The config seam `measureCurrency` is renamed **`sourceFieldMeta`** and returns
  `max` alongside `type`/`defaultCurrency`. The old name had already outgrown
  itself: the date-bucketing path reads `type` through it to tell a `date`
  dimension from a `datetime` one, and the percent chain is its third consumer.

  Renderers that receive `percentScale` must scale by it rather than inferring
  from the value; one that does not receive it (an older server) keeps whatever
  fallback it has, so this is additive on the wire.

  **Same widget family, second fix: an empty filtered group is a measured zero.**
  A measure-scoped filter can exclude every row of a group the grid still lists,
  and the database reports that by omitting the group from the supplementary
  result — after the merge, indistinguishable from "not measured". For a COUNT or
  a SUM it _is_ measured: the answer is 0. `emptyGroupValueFor(aggregate)`
  (`spec/data/aggregation-policy`) states which aggregates have an identity over
  the empty set, and `queryDataset` fills it in once all supplementary merges are
  done (a later measure's merge can append rows no earlier query saw). So
  "0 of 12 paid" now reports `0` instead of blank, and a ratio built on it
  computes to `0` instead of going null — the difference between a dashboard
  saying "0% met the SLA" and saying nothing at all. `avg`/`min`/`max` keep their
  null: there is nothing to average over an empty group, and flattening that to
  zero would invent a measurement.

- 763931e: feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

  Filter values travel as JSON, so a time- or user-scoped slice writes a
  placeholder instead of code:

  ```ts
  filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
  ```

  The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
  `context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
  (#3574). What was missing is the half that _substitutes a value_: **nothing on
  the server ever did**. A placeholder reached the driver as the literal string
  `'{current_year_start}'`, compared as text, and matched nothing.

  That failure is invisible — an empty widget looks exactly like a metric that is
  legitimately zero — so apps worked around it by computing dates at module load,
  which freezes "this year" into the built artifact and quietly goes stale.

  **New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
  server-side seams every filter passes through:

  - **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
    queries, related lists, saved-view filters and flow `find_records` all resolve.
    It runs before the middleware chain, so only author-supplied filters are
    inspected; RLS/sharing filters are injected downstream from concrete values.
  - **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
    `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
    This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
    comparands directly, so a dashboard widget never passes through `engine.find()`.

  Behavioural notes:

  - Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
    `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
    on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
    there is still exactly one source of truth for the storage convention.
  - Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
    per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
    can never straddle a boundary.
  - `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
    `userId`. A request carrying neither now **throws** instead of resolving to
    `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
    back the rows the filter was written to exclude.
  - An unrecognised placeholder **throws**, carrying the near-miss fix
    (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
    `{current_quarter_start}`). This matches what `objectstack build` already
    enforces. Consequence, previously implicit and now load-bearing: a filter value
    that is _entirely_ `{...}` is always read as a placeholder, so a literal value
    of that shape is not expressible — rename the value.

  Also in this change: `notify` no longer sends the six-character string
  `"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
  `.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
  turned that into a phantom recipient — the emit "succeeded", addressed nobody,
  and said nothing. Unresolved recipients are now dropped, and a node with no
  recipient left fails naming the offending template and pointing at the start
  node's `config.expand` (#3475), which does hydrate the relation.

- 3f8817a: feat(spec,drivers,objectql,analytics,formula): `$icontains` reaches every JS evaluation face (#6520)

  The other half of #5702. That change implemented `$icontains` on the SQL family
  and correctly left the spec's `FILTER_OPERATORS` alone; this one adds the
  operator to that array and gives every remaining evaluation face an arm, in ONE
  change, because those two steps cannot be separated.

  **Why one PR.** `FILTER_OPERATORS` is not a word list, it is a runtime allowlist:
  `driver-memory`'s shape gate derives from it, and its matcher's `default:` arm
  assumes the gate already refused anything unimplemented. Measured on a branch
  that added the name early (#5701): the gate stopped refusing, the matcher fell
  through, and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
  `true` — the predicate silently dropped, every row matched. A dropped predicate
  does not narrow a query, it WIDENS it, and on an RLS read scope that is a
  permission bypass rather than a degraded feature (#3948). So the word list
  travels with the evaluators or not at all.

  **What now answers it**, all folding the same domain: `driver-memory` (query
  path, reference matcher, and the analytics/cube face), `driver-mongodb`,
  `objectql`'s `having`, `@objectstack/formula`'s `matchesFilterCondition` (the RLS
  write-side `check`), and `service-analytics`' three SQL compilers (the RLS
  lowering, the native-SQL strategy, and the `/analytics/sql` echo).

  **The fold is ASCII-only, and that is the contract, not an implementation
  detail** (#4706 Q1 = A). `$icontains: 'café'` does not match `CAFÉ`. Every face
  reads one shared definition — `foldAsciiCase` /
  `asciiCaseInsensitiveContains` / `asciiCaseInsensitiveRegexSource`, new exports
  on `@objectstack/spec/data` — because the two obvious per-package spellings are
  both wrong in the same direction: `toLowerCase()` folds the whole Unicode range,
  and so does a `RegExp` built with the `i` flag. SQLite folds ASCII only and three
  of the five drivers are SQLite underneath, so a Unicode fold on a JS face would
  re-open exactly the divergence the ruling closed. The pattern-binding faces
  (mingo, mongo) therefore emit one `[Aa]` character class per ASCII letter and
  pass NO flags; mongo's `$icontains` is the one arm in its family that does not
  set `$options: 'i'`.

  The comparand keeps the rules its SQL twin has: matched LITERALLY (`%`, `_` and
  regex metacharacters are ordinary characters), and refused when empty or
  non-string — an empty comparand matches every row, which is a predicate that
  constrains nothing.

  **User-visible effect.** A filter using `$icontains` now behaves the same on the
  in-memory double and on SQL, so an app whose tests run on one and whose
  production runs the other stops getting two answers from one filter. Downstream,
  #5814 (better-auth `Where.mode: 'insensitive'`) no longer hits a 400 on the
  memory double.

  Not changed, and still tracked: the `$contains` family still folds Unicode on
  `driver-memory`'s query path and `driver-mongodb` (#6682) — both remain DEBT rows
  in `scripts/check-driver-conformance.mjs`, now naming one open requirement each
  instead of two. `formula`'s unknown-operator posture stays a silent, fail-closed
  `false` (it governs a write-side check, where an unevaluable condition denies
  rather than widens); the decision and its limits are documented on
  `matches-filter.ts`, and no operator the spec DECLARES is answered that way any
  more.

- 99ffc04: fix(analytics)!: a measure emits what it declares, instead of `COUNT(*)` (#4157)

  `NativeSQLStrategy.resolveMeasureSql` answered `COUNT(*)` to three different
  questions it could not otherwise answer — each time aliased under the name the
  caller asked for, so the result looked like an answer:

  1. **A measure the cube does not declare.** `lookupMember`'s synthetic
     relation fallback is dimension-only, so any undeclared or mistyped measure
     name landed here. `measures: ['revenue']` against a cube without it returned
     `COUNT(*) AS "revenue"` — a row count presented as revenue.
  2. **A `number`/`string`/`boolean` metric.** `AggregationMetricType` documents
     these as _"Custom SQL expression returning a number / string / boolean"_: the
     measure's `sql` **is** the computation — a ratio, a `CASE`, a window
     function. The expression was discarded and replaced by a row count.
  3. **An unrecognised `type`.** Same silent substitution.

  Now: an undeclared measure and an unrecognised type **throw**, naming the
  declared measures and both accepted vocabularies respectively; a custom-
  expression type emits its expression unwrapped. The six aggregates are
  unchanged.

  **A dot no longer implies a relationship hop.** `qualifyAndRegisterJoin` split
  any dotted string into a join chain, so the expression `SUM(account.amount)`
  became `"SUM(account"."amount)"` _plus_ a `LEFT JOIN "SUM(account"` — invalid
  SQL naming a table that does not exist. Harmless only while the result was
  being thrown away for `COUNT(*)`; emitting the expression makes it matter. A
  dotted string is now treated as a path only when every segment is a bare
  identifier, so `account.amount` still lowers to a qualified column and a join,
  and an expression is emitted as written. That also fixes the same mangling for
  an _aggregate_ measure whose `sql` is an expression — `type: 'sum'` with
  `sql: 'SUM(account.amount)'` was producing the same garbage.

  **Breaking, narrowly.** Two inputs that used to produce SQL now raise: a query
  naming an undeclared measure, and a cube measure with a type outside
  `AggregationMetricType`. Both were returning a wrong number rather than data,
  so nothing correct can depend on them — but a caller that was silently getting
  row counts will now see an error, which is the point. This is the trade #3948
  settled for the drivers.

  Datasets are unaffected: `aggregateToMetricType` only ever emits an
  `AggregationFunction` member, so a compiled dataset never had a
  custom-expression measure or an unknown type. The reachable path is a
  hand-authored Cube.

  `metric-type-coverage.test.ts` asserts the aggregate and expression sets
  _partition_ `AggregationMetricType`, so a tenth metric type fails a test rather
  than reaching the throw. Both sets are named, not derived as each other's
  complement — deriving would classify a new _aggregate_ as an expression and emit
  a bare column, a different silent wrong answer.

  Verified: **460 tests across 35 files** green, including the four suites that
  assert `COUNT(*)` — all of them use a _declared_ `type: 'count'` metric, so none
  relied on a fallback. The 14 new tests were confirmed to fail against the old
  behaviour (6 of 10 in the behaviour suite) before the fix.

- fc5f126: feat(analytics): serve in-envelope cross-object grouping on the ObjectQL path by FK-expand (#3654)

  `engine.aggregate()` cannot join, so the ObjectQL fallback path (date-granularity
  bucketing, in-memory driver, federated objects) previously REJECTED any
  cross-object grouping like `revenue by account.region` (#3664 stopgap — a loud
  error instead of the earlier silent `(null)` mis-bucket). It now SERVES the
  common case directly.

  For a single-hop cross-object DIMENSION with recombinable measures, the strategy:

  1. groups the base aggregate on the lookup FK column (`account`) — which the
     engine can do — scoped to the base object;
  2. resolves each FK id to the related attribute (`region`) with a read of the
     referenced object **scoped to that object's own RLS**; then
  3. re-buckets by the resolved attribute in memory, recombining the measures
     (sum/count add; min/max take the extremum).

  A base row whose referenced record the caller cannot read buckets under an
  explicit `(restricted)` group: its measure still counts (grand totals are
  preserved) but the hidden record's attribute never appears — no leak (ADR-0021
  D-C, the #3602 class). `/analytics/sql` renders the equivalent `LEFT JOIN`.

  Deliberately bounded — still REJECTED (loud, never silently wrong): cross-object
  references in a MEASURE or FILTER (need a real join to evaluate), multi-hop
  dimensions (`a.b.c`), and non-recombinable measures (`avg`, `count_distinct`)
  with a cross-object dimension. Cross-object queries on `NativeSQLStrategy` (the
  normal SQL path) are unchanged — it hand-compiles the joins.

- 3264516: fix(driver-sql,service-analytics)!: 两类无意义比较对象不再编译成「静默空谓词」——`$in`/`$nin` 的对象成员与 LIKE 族的对象比较值一律拒收 (#5234)

  两个形状此前都**编译通过、执行、并给出一个作者没写过的答案**,而且没有任何东西记录这件事:

  | filter                             | 改前                                                                                   | 改后                                               |
  | ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
  | `{status: {$in: ['a', {foo: 1}]}}` | 该成员绑不上任何行,查询答得**就像第二个成员从没被写过**                                | `INVALID_FILTER` / 400,点名 `index 1`              |
  | `{status: {$nin: [{foo: 1}]}}`     | `NOT IN ('[object Object]')` —— **一行都没排除**,作者写下的排除悄悄没发生              | 同上                                               |
  | `{name: {$contains: {}}}`          | `LIKE '%[object Object]%'` —— 对一行文本恰好是 `[object Object]` 的记录,**真的命中了** | `INVALID_FILTER` / 400,点名 `StringOperatorSchema` |
  | `{name: {$notContains: {}}}`       | 反过来:为一个没人记录的理由**排除了一条真实记录**                                      | 同上                                               |

  #5041(PR #5223)在 `assertCompilableComparand` 的头注释里把这两个形状写为 "Deliberately NOT
  extended",理由是它们 fail-closed(只收窄结果集)、比 #5041 实测的裸 `TypeError` 低一级。**实测下来这
  两条理由都不成立**:`$nin` / `$notContains` 方向是**放宽**(该排除的没排除,在 read-scope 下即 #5347 /
  #5324 判过的 over-reach);而 `$contains: {}` 给的从来不是「零行」,是**错行**。

  ## 三份实现一起动,否则修完仍是方言

  同一个 `String()` 宽容在本仓有多份;只收紧 `driver-sql` 会变成「哪个面接的就是哪个答案」——
  #5146 / #5332 / #5567 各花一轮消掉的那类分叉。守卫因此落在**每个包自己的收口点**,而不是三个发射器:

  - **`driver-sql`** —— `assertCompilableComparand`,#5041 已有的那一个门。
  - **`service-analytics` 的 `where` 门** —— `filter-normalizer.ts` 的 `fieldLeaves`。它是本包**唯一**的
    leaf 生产者,所以一处拒收同时覆盖三个消费方:`NativeSQLStrategy`(真正执行的语句)、
    `ObjectQLStrategy.generateSql`(`/analytics/sql` 回显)与 `ObjectQLStrategy.convertFilter`(引擎路径)。
    这个顺序是关键而非顺手:`convertFilter` 是**生产者**,在那里 `String()` 会把对象洗成一个类型完全正确
    的 `'[object Object]'` 字符串交给驱动,下游再严格的驱动也永远看不到它该严格的那个形状。
  - **`service-analytics` 的 read-scope 门** —— `read-scope-sql.ts` 的 `compileOperator`,它编译的
    `FilterCondition` 不经过上面那个门。

  `like-pattern.ts` 与 `applyLike` 里的 `String(value)` **原样保留**:它们不再是缺陷所在,因为门前已经没有
  渲染不出来的值能到达。两包的谓词由 `like-metacharacter-escape.test.ts` 逐值互锁——正是该文件已经用来锁
  转义表达式的同一套办法。

  ## 围栏是 allow-list,而且每一条都是实测后决定的

  抄 `driver-turso` `RemoteTransport` 的形状(cloud#1004 / #1058):deny-list 会把下一个被发明出来的值形状
  悄悄放进来,这正是那个 bug 熬过第一次修复的原因。顺带说明,**turso 自 #1058 起就已经拒收这两个形状**,
  所以本地 SQLite 与远程 SQLite 此前对同一条查询给的是不同答案;本次改动把它们收敛到一起。

  留在围栏内的(逐条实测,不是假设):

  - **数字 / 布尔 / `null`**:`{$contains: 5}` → `%5%`、`{$contains: null}` → `%null%` 在 `driver-sql`、
    `driver-memory` 与 analytics 两个面上**今天答案一致**,#5526 还专门把 `null` 这条钉住了。拒收它们是在
    **破坏**一致,不是建立一致——所以只拒**对象**。
  - **`Date`**:turso 的 allow-list 把它作为唯一的对象转换保留,拒收会重新叉开本地与远程。
  - **binary**:`$in` 成员照收(`isBindableComparand` 与写路径 `formatInput` 同一套分类),LIKE 拒收——它
    绑得上但渲染不出作者想要的东西。这就是两个谓词而不是一个带 flag 的原因。
  - **`undefined`**:不可授权(JSON 没有 `undefined`),analytics 门按 #5526 / #5332 归一为 `null` 而非拒收;
    在 `driver-sql` 拒收它会**造出**一个分歧而不是消除一个,故照旧。

  被拒的**数组**是本次唯一一个「拒收即消分叉」的形状:`{name: {$contains: ['al','be']}}` 在 `read-scope-sql`
  (与 `driver-sql`)绑 `%al,be%`,在 analytics 的 `where` 门却绑 `%al%`(它读 `values[0]`,后面的成员被
  静默丢弃)。同一个包对同一条 filter 有两个答案,两个门现在都拒。

  ## 作者需要知道的迁移

  这两个形状本来就没有能用的读法——`filter.zod.ts` 的 `StringOperatorSchema` 早就把 LIKE 族比较数声明为
  `z.string()`,本次只是让声明变成强制(Prime Directive #12,declared = enforced)。改后它们答 400 而不是
  一个错答案;把比较数换成字面值即可。`{$eq: {…}}` **不在本次范围**,仍按 `toSqlBindValue` 绑 JSON(#5526
  钉住的行为)。

### Patch Changes

- c7f4417: fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

  Both returned `await builder` directly, without the `formatOutput` pass every
  `find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
  stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
  storage form went straight to the caller:

  | call                                   | before                       | after                            |
  | -------------------------------------- | ---------------------------- | -------------------------------- |
  | `find()`                               | `"2026-01-10T09:00:00.000Z"` | unchanged                        |
  | `distinct('closed_at')`                | `[1768035600000]`            | `["2026-01-10T09:00:00.000Z"]`   |
  | `aggregate()` `max(closed_at)`         | `1768035600000`              | `"2026-01-10T09:00:00.000Z"`     |
  | `aggregate()` `groupBy: ['closed_at']` | key `1768035600000`          | key `"2026-01-10T09:00:00.000Z"` |

  Same root cause as #3773, different exit. `Field.date` was never affected — it
  is ISO TEXT on every dialect, so its storage form already equals its
  presentation.

  The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
  closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
  dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
  fallback — that one consumes already-formatted `find()` rows, so the same
  dataset changed key type depending on which path served it.

  Which columns hold an instant is now recorded while the statement is built,
  because that is the only point where a column name and its meaning are both
  known: a `min()` lands under its alias and never under the field name, while a
  date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
  rather than an instant. Matching on names afterwards gets both backwards.

  `distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
  compares STORED values, and one SQLite datetime column holds both INTEGER and
  TEXT forms, so two rows recording the same instant survived as two and then
  presented identically. It has no in-repo callers today; this keeps it honest
  rather than leaving a second convention in the driver.

  **`cross-object-rebucket` was fixed alongside it, because presenting min/max
  correctly is what exposed it.** `recombine()` coerced every operand with
  `Number()`, which silently depended on receiving an epoch: handed the ISO string
  the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
  returns a `Date`) it had always flattened the value back to an epoch integer one
  layer above the driver. `min`/`max` now order by the instant and return the
  winning value in the shape it arrived in; `sum`/`count` stay numeric.

- 259459d: refactor(spec)!: retire `array_agg` / `string_agg` from `AggregationFunction` — `count_distinct` deliberately kept (#6188, ADR-0049)

  `AggregationFunction` declared eight functions; the SQL family compiles five.
  `SqlDriver.mapAggregateFunc` and the Turso `RemoteTransport.aggregate` each lower
  `count`/`sum`/`avg`/`min`/`max` and route everything else to one refusal, so
  three of the eight were declared-but-unenforced against the backends this
  platform targets — and, worse, the _set_ each backend implemented was different,
  so "which aggregations can I use" had no answer an author could read off the
  schema.

  What makes these two sharper than an ordinary inert declaration is that another
  package had to carry a denylist for them. `service-analytics` subtracted
  `array_agg` and `string_agg` by name in `UNSUPPORTED_AGGREGATES`, because
  without that subtraction they reached the Cube strategy's `default` and came
  back as `COUNT(*)` — **a row count in place of the value the author asked for**,
  with no error and no log (objectui#2945).

  **The three unlowered functions were SPLIT, not retired as a block** (maintainer
  ruling, 2026-08-07):

  - **`count_distinct` STAYS** and takes ADR-0049's _enforce_ leg. It is a
    dashboard staple with one portable lowering (`COUNT(DISTINCT x)`), and
    `service-analytics` lowers it already; the SQL-driver implementation follows
    on its own card. Its declaration leads its implementation here by decision,
    not by drift.
  - **`array_agg` / `string_agg` take the _remove_ leg.** Display conveniences
    with no measured pull, and `string_agg` never had one shape to lower to at
    all: the delimiter is a second argument in PostgreSQL, a `SEPARATOR` clause in
    MySQL and a differently named function in SQL Server.

  FROM → TO, both authoring surfaces:

  | Was                                                                         | Now                                                                                                                                       |
  | :-------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
  | `aggregations: [{ function: 'array_agg', field: 'tag', alias: 'tags' }]`    | no replacement — read the rows with an ordinary `fields` query and shape them in the caller, or materialise the roll-up as a stored field |
  | `aggregations: [{ function: 'string_agg', field: 'name', alias: 'names' }]` | as above                                                                                                                                  |
  | `measures: [{ name: 'tags', aggregate: 'array_agg', field: 'tag' }]`        | delete the measure — `compileDataset` already refused it by name, so it never produced a number                                           |

  The retirement kit:

  - This is an enum **VALUE** retirement, so there is no `retiredKey()` tombstone:
    the enum's own error map carries the prescription, keyed on the received value
    so that only the two spellings which used to be legal are told they "were
    removed" (the `crypto.hash` / `HookBodyCapability` precedent, #4391). A
    mis-spelling still gets zod's list of the legal functions. For the same reason
    nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are
    byte-identical — no def and no authorable key changed.
  - **ADR-0087 D2 conversion + D3 chain step**
    (`dataset-measure-array-string-agg-removed`): `os migrate meta --from 16`
    drops any `dataset.measures[]` declaring a retired aggregate, plus any derived
    measure the drop strands, with a notice each. The measure is dropped rather
    than stripped down because one with neither `aggregate` nor `derived` fails
    the dataset's own refinement — a conversion whose output cannot parse is worse
    than none.
  - **D3 semantic entry** (`query-array-string-agg-retired`) for
    `QueryAST.aggregations[].function`: a request surface, never stored, so there
    is no source for the chain to rewrite and callers move their own queries.
  - The engine's in-memory fallback (`@objectstack/objectql`) drops its arms for
    both functions — a `switch` case on a value the enum no longer has does not
    type-check, and a dead arm is how a retired vocabulary returns by accident.
  - `service-analytics`' `UNSUPPORTED_AGGREGATES` is now **empty and kept**: it is
    half of an arithmetic the lockstep suite enforces (`SUPPORTED = spec
vocabulary − this`), which is what stops the next aggregate added to the spec
    from silently reaching that `COUNT(*)` default.

  **Behaviour that actually changes** — this is the rare narrowing that removes
  reachable behaviour, and it is worth stating plainly: on `driver-mongodb` and on
  the engine's in-memory fallback these two DID compute. A raw QueryAST
  aggregation against those backends returned an array or a joined string and will
  now be refused at parse. That unpredictability is precisely what the ruling
  ended — an aggregation that worked on one backend and failed on another is not a
  capability — and both of those backends are inside the #5499 freeze. Their code
  is untouched; it is simply no longer reachable through a spec-valid request. On
  the dataset path nothing changes: `compileDataset` refused both by name already.

  <!-- adr-0087: registered query-array-string-agg-retired, dataset-measure-array-string-agg-removed -->

- b4be309: fix(analytics): a new spec aggregate can no longer silently return a row count

  Track C item 4 of objectstack-ai/objectui#2945 — _"`AggregationFunction`: three
  places in lockstep"_. They agreed only by coincidence, and the failure mode when
  they stopped agreeing was silent wrong numbers.

  The three:

  1. `AggregationFunction` (`@objectstack/spec/data`) — eight members, what an
     author may declare as a dataset measure's `aggregate`.
  2. `UNSUPPORTED_AGGREGATES` (`dataset-compiler.ts`) — `array_agg`/`string_agg`,
     rejected at compile time with a clear error.
  3. The aggregate `switch` in `native-sql-strategy.ts` — six cases, then
     `default: return 'COUNT(*)'`.

  8 − 2 = 6 = the six cases, today. Add a ninth member to the spec — `median`,
  `percentile`, anything — and it would:

  - pass the compiler's gate, since it is not in `UNSUPPORTED_AGGREGATES`;
  - be **advertised as supported** by that gate's error message, which listed
    `count, sum, avg, min, max, count_distinct` as hand-written prose — a third
    copy of the vocabulary;
  - reach the strategy's `switch`, match no case, and fall to
    `default: COUNT(*)`.

  The author asks for a median and gets a row count. No error, no log, wrong
  figures on a dashboard — the same silent-wrong-answer shape as the filter
  operators in #3948, in the analytics SQL builder.

  **The fix is derivation plus a guard, with no behaviour change.** The `switch`
  becomes `AGGREGATE_SQL`, a table whose coverage is assertable; the error
  message's prose list becomes `SUPPORTED_AGGREGATES`, derived as
  `AggregationFunction.options` minus `UNSUPPORTED_AGGREGATES`; and
  `aggregation-lockstep.test.ts` asserts the arithmetic — the lowered set equals
  the admitted set, every spec member is either lowered or explicitly rejected,
  nothing is both, and the rejection list names only aggregates the spec has.

  Verified by adding a hypothetical `median` to the spec, which now fails three
  assertions naming it, including _"these would fall through to the COUNT(_)
  fallback and return a row count"\*. Before this change the same edit was green.

  Nothing is narrowed and no SQL changes: the same six aggregates lower to the
  same six expressions, and the `COUNT(*)` fallback still catches everything else.

  **Reported, not fixed:** that fallback is also reached by a measure whose `type`
  is `number`/`string`/`boolean` — a custom SQL _expression_, per
  `AggregationMetricType` — whose expression is then replaced by a row count.
  Datasets cannot produce one (`aggregateToMetricType` only ever returns an
  `AggregationFunction` member), so it is reachable only from a hand-authored
  Cube. Emitting `col` instead is a behavioural change in an analytics SQL path
  and deserves its own change with its own tests; the strategy's doc comment now
  records it.

- 7a55913: fix(service-analytics): a `$between` analytics filter no longer vanishes from the query (ADR-0053 D-A3.1)

  A dashboard widget or dataset whose filter used `$between` was querying **every
  row**. `normalizeAnalyticsFilters` maps Mongo-style operators onto the internal
  pipeline form, `$between` was missing from that map, and an unmapped operator is
  skipped — so the predicate was silently dropped from the compiled WHERE clause.
  Both strategies read that normalizer, so both the raw-SQL and the ObjectQL
  aggregate paths were affected. The symptom is #3650's: a chart that draws the
  whole dataset instead of the requested window, with nothing in the SQL to
  suggest a filter was ever asked for.

  `$between [min, max]` now lowers to its two bounds (`gte` + `lte`) instead of
  gaining an operator of its own, so a range's max inherits the calendar-day
  whole-day rule (#3777) from each strategy's existing upper-bound handling —
  `NativeSQLStrategy` compiles a bare-day upper bound half-open itself, and the
  ObjectQL path gets the same rule from the driver — rather than needing a second
  implementation to keep in step. A malformed `$between` (not a two-element
  array) now throws instead of being dropped, matching the stance driver-memory
  took for the same shape in #3948: an unbounded read is exactly the failure this
  prevents, and it is indistinguishable from a legitimately wide query.

  Found by giving the temporal conformance matrix its missing sixth consumer
  (`native-sql-temporal-conformance.test.ts`), which executes the shared cases
  against a real SQLite engine and asserts row ids — a dropped predicate is
  invisible to the SQL-string assertions the strategy's other suites use.

- c637387: fix(service-analytics): only a canonical numeric spelling is recovered as a number, so `'007'` / `'1.50'` stay strings (#5528)

  An analytics `where` round-trips every comparand through the internal
  `values: string[]` form — `stringifyForCube` on the way out, and
  `coerceFilterValueForSql` / `coerceFilterValueForObjectQL` on the way back. The
  decoder decided "this is a number" from the string's **shape** alone
  (`/^-?\d+(\.\d+)?$/`), which cannot distinguish a number that was stringified on
  the way out from a string the author actually wrote.

  Measured before the fix, on cube `orders` / TEXT column `code`:

  | author's `where`        | leaf `values` | SQL bind | engine comparand |
  | ----------------------- | ------------- | -------- | ---------------- |
  | `{code: {$eq: '007'}}`  | `["007"]`     | `7`      | `7`              |
  | `{code: {$eq: '0912'}}` | `["0912"]`    | `912`    | `912`            |
  | `{code: {$eq: '1.50'}}` | `["1.50"]`    | `1.5`    | `1.5`            |

  Both consumers were affected: the raw-SQL bind in `NativeSQLStrategy` and the
  comparand handed to the ObjectQL aggregate engine.

  The failure was **silent and mis-targeted, not empty**. Against a text column
  SQLite applies the column's affinity to the integer bind, so a widget filtered on
  order number `'007'` returned the row storing `'7'` — a different row, with no
  error to read; on Postgres the same query is a `text = integer` type error, and on
  the engine path the strict comparison simply matched nothing (measured: 0 rows).
  Zero-padded and trailing-zero strings are ordinary business shapes — order
  numbers, work orders, SKUs, dialling codes, postcodes, `'1.50'` prices.

  Recovery is now limited to a number's **own canonical spelling**
  (`String(Number(s)) === s`):

  - a comparand that really was a number is `String(n)` by construction, so it
    still round-trips — `7` → `'7'` → `7`, `1.5` → `'1.5'` → `1.5`, `-3` → `-3`;
  - a string `Number()` would rewrite — `'007'`, `'0912'`, `'1.50'`, `'1.0'`,
    `'-0'`, or more digits than a double holds — cannot have come from a number, so
    it stays the string the author wrote.

  The narrowing can only ever **remove** recoveries: the shape regex still runs
  first, so `'1e3'`, `'1e+21'`, `'+7'`, `' 7'`, `'0x10'`, `'Infinity'` and `'NaN'`
  were strings before this change and are strings after it. This also aligns with
  ADR-0053 D-A2, which demoted this textual type re-derivation to a last resort
  behind the driver-backed `coerceTemporalFilterValue` hook.

  **Stopgap, and named as one.** `values: string[]` still has no escape, so the
  author strings `'null'` / `'true'` / `'false'` still collide with the tokens the
  encoder writes for the real `null` and booleans. Making the round trip lossless —
  tagged values, or an `unknown[]` internal representation — is #5526; the
  collision is pinned as unchanged in
  `src/__tests__/filter-value-canonical-number.test.ts` so it is not mistaken for
  fixed.

- 2f05139: fix(service-analytics): `compareTo` applies measure-scoped filters, so `<measure>__compare` is the same measure as the column beside it (#4820)

  A dataset measure declared with its own `filter` is scoped by running a
  supplementary grouped sub-query — `combineFilters(baseFilter, measureFilters[m])`
  — and merging it back by dimension key. The `compareTo` pass did not: it issued
  **one** shifted query over every base measure with only the base filter as its
  `where`, and never consulted `compiled.measureFilters` at all.

  For a dataset like

  ```ts
  measures: [
    { name: "revenue", aggregate: "sum", field: "amount" },
    { name: "won_count", aggregate: "count", filter: { stage: "closed_won" } },
  ];
  ```

  the current-period column was scoped and the comparison column was not — two
  different measures rendered side by side under one label:

  | #   | measures               | where                    |         |
  | :-- | :--------------------- | :----------------------- | :------ |
  | 1   | `revenue`              | —                        | current |
  | 2   | `won_count`            | `{"stage":"closed_won"}` | current |
  | 3   | `revenue`, `won_count` | **absent**               | shifted |

  `won_count__compare` was therefore a count of **every** opportunity in the
  previous window, inflated by exactly the rows the measure exists to exclude.
  The error runs one way: the comparison period always looks better, so a "won
  deals vs. last month" tile reads as a collapse when nothing went wrong. Only
  filter-scoped measures were affected — the unfiltered ones next to them compared
  correctly, which is what made it survive.

  The comparison window now runs the **same pass** as the current period —
  unfiltered measures in one shifted query plus one shifted sub-query per
  filter-scoped measure, merged by dimension key — through a single shared
  implementation, so the two paths cannot re-diverge at the next change. The
  dataset filter, the presentation's `runtimeFilter` and the measure's own filter
  compose identically in both windows; the only difference between them is the
  shifted `dateRange`.

  Numbers reported by existing dashboards change where a filtered measure was
  compared: with 3 won deals this month against 1 won of 5 opportunities last
  month, `won_count__compare` was `5` and is now `1`.

  Cost: one extra query per filter-scoped measure when `compareTo` is set.
  Selections whose measures carry no filter are untouched and still compare in a
  single shifted query.

  The empty-group fill (#4708) covers the new seam: a group the measure's filter
  empties in the _previous_ window now reports `0` for a `count`/`sum` compare
  column rather than blanking it, exactly as it already did for the current period.

- c113690: fix(service-analytics): `contains` 以规范算子 `$contains` 送进引擎,比较值不再落进正则位置(#5557)

  `ObjectQLStrategy.convertFilter` 在同一个 `switch` 里处理 LIKE 家族的四个算子。
  其中三个(`notContains` / `startsWith` / `endsWith`)自 #4128 起就是规范 spec 算子,
  只有 `contains` 是 `{ $regex: values[0] }` —— 比较值**原样**放进一个正则位置,不转义。

  实测(修复前 → 修复后,引擎收到的 filter):

  | `where`                          | 修复前                           | 修复后                        |
  | -------------------------------- | -------------------------------- | ----------------------------- |
  | `{stage: {$contains: 'a.b'}}`    | `{stage: {$regex: 'a.b'}}`       | `{stage: {$contains: 'a.b'}}` |
  | `{stage: {$notContains: 'a.b'}}` | `{stage: {$notContains: 'a.b'}}` | 不变                          |
  | `{stage: {$startsWith: 'a.b'}}`  | `{stage: {$startsWith: 'a.b'}}`  | 不变                          |
  | `{stage: {$endsWith: 'a.b'}}`    | `{stage: {$endsWith: 'a.b'}}`    | 不变                          |

  三条后果,都是作者没有要求过的行为,且都不依赖 #4706 对 `$regex` 语义的裁决:

  1. **`$regex` 不在契约里。** `filter.zod.ts` 的 `FILTER_OPERATORS` 声明 15 个算子,
     没有 `$regex` —— 这是**生产方**在发送 schema 未声明的算子。按 Prime Directive #12
     修生产方(一个 `case` 标签),而不是给消费方加宽容。
  2. **同一棵过滤树在同包两个消费方之间不通。** `read-scope-sql.ts` 的
     `compileScopedFilterToSql` 也是一个 `FilterCondition` 消费方,`compileOperator`
     的 `default` 是 fail-closed,于是它对本策略产出的 filter 直接抛
     `unsupported operator "$regex" … (fail-closed)`。
  3. **行结果取决于哪个驱动来答。** 把 `$regex` 当真正则求值的后端(driver-memory 的
     `memory-matcher.ts` 就是,而且是有意为之 —— 服务 plugin-auth 的 ObjectQL adapter)
     把 `a.b` 读成「a、任意一个字符、b」,于是 `axb` 也被匹配上;而 `50% (+)` 作为正则
     根本编译不过(`Nothing to repeat`),`catch` 之后 `return false` —— 一个**有匹配行**
     的筛选器静默返回零行,作者那边只看到「无数据」。同一个 `$contains` widget 在
     `driver-sql` 上则被编译成子串 LIKE:同一张 dashboard,不同驱动,不同行集。

  `filter-normalizer.ts` 的 `MONGO_TO_CUBE_OP` 只把 `$contains` 映到 `contains`,
  别无来源,所以这里回送 `$contains` 就是作者自己那个 key 的往返。

  **测试**(`objectql-contains-canonical-operator.test.ts`,新增):引擎 filter 的算子键
  逐个对 `filter.zod.ts` 的 `ALL_OPERATORS` 校验(取自 spec 而非手抄一份);行结果跑在一个
  复刻 `memory-matcher.ts` 各 arm 的求值面上 —— `a.b` 只命中字面行、`50% (+)` 命中它该
  命中的那一行且**恰好**只有那一行(修复前分别是多一行和空集);同一个 filter 再送进
  `compileScopedFilterToSql` 确认它现在编译得过。只断言 filter/SQL 字符串会漏掉「不转义」
  这一半,所以两半都断言。

  顺带删掉 #5558(PR for #5333)在 `objectql-echo-operator-coverage.test.ts` 的替身引擎里
  留下的那处 `$regex` → `$contains` 翻译:它存在的理由就是本单,现在没有了。那也是本修复
  最直接的反向证据 —— 把 `case 'contains'` 退回 `$regex`,该文件的 `$contains` 行会以
  上面第 2 条的 fail-closed 报错红掉。

- 705efeb: fix(analytics): a dataset refusal that declares an ADR-0112 envelope is never degraded to an empty result (#5717)

  `queryDataset` wraps execution in a catch that exists for one deliberate reason
  (#5033): a widget whose backing object is not mounted in this kernel renders
  "no data" instead of failing with a 500. The criterion for "not mounted" was
  `isMissingSourceError` — a substring match over the error MESSAGE. So the
  leniency was available to any error that happened to phrase itself like a
  driver, and #5352 / #5367's finding on the REST face — "the wire shape of an
  error family must not be a property of its wording" — applied here one level
  worse: the outcome was not a wrong status code but a **silent empty result**.
  No exception, no 4xx, no 5xx; one `warn` line and a confident empty chart, which
  is the "populated table, Total Spend: 0" symptom #5033 was filed about.

  One refusal already matched. `dataset-compiler.ts` refuses an `include` naming a
  relationship the object graph does not have with

  > `[dataset-compiler] dataset "X" includes relationship "R" which does not exist on object "O".`

  which carries both `relation` (inside "relationship") and `does not exist` — and
  that conjunction was the postgres limb. It has never gone off for one reason:
  `queryDataset` compiles **before** the try, so that throw has never been inside
  the catch's reach. A mine, wired and unarmed.

  **Two independent defences, so the disarming does not depend on either one.**

  - **The criterion (main change).** An error carrying an ADR-0112 envelope —
    numeric `status` + non-empty `code`, the same structural fact
    `rest-server.ts`'s `/analytics/dataset/query` catch reads — is re-thrown
    untouched, ahead of any message inspection. Its producer already answered the
    classification question. The status RANGE is deliberately not part of the
    test: a `DATASET_INVALID` / 400 rendered as an empty grid is the loud case,
    but a declared 5xx (`READ_SCOPE_COMPILE_FAILED` — an RLS lowering that failed
    closed) is if anything worse to swallow, since nobody is told at all.
  - **The sniffer.** Its postgres limb is now anchored to postgres's actual
    wording (`relation "x" does not exist`) instead of "any sentence containing
    both words" — the same pattern the sibling `missingSourceRelation` already
    used, so "is something missing" and "what is missing" can no longer disagree.

  **Observable behaviour change — read this if you alert on empty widgets.** The
  guarantee is new, not the status of any shipped message: measured over the 13
  real wordings this repo carries (three driver families including sql-prefixed
  and schema-qualified forms, the framework's not-registered signals, and this
  package's own refusals), exactly one verdict moves — the compiler refusal above,
  which reaches callers as `400 DATASET_INVALID` either way because its throw site
  sits outside the try. What changes is that a caller-shaped refusal raised
  **during execution** can no longer become `{rows: [], fields: [], totals: []}`
  by phrasing alone: it now propagates and the route answers its declared code
  (4xx as itself, declared 5xx through `ANALYTICS_QUERY_FAILED`). A dashboard that
  silently rendered an empty chart for such a refusal will now surface the error.

  **#5033's leniency is untouched, and that is asserted rather than claimed.** A
  bare driver error is still classified by its words and still degrades: `no such
table` (sqlite/libsql), postgres's real `relation "x" does not exist`, mysql's
  `doesn't exist`, the framework's not-registered signals — and a bare error
  naming a JOINED table still fails loudly as a cross-datasource dataset. Those
  cases are green in all four states of the reverse verification
  (`dataset-degradation-envelope.test.ts`), including with both defences reverted.

  The compile point deliberately stays outside the try. Moving it in would newly
  expose the compiler's own bare invariants and the host-supplied relationship
  resolver to this degradation path — widening leniency in the opposite direction
  from the fix.

- 978fed2: fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

  `POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
  families because the route recognised their **prose**, not because the errors
  said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
  (`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
  list of message substrings behind it, since all six producers were still bare
  `throw new Error(…)`:

  ```
  /not declared in the dataset|not backed by a declared relationship|
   not supported by the v1 dataset runtime|read-scope-sql|
   not a selected dimension or measure|is not a subset of the selected dimensions/
  ```

  That made the HTTP status of six families a property of their wording.
  Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
  no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
  different family, and no test and no gate would have gone red. Prime Directive
  #12 permits an accommodation like that only while it is declared, loud, tested
  **and removable on a schedule**; #5366 delivered the first three and nothing
  carried the fourth.

  **Five producers now declare their own verdict.** A new
  `dataset-refusal.ts` in `@objectstack/service-analytics` exports
  `datasetInvalidError` — the same shape as that package's existing
  `invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
  (`INVALID_FIELD` / 400) — and five sites throw through it:

  - `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
    a dimension/measure traversing a relationship path the dataset never declared
    in `include`;
  - `dataset-executor.ts` — an `order` key that is not a selected dimension or
    measure; a `totals` grouping that is not a subset of the selected dimensions;
  - `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

  Their five entries are gone from the route's list, which is now a single
  `read-scope-sql` test.

  **`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
  read-scope lowering failures whose inputs are an admin-authored policy and a
  compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
  request is invalid") may well be the wrong verdict and choosing the right one is
  a separate judgement, still tracked by #5367. Deleting the entry before that
  judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

  **No outward behaviour change for the five.** They answered
  `400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
  message; what changed is the mechanism, from message-matching to the producer's
  own declaration. The one visible difference is for a bare `Error` that merely
  _resembles_ one of those messages: it is no longer promoted to a 400. That is the
  point — a phrase is no longer a classification.

  `DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
  ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
  constructor types it as `RegisteredErrorCode` so an unregistered code is a
  compile error rather than a body some route rejects at runtime.

  Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
  five refusals against its real producer — the refusal SET first, green before and
  after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
  drives all five end-to-end through a real `AnalyticsService` with positive
  controls on both the aggregate and raw-SQL paths; and
  `analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
  — the five messages answer 400 when enveloped and 500 when bare, so re-adding a
  regex entry turns it red.

- c36abfe: fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

  #4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
  the field, because a driver error class must never be the caller's `error.code`
  for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
  identical typo one request key over still reached the driver as a `GROUP BY`
  column:

  ```
  POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437
  POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
  → 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
  ```

  **The gate.** `ensureCube` now runs `assertDimensionFields` alongside
  `assertMeasureFields` on every path, so a dimension whose source column the
  backing object does not have is refused **before** any SQL is built, with the
  same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
  `field` / `object` / `param`, a message naming the field, the valid dimensions,
  and the object's known field list. `query`, `generateSql` and `queryDataset` are
  all covered, and a rejected query leaves nothing behind in the cube registry.
  `timeDimensions` are covered too — they resolve through the same
  `cube.dimensions` bag and produced the same 500 — with `param` reporting which
  request key carried the bad name.

  **What deliberately did not change:** grouping by a REAL field the cube never
  declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
  "does the _object_ have this field", never "did the cube declare this
  dimension". A cube whose `sql` is an expression, a dotted relation dimension,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure gate stands down.

  **The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
  5xx body and echoed the error message verbatim. Knex prefixes the offending
  statement to its message, so the caller received the generated SQL — physical
  table and column names included:

  ```
  500 {"code":"ANALYTICS_QUERY_FAILED",
       "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
  ```

  The sibling face never leaked it: `/analytics/query` exits through the
  dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
  to every >= 500 message since #3867. That same predicate now guards this route's
  500 body. Classification is untouched — the status stays 500, the code stays
  `ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
  message list are unchanged — and the full text still reaches server logs. A 500
  whose message does not look like driver output keeps its prose.

- 2bc1876: fix(service-analytics): refuse a dotted `measures` entry loudly instead of aggregating the base column (#5918)

  **Observable behaviour change.** An analytics query whose `measures` entry
  carries a dot that is not the cube-name qualifier — `owner.region_count_distinct`,
  `total.sum` — now answers `400 INVALID_FIELD` naming the entry **as the request
  spelled it**. Some of these queries used to succeed.

  That is the point: succeeding is what was wrong with them. The auto-inference
  path minted a measure by dropping the first segment of any dotted entry, so on
  an object that happened to carry a same-named column the query ran

  ```
  SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct" FROM "crm_account"
  ```

  — no JOIN, no error, a response column labelled with a relation attribute and a
  number that came from the base table. The caller could not tell from the result
  that it was wrong. Where the object had no same-named column it degraded to the
  #4437 gate's `400 INVALID_FIELD`, which was honest about what reached SQL
  (`aggregates field 'score'`) but named a string nobody had written; the caller
  had sent `owner.score_sum`.

  `measures` was the fourth and last mint site of the punctuation #5739 sorted
  out on `dimensions` / `where` / `timeDimensions`. It is ruled the other way, and
  deliberately so: `lookupMember`'s relation-traversal tier is dimension-only, so a
  dotted measure has no correct traversal answer to converge on. A refusal is the
  honest answer, and it costs nothing that was working. Maintainer ruling,
  2026-08-07.

  Both a genuine traversal intent (`owner.amount_sum`) and a plain typo
  (`total.sum`) get this refusal. They are lexically indistinguishable on this
  path, and separating them would need field metadata the ad-hoc path does not
  have. A real relation-traversal measure (`SUM("owner"."amount")` + LEFT JOIN)
  would be a capability with its own justification, not a side effect of a strip.

  The refusal is applied at both places a Metric is minted from a request
  spelling — the ad-hoc mint and the suffix-augmentation mint for a cube that is
  already registered — because the ad-hoc path registers what it infers, so the
  very same query reaches the second one from the second request onwards.

  Unchanged: the `<cube>.` qualifier (`crm_account.region_count_distinct`) is
  still stripped and still runs; bare measures (`region_count_distinct`, `count`,
  `created_at_max`) are untouched; a cube's own declared measure is authored, not
  minted, so a Cube whose measure names a related column in its `sql` still
  compiles the JOIN — which is the supported way to aggregate across a
  relationship; and dotted **dimensions** still traverse, per #5739.

  **Migration.** Aggregate one of the object's own fields
  (`<field>_sum` / `_avg` / `_min` / `_max` / `_count_distinct`), or declare a Cube
  whose measure names the related column. The refusal message says both, and names
  the entry you sent.

- 9ecdca9: fix(service-analytics): `/analytics/sql` 回显补上 `$startsWith` / `$endsWith` 谓词(#5333)

  `ObjectQLStrategy.generateSql` 是同一棵过滤树的**第三个**编译器 —— 输出给浏览器的
  展示 SQL。它的 `buildFilterClauseSql` 显式处理 `set`/`notSet`/`in`/`notIn`/
  `contains`/`notContains`,其余落到只有六个条目的 `SCALAR_SQL_OPS` 查表;
  `startsWith` / `endsWith` 两处都不在,于是走到 `return null`,而**这棵树的每个编译器
  都把 `null` 读成「本节点没有约束」**。结果:

  | `where`                       | 实际执行(`NativeSQLStrategy`)    | 修复前的回显                    | 修复后的回显                     |
  | ----------------------------- | -------------------------------- | ------------------------------- | -------------------------------- |
  | `{stage: {$startsWith: 'w'}}` | `WHERE stage LIKE $1` / `['w%']` | **没有 WHERE**,`params` 为空    | `WHERE stage LIKE $1` / `['w%']` |
  | `{stage: {$endsWith: 'n'}}`   | `WHERE stage LIKE $1` / `['%n']` | **没有 WHERE**,`params` 为空    | `WHERE stage LIKE $1` / `['%n']` |
  | `{stage: {$contains: 'w'}}`   | `WHERE stage LIKE $1`            | `WHERE stage LIKE $1`(本来就对) | 不变                             |

  回显比实际执行的查询**更宽**。这个字符串存在的唯一理由就是复现执行 —— 文件自己在渲染
  块顶上写着 “a rendering that contradicts execution is worse than no rendering” ——
  所以一个带着「为什么这张图少了几行」来看回显的作者,拿到的是一条**没有该筛选条件**的
  语句:跑一遍返回更多行,于是结论是「筛选器没生效」,而实际执行是生效的。与
  #3601 / #3602 / #3650 同一类「回显与执行不一致」,只是这次是从**算子表**这一侧到达的。

  不涉及越权或错行:该字符串从不执行(`execute()` 的 echo 会丢弃 `params`),损害限于
  可调试性。

  **两处修改:**

  1. **LIKE 家族收进一张表。** 新增 `LIKE_SQL_OPS`,四个算子(`contains` /
     `notContains` / `startsWith` / `endsWith`)的 SQL 拼写与 pattern 并排放在一起,
     与 `NativeSQLStrategy.buildFilterClause` 的 `opMap` / `likePattern` 逐条对应 ——
     回显描述的正是那个编译器产出的语句,两张表并列摆着,漂移才看得见。
     `contains` / `notContains` 的产物一字未变。

  2. **「渲染不了就静默丢」的出口改为 THROW。** `return null` 在这里与「无约束」同形,
     所以下一个新增算子会以同样的方式再丢一次。之所以**可以**抛错:上游算子词汇表是
     **封闭**的 —— `filter-normalizer.ts` 的 `fieldLeaves` 是叶节点的唯一生产者,它对
     `MONGO_TO_CUBE_OP` 之外的算子在建叶之前就以 `INVALID_FILTER` / 400 拒绝。因此任何
     调用方写出的过滤器都到不了这个出口;真到了,只能意味着 normalizer 的表新增了这里
     没有分支的算子,那是我们自己两张表漂移,而对此**唯一不能给的答案就是悄悄放宽作者的
     查询**。与 `convertFilter` 的 `default:` 分支在 #4128 做出的是同一个选择;刻意**不**用
     `invalidFilterError` 的 400 信封 —— 这不是调用方形状的错误。

  **该 throw 出口今天从公共入口不可达,这一点是测过的、也是刻意报告的**:把它改回
  `return null`(保留第 1 项修改)只会让它自己那一条断言变红,枚举断言和回显对照表
  全部保持绿色。它是一个漂移探针,不是行为修复 —— 行为修复是第 1 项。

  新增 `objectql-echo-operator-coverage.test.ts`:issue 那张对照表按**行结果**钉住
  (回显语句在同一份 fixture 上真的被执行,行 id 与查询实际返回的行 id 比对 —— 丢掉的
  谓词藏不住,它返回的正是筛选器排除掉的行),再按 `filter.zod.ts` 的
  `FILTER_OPERATORS` 枚举全部 15 个可编写算子,逐个断言回显渲染出谓词、且
  placeholder 与 `params` 对齐。只断言 SQL 字符串会放过下一个未映射的算子 —— #4128 里
  `$between` 就藏在 `$startsWith` 后面。

- 7101ca2: fix(analytics): apply the EFFECTIVE date granularity to bucket labels and drill ranges (#3588 follow-up)

  `selection.dateGranularity` (shipped in #3652) reached the `GROUP BY` but not the
  post-processing: the bucket-label formatter and the drill-range inverter both
  kept reading the DATASET dimension's default. A query was grouped one way and
  described another. Found by driving a real dashboard query in a browser against
  a dataset whose dimension declares `dateGranularity: 'month'`:

  - selection `year` → the row came back labelled **`1970-01`** — a year bucket
    re-formatted with the dataset's month granularity, its `"2026"` key re-read as
    2026 _milliseconds_ past the epoch;
  - selection `day` → day buckets were re-labelled as months, so ten distinct days
    collapsed into two duplicated keys;
  - selection `quarter` / `year` / `day` / `week` → `drillRanges` came back empty,
    silently removing drill-through from every bucketed chart.

  Granularity precedence now lives in one exported function,
  `resolveDimensionGranularity`, called from all three sites that must agree — the
  query's `GROUP BY`, the label formatter, and the range inverter. The drift was
  possible only because each site resolved it independently.

  Two consequences beyond the override case:

  - A dataset dimension that declares **no** granularity but is bucketed by the
    widget now gets drill ranges too. Previously the range sidecar keyed off the
    dataset's own `dateGranularity`, so this case — the one #3588 is actually
    about — could never drill.
  - `formatDateBucket` no longer mistakes a bare year key for an epoch timestamp.
    A year bucket's canonical key IS `"2026"`, which is the only bucket key that
    collides with the pure-digit epoch heuristic (`"2026-Q2"`, `"2026-07"` and
    `"2026-07-15"` all fail it). Being idempotent over already-formatted keys is
    that function's stated contract; the year case just never held.

- cfc293f: fix(service-analytics): 空 `$and` / `$or` 按布尔单位元归约,两个编译器与五后端对齐 (#5322)

  同一个仓库对空组合子曾有两个对立答案:五个 `FILTER_LOGIC_CASES` 后端
  (`driver-sql` #5134/PR #5243、`driver-memory`、`formula`、`driver-sqlite-wasm`、
  `driver-mongodb` #5239)把 `{ $and: [] }` / `{ $or: [] }` 归约成布尔单位元,而
  service-analytics 的两个编译器 —— `read-scope-sql.ts` 的 `compileNode` 与
  `filter-normalizer.ts` 的 `buildNode` —— 成文地 fail-closed 抛错("An empty
  combinator has no defensible reading…"),并有 pin 测试钉住。2026-08-04 维护者拍板
  (#5322)取单位元,本次把两处对齐:

  - `{ $and: [] }` = TRUE(全部行,AND 单位元);`{ $or: [] }` = FALSE(零行,OR
    单位元)。嵌套可归约:空组合子作 `$or` 分支时按 TRUE 吸收/FALSE 退出析取,作
    `$not` 操作数时取反(`{$not: {$and: []}}` = 零行、`{$not: {$or: []}}` = 全部
    行)。`{}` = TRUE 与 `{ $not: {} }` = 零行两格已由 #5297(read-scope)/#5325
    (normalizer)先行落地,本次连同这四格由同一张一致性表钉住。
  - **迁移含义**:过去发出空组合子的调用方收到的是抛错(REST 面上是一次失败的请
    求);现在按上表求值。`{ $or: [] }` 在 RLS/图表场景是 fail-closed 的 —— 析取列
    表循环出零项时隐藏全部行,而不是放行全表。写作期对字面量空组合子的响亮拒收另立
    #5330(publish/lint),不在运行期。
  - **没有放宽的部分**:非数组的 `$and`/`$or`、非对象的分支、非对象的 `$not` 操作数
    仍然抛错(#5325 的形状拒收原样保留)。归约让「无约束」成为有意义的裁决,静默把
    畸形分支读成 TRUE 会让垃圾析取项吸收 `$or` 而放宽查询,所以畸形形状保持响亮。
  - 归约与 #5146/#5325 的 NULL-safe `$not` 重写的组合语义是「先归约、后 NULL-safe」
    —— 常量归约出的单位元不受重写影响,幸存的叶子照常加守卫,有测试钉住。
  - `packages/spec`:`FILTER_LOGIC_CASES` 补四条布尔单位元行(空 `$and`、空 `$or`、
    `{}` 析取项吸收、`{$not: {}}`),两个 analytics conformance suite 与五后端从此
    被同一张表钉住这四格。

- de70b42: analytics: `$ne` / `$nin` / `$notContains` in a dashboard `where` keep the rows that have no value

  Second batch of the #5298 ruling, after PR #5962 landed it on `driver-sql`,
  `read-scope-sql` and `formula`. An analytics filter meaning "not this" now
  returns the rows whose column is empty, the same answer every other backend
  gives — a `stage != 'won'` widget shows the deals with no stage set.

  The Cube face was the last surface still splitting on it, and it split three
  ways for one filter. Measured on the package's own fixture before the change,
  for `{stage: {$ne: 'won'}}` with rows 3-4 carrying a NULL `stage`:

  | compiler                            | was     | now     |
  | ----------------------------------- | ------- | ------- |
  | `NativeSQLStrategy` raw SQL         | `2`     | `2,3,4` |
  | `ObjectQLStrategy` display-SQL echo | `2`     | `2,3,4` |
  | `ObjectQLStrategy` engine condition | `2,3,4` | `2,3,4` |

  The engine column was already right — because `driver-sql` guards for itself
  since #5962, not because the analytics layer did — so which rows a widget drew
  depended on which compiler downstream caught the leaf, and the `/analytics/sql`
  echo described a narrower query than the one that ran.

  `filter-normalizer` now emits the guard as tree STRUCTURE (an `or` of the null
  predicate with the comparison) rather than as a SQL trick in one strategy, so
  all three compilers of that tree produce one predicate and none of them needs
  to know the rule. Which operators are guarded is decided by the polarity table
  the `$not` rewrite already consults, not by a second list of operator names:
  positive comparisons (`$eq`, `$in`, `$contains`, the ordering family) compile
  byte-identically to before, `$ne: null` stays `IS NOT NULL`, an empty `$nin`
  stays the TRUE constant, and `{$not: {stage: {$ne: 'won'}}}` still means
  "stage is won" rather than widening.

  `FILTER_LOGIC_CASES` is unchanged: the `$ne` and `$not` null rows enrol in
  #5903's PR, which clears the last backend (`driver-turso` remote). The spec
  table's measured blocker matrix drops the Cube row it no longer describes.

- 7a55913: fix(service-analytics): every authorable filter operator now reaches the query (#4128)

  Closes the cause behind the `$between` defect rather than just that instance.
  `normalizeAnalyticsFilters` skipped any operator missing from its map, and a
  skipped predicate does not narrow a query — it **widens** it: the compiled SQL
  stays valid and returns rows the author excluded. Four operators from the
  spec's authorable vocabulary sat in that state, plus one that was mapped
  incorrectly.

  - **`$startsWith` / `$endsWith`** were dropped entirely. Both strategies now
    compile them — anchored `LIKE 'x%'` / `LIKE '%x'` on the raw-SQL path, and
    the canonical `$startsWith` / `$endsWith` operators (which every driver
    implements directly) on the ObjectQL path, so an anchored match does not
    depend on regex dialect.
  - **`$null`** was dropped. It is the shape the console emits for an "is empty"
    / "is not empty" filter, so such a widget was showing every row. Now compiles
    to `IS NULL` / `IS NOT NULL` per its boolean.
  - **`$exists`** was mapped value-_independently_ to `set`, so `{$exists: false}`
    compiled to `IS NOT NULL` — the exact inverse of what it asks for. It and
    `$null` are now resolved explicitly, because a key→name map cannot express an
    operator whose meaning flips with its value.
  - **`$notContains`** reached the ObjectQL strategy, which had no arm for it and
    fell through to a `default` returning a bare value — compiling "does not
    contain x" as "**equals** x".
  - **Unknown operators now throw** on both surfaces instead of being silently
    dropped (normalizer) or reinterpreted as an equality (ObjectQL strategy). An
    operator outside the vocabulary is a caller error, and a loud one beats a
    silently widened read — the call driver-memory made for the same shape in
    #3948.

  Still declared as a gap, but no longer a silent one: `$or` / `$not` are skipped,
  since expressing them needs a recursive WHERE builder rather than the flat
  array the strategies consume.

  Cover is `filter-operator-coverage.test.ts`, which runs the whole vocabulary
  against a real SQLite engine and asserts **row ids** — six of its cases fail
  without this change. A dropped predicate is invisible to the SQL-string
  assertions the strategies' other suites use, which is how these survived.

- 2f6516e: fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

  Misspell an operator in a dashboard widget's filter and analytics refuses it —
  correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
  argued for one refusal at a time: dropping a predicate the compiler cannot
  express does not narrow the query, it **widens** it to rows the author excluded,
  and a chart drawn over the whole dataset looks like a working chart.

  The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
  — read as "the platform is broken" rather than "your filter has a typo", and
  counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
  `400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
  chosen by which face happened to catch it.

  **One defect, two halves — either alone leaves it unfixed.**

  - **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
    `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
    `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
    becomes the module's only way to refuse.
  - **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
    discarded `error.code` / `error.status` and re-derived the classification from
    a hardcoded list of message substrings — so a producer that took ADR-0112
    seriously was punished for it. It now reads the envelope **first**; the
    substring list is demoted to a fallback for the families that still carry no
    envelope.

  **Observable behaviour change — read this if you alert or retry on status.**
  The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
  `400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
  already declared an envelope this route was discarding, `400 INVALID_FIELD` for
  a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
  unregistered cube). Monitoring that counted these as server faults will see the
  5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
  retrying a request that could only ever fail the same way. Both are the intended
  correction — the condition was always the caller's mistake — but they are
  visible, so they are stated rather than buried.

  **Which inputs are refused did not change.** This changes the SHAPE of the
  error and nothing about the judgement that produced it: no refusal condition
  was touched, no input that used to compile now refuses, and no input that used
  to refuse now compiles. That claim is pinned input-by-input (refusals _and_
  accepted inputs with their compiled trees) in
  `filter-refusal-envelope.test.ts`, which is green both before and after the
  change — only the envelope assertions move.

  The message-substring list survives on purpose. All six of its entries were
  re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
  `dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
  families from `400 DATASET_INVALID` to 500. It is a placeholder for their
  enveloping, not a second classification mechanism, and it is now documented as
  such: a new refusal should carry a `code`/`status` and be served by the
  envelope branch for free. The passthrough is deliberately **4xx-only** and
  requires **both** `code` and `status`, so an internal fault can never be
  re-labelled as the caller's fault, and this route never invents a code a
  producer failed to supply.

- e6b1bb0: fix(service-analytics): 过滤值不再被降级成字符串 —— `{code: {$eq: '007'}}` / `'null'` / `'true'` 按作者写的字面值绑定 (#5526)

  analytics 的 `filter-normalizer` 内部把每个比较数(comparand)压成 `values: string[]`
  再由消费方**猜**回类型:出口是 `stringifyForCube`,入口是 `recoverNumber` 与
  `coerceFilterValueForSql` / `coerceFilterValueForObjectQL`。字母表是"全体字符串"、
  解码规则是"这串看起来像不像数字/布尔/null"的编码没有任何转义机制,于是作者写的字符串
  和编码器为其他类型写下的 token 撞车。`{code: {$eq: v}}` 在 `main` 上实测:

  | 作者的 `v` | SQL 绑定          | 引擎绑定          |
  | ---------- | ----------------- | ----------------- |
  | `'007'`    | `7`(#5528 已修)   | `7`(#5528 已修)   |
  | `'1.50'`   | `1.5`(#5528 已修) | `1.5`(#5528 已修) |
  | `'null'`   | 真 NULL           | 真 `null`         |
  | `'true'`   | `1`               | `true`            |

  每一行都是一个缺陷:存着作者那种写法的 TEXT 列不再匹配。`'007'` 在 SQLite 上是
  整数与 TEXT 列的跨类型比较、恒不相等,在 Postgres 上 `text = integer` 直接报类型错;
  `'null'` 那一行比"空"更糟 —— 与真 NULL 的比较对任何行都是 UNKNOWN,图表永远画不出东西。
  零填充串、当枚举码用的 `'true'`/`'false'`、当字面标签用的 `'null'` 都是真实业务形状
  (订单号、SKU、邮编、国际长途区号)。

  **修法**:`NormalizedFilterNode` 的 leaf `values` 由 `string[]` 改为 `unknown[]`,
  作者写的值原样穿过整棵树,不再有任何东西去解码它。仅在边界真正要求时才转换:

  - `toSqlBindValue`(唯一留下的转换,且是**单向**的:值 → 它的 SQL 绑定形态,不是解码器)
    ——只处理驱动绑不了的 JS 类型:`boolean` → `1`/`0`(better-sqlite3 拒绝 JS 布尔)、
    `Date` → ISO 文本、其他对象 → JSON 文本。它不检查任何字符串。
  - LIKE 族的比较数被 `filter.zod.ts` 声明为 `z.string()`,所以在发射点字符串化 ——
    与 `driver-sql` 的 `applyLike` 同一个 `String(value)`,两个面上 `$contains` 仍是一件事。

  ObjectQL 引擎路径现在不需要任何转换:引擎按**存储**的运行时类型比较,而它拿到的就是
  作者写的值。`stringifyForCube` / `recoverNumber` / `coerceFilterValueForSql` /
  `coerceFilterValueForObjectQL` 一并删除。

  两处读法作为直接后果改变了,方向都是 fail-closed:

  - `{name: {$contains: null}}` 原先编译成 `LIKE '%%'` —— 匹配**每一个**非 NULL 行,
    因为 `stringifyForCube(null)` 是 `''`;现在是 `LIKE '%null%'`,与 `driver-sql`
    一直以来的编译结果一致。
  - `{amount: {$gt: null}}` 原先编译成 `amount > ''`(一次针对空字符串的真实比较);
    现在绑定 NULL,谓词为 UNKNOWN、图表画不出行 —— 无序比较数的诚实答案,也是
    `driver-memory` / `formula` 给出的答案。(#5332 明确指出这个比较数位置没有任何裁决
    覆盖、`''` 只是占位符;删掉编码器就按构造把它定了。)

  `timeDimensions[].dateRange` 的两个边界现在按 spec 声明的类型(`string[]`)原样传递:
  原先它们也过 `coerceFilterValueForObjectQL`,其文档宣称"epoch-ms 边界会还原成数字"——
  那是消费方在宽容地兜一个契约并未声明的形状,和把 `'007'` 读成 `7` 是同一个猜测
  (Prime Directive #12:epoch-ms 窗口要么在生产者、要么在 spec 里声明,不在这里猜)。

  `{stage: null}` / `{$eq: null}` / `{$ne: null}` / `{$null:}` / `{$exists:}` 的空值
  谓词语义(#5332 / #5525)不变:真 `null` 比较数编译成 `notSet` / `set`,从不进入
  `values`。#5567 的 LIKE 转义契约不变。

- 415254c: fix(analytics): scope the dimension-label lookup to the referenced object's RLS (#3602)

  When a dataset groups by a `lookup`/`master_detail` dimension, analytics resolves
  the grouped FK ids to the related record's display name via a per-record read
  (`group by id`) dressed as an aggregate. That read carried **no read scope**, so
  it revealed related-record display names whenever the referenced object's RLS is
  stricter than the base object whose rows carry the id — a user could see a name
  the referenced object's own RLS would hide. (Same-object and looser-referenced
  cases were already safe because the ids come from the post-#3597 scoped
  aggregate; this closes the stricter-referenced case.)

  The label lookup now applies the **referenced object's own** read scope — bound
  to the request via the same `getReadScope` provider the aggregate path uses,
  composed with `$and` (never key-merge) so it can't be displaced by the id
  predicate. Fail-closed: if that object's scope can't be resolved, the dimension's
  labels are skipped (the raw id renders) rather than fetched unscoped. No behaviour
  change when no read-scope provider is configured.

  Internal `DimensionLabelDeps.fetchRecordLabels` gains an optional `scope` argument
  and `resolveDimensionLabels` an optional `resolveScope` resolver; both are
  service-analytics-internal (no spec/contract change).

- a7b854f: fix(service-analytics): the three SQL compilers compare LIKE values literally (#5567)

  `$contains` / `$notContains` / `$startsWith` / `$endsWith` build a `LIKE` pattern
  around the comparand the author wrote. All three of this package's SQL compilers
  concatenated that comparand straight into a wildcard position — no escaping, no
  `ESCAPE` clause — so `_` (LIKE's single-character wildcard) and `%` (its
  multi-character one) stopped being literals. Measured on real SQLite, over the
  rows `x_admin` / `xyadmin` / `off 50% now` / `off 5012 now`:

  | `where`                         | returned    | correct |
  | ------------------------------- | ----------- | ------- |
  | `{name: {$contains: '_admin'}}` | `['1','2']` | `['1']` |
  | `{name: {$contains: '50%'}}`    | `['3','4']` | `['3']` |
  | `{name: {$startsWith: 'x_'}}`   | `['1','2']` | `['1']` |
  | `{name: {$endsWith: '0% now'}}` | `['3','4']` | `['3']` |

  Every row is a **widening** — rows the author excluded came back — and
  `$notContains` is the mirror image, excluding rows the author kept. One of the
  three call sites is the ADR-0021 D-C read-scope (tenant + RLS) lowering, where a
  wider predicate is over-reach rather than a loose filter (the #5347 / #5324
  ruling on that same file). Prime Directive #3 forces machine names to
  `snake_case`, so essentially every machine-name comparand carries a `_` and hit
  this silently.

  All three compilers now escape the comparand and bind an explicit
  `ESCAPE` argument, matching what `driver-sql`'s `applyLike` has always done — so
  the same filter selects the same rows whichever strategy answers, and the
  `/analytics/sql` echo describes the statement that ran instead of a wider one.

  **No authoring change.** A comparand with no `_`, `%` or `\` binds exactly the
  pattern it bound before; only its meaning when it _does_ carry one changes, from
  wildcard to literal. If you were relying on a comparand acting as a wildcard,
  that was never a declared capability of these operators — the spec describes them
  as substring / prefix / suffix matches — and `driver-sql` already read it
  literally, so the reading you got depended on which strategy served the query.

- 1d0faa7: fix(service-analytics): postgres 的「缺列」措辞不再被判为「缺源」(#6035)

  数据集查询的降级路径靠驱动措辞判断「后端表没挂载」,从而把控件渲染成空网格而不是 500。
  它的判据 `isMissingSourceError` 自己的文档写明范围**只含缺表/缺对象,不含列/语法错误——
  后者要保持硬失败,好让真正的查询 bug 浮上来**。有一条 postgres 措辞按构造违反了这条承诺:

  ```
  column "label" of relation "acct" does not exist        (SQLSTATE 42703)
  ```

  它内部**逐字包含**一整段合法的缺表措辞 `relation "acct" does not exist`。#5717 把 postgres
  那一支从「同时含两个词的任意句子」收紧为锚定真实缺表措辞后,这条依然命中——它必然命中,因为它
  字面上**就是**那段措辞。所以任何对「这句话是不是在说某个 relation 不存在」的收紧都排除不掉它,
  只有**先问更具体的问题**才可以:修法是一个**判定顺序**(先摘掉缺列措辞,再做缺源判定),而不是
  一个更好的正则。

  两种后果都是错的,而具体触发哪一种只取决于措辞里那个关系名是否恰好是数据集自己的对象:

  - 名字是**被 JOIN 的表** → 报出一条响亮但**虚假**的跨数据源拓扑错误,把一个拼写错误说成数据源
    布局问题;
  - 名字是**数据集自己的对象** → 控件降级成空网格,只留一条 warn,拼错的列名不会告诉任何人。

  两半现在都作为回归钉住。判定顺序抄 `rest-server.ts` 的 `mapDataError` 自 #5352 起就在用的先例
  (它同样先摘出这条措辞,于是 REST 面回答 `400 INVALID_FIELD` 而不是 `404`),用的是同一条正则
  而不是它的第二种方言——两个面不该对「postgres 什么时候在说 column」给出不同答案。兄弟函数
  `missingSourceRelation` 做同样的前置摘除:实测在修改前它对这条措辞回答 `sys_team`,只修其一会让
  「是不是缺了什么」与「缺的是什么」相互矛盾,而那正是 #5717 在这一支上刚消除的分歧。

  **这不修线上事故,而是让判据与它自己的文档一致。** analytics 是只读面,而 postgres 在 SELECT
  下的未知列措辞是 `column "bogus" does not exist`(不含 `relation`,本来就不命中);
  `column … of relation …` 是 INSERT/UPDATE/ALTER 措辞。价值在于:这条分歧不再依赖「读路径不产生该
  措辞」这个假设活着——哪天有任何写形状语句、驱动改措辞、或多包一层 `cause` 把它送到这个 catch
  面前,它会被正确分类,而不是被静默吞掉。

  #5717 量过的 13 条仓内真实措辞全部重新钉住,并且是**按调用方可观测的结果**(空网格 / 拓扑拒收 /
  原样上抛)钉的,而不是按私有判据的布尔值——实测 **13 条里只有 1 条改判**,就是缺列那条,其余 12
  条(三个驱动家族的措辞、框架的 not-registered 信号、本包自己的拒收)逐条不变。

- f56ebea: fix(service-analytics): a `null` comparand in an analytics `where` is a null predicate, not `= ''` (#5332)

  `{stage: null}` compiled to `stage IS NULL`, while `{stage: {$eq: null}}` — the
  same predicate — compiled to `stage = $1` binding the empty **string**. One
  meaning had two answers inside one file: the bare-`null` spelling took
  `fieldLeaves`' `raw === null` branch, the operator spelling fell through to the
  `MONGO_TO_CUBE_OP` map, and `stringifyForCube(null)` handed it `''`.

  Measured before the fix, on cube `deals` / column `stage`:

  | `where`                  | WHERE           | bindings |
  | ------------------------ | --------------- | -------- |
  | `{stage: null}`          | `stage IS NULL` | `[]`     |
  | `{stage: {$eq: null}}`   | `stage = $1`    | `['']`   |
  | `{stage: {$ne: null}}`   | `stage != $1`   | `['']`   |
  | `{stage: {$null: true}}` | `stage IS NULL` | `[]`     |

  The failure was **silent, not loud**: an "is empty" dashboard widget drew zero
  rows — never an error — because a real value can never equal a NULL column, and
  the author saw "no data" rather than anything to debug. On a text column the
  `$ne` direction was worse than empty: in SQLite / MySQL `''` is a value rows
  genuinely store, so "stage is not empty" compiled to `stage != ''` and excluded
  exactly the rows it was asked to keep, while "stage is empty" returned the one
  row that is emphatically not null.

  `$eq: null` and `$null: true` are not near-synonyms to be reconciled by taste —
  `driver-mongodb`'s translator **rewrites** the latter into the former, so they
  are one predicate in the contract, and `read-scope-sql.ts` (this package's other
  SQL compiler), `driver-sql`, `driver-memory` and `formula` all compile them
  alike. This module was the one dissenting half of one package; `fieldLeaves` now
  emits the same `notSet` / `set` leaves for all three spellings, so both
  strategies, the ObjectQL engine filter and the `/analytics/sql` display echo
  follow with no new cases.

  The #5146 NULL-safe `$not` guard table moved in the **same** commit, because it
  describes this file's emitter rather than a sibling's: while `$eq: null` was a
  value comparison the guard correctly classified it as one, and left alone it
  would have wrapped `stage IS NOT NULL AND stage IS NULL` — an always-false
  conjunction — and negated it to **every** row for a filter meaning "stage is not
  empty". `nullValueSatisfiesOperator` and `operatorIsNullTotal` now carry the
  `value === null` arms their `read-scope-sql` counterparts have, and
  `{$not: {stage: {$eq: null}}}` returns the rows the other three backends already
  return for it.

  Scoped deliberately to the two spellings `filter.zod.ts` gives a null _meaning_.
  `stringifyForCube`'s `v == null` arm is untouched: it still serves comparand
  positions no ruling covers (`$gt: null`, `$in: [null]`), where `''` is a
  placeholder rather than an answer. An empty-string comparand also stays a value
  comparison — `{stage: {$eq: ''}}` still binds `''` — since reading `''` as null
  would be the same defect with its sign flipped.

  Authoring is unchanged; only the compiled predicate is. A widget that worked
  around the old behaviour by filtering on the literal empty string (`{$eq: ''}`)
  keeps working and still means the empty string; one that wrote `{$eq: null}` and
  saw nothing now gets its rows.

- 1f8390b: fix(analytics): ObjectQLStrategy now enforces the read scope (RLS + tenant) (#3597)

  `ObjectQLStrategy` never consumed `getReadScope`, so any analytics query served by
  that path ran with **no RLS or tenant predicate** — an authenticated caller
  received aggregates computed over every tenant's rows.

  Both belts were off at once. The strategy dropped the pre-resolved read scope, and
  the engine could not compensate: the `executeAggregate` bridge passes no
  `ExecutionContext`, so plugin-security's principal-less fall-open skipped its own
  RLS injection. Only `NativeSQLStrategy` was ever wired for ADR-0021 D-C.

  The exposure was **not** limited to exotic drivers. `NativeSQLStrategy` declines —
  handing the query to this path — on any date-bucketed query
  (`timeDimensions[].granularity`, the most common dashboard shape, on Postgres and
  SQLite too), on `RAW_SQL_UNSUPPORTED` (in-memory driver), and on federated objects.

  The scope is composed with `$and`, never by key merge, so a caller filter naming
  the same field (e.g. `organization_id`) cannot displace the security predicate.

  **Behaviour change to be aware of:** a query that references a **joined** object
  carrying its own read scope is now REJECTED on this path rather than run
  partially-scoped. `engine.aggregate`'s `where` addresses the base object, so a
  per-join predicate cannot be expressed there; failing closed matches the posture
  already taken by `resolveReadScopes` and `compileScopedFilterToSql`. Such a query
  previously returned results that omitted the joined object's tenant predicate.
  Run it on a native-SQL driver (`NativeSQLStrategy` scopes each join), or drop the
  cross-object dimension/measure.

  Deployments with no read-scope provider configured are unaffected — that path
  stays unscoped by documented contract.

- f5ab1c7: fix(service-analytics): a `$or` / `$not` filter no longer vanishes from an analytics query (#4128 follow-up)

  The last of the silently-dropped filter family. `normalizeAnalyticsFilters`
  produced a flat **array**, which cannot carry a disjunction, so both strategies
  skipped `$or` and `$not` outright — a widget or dataset whose filter used
  either compiled a WHERE clause that simply did not contain it, and drew every
  row. That is #3650's symptom, and unlike a rejected query it looks like a
  working chart.

  The normalizer now produces a **tree** (`normalizeAnalyticsFilterTree`), and
  each strategy compiles it the way its own backend expresses a disjunction:

  - **`NativeSQLStrategy`** builds the WHERE recursively, routing every leaf
    through its existing clause emitter — so the storage-form coercion and the
    calendar-day upper-bound rule (#3777) apply at every depth, including inside
    an `$or`. Parentheses are explicit rather than relying on SQL precedence.
  - **`ObjectQLStrategy`** hands `$or` / `$not` to the engine, which speaks them
    natively. AND-ed leaves still merge per field exactly as before, so a query
    without combinators produces byte-identical engine input.
  - **`/analytics/sql`** renders the same tree, so the echoed statement keeps
    reproducing what executes rather than showing a conjunction where the engine
    runs a disjunction.
  - The **cross-object envelope check** now sees members nested inside an `$or`.
    It rejects cross-object filters, so a member it could not see was a filter it
    could not reject.

  Empty `$and` / `$or` arrays now throw instead of being ignored, matching the
  fail-closed stance of `read-scope-sql.ts` — the compiler in this same package
  that has always handled the full tree, and whose semantics the tree walker now
  mirrors deliberately.

  Cover is `native-sql-filter-logic-conformance.test.ts`, which runs the shared
  combinator table (`FILTER_LOGIC_CASES`, #3774) against a real SQLite engine and
  asserts row ids. The analytics raw-SQL path now stands beside `driver-sql`,
  `driver-memory`, `formula` and `read-scope-sql` under that one standard; 14 of
  its 17 cases fail without this change.

- 3167e29: fix(analytics): sort dataset selections by the display label for select/lookup dimensions (#3680)

  `DatasetSelection.order` (what a widget's `options.sortBy` lowers to) sorted a
  `select` or `lookup`/`master_detail` dimension by its STORED value — the option
  value or the foreign-key id — while the response rows carry the resolved display
  label. A "sort by Account" therefore ordered by opaque ids and read as arbitrary;
  a localized select sorted by its ASCII value while showing a non-ASCII label.

  Order keys naming a label-bearing dimension now sort by the display label the
  user reads. The executor receives an injected sort-key hook (`OrderLabelResolver`,
  built by `queryDataset` over the same label-resolution capabilities and #3602
  read scoping as the display pass); only the COMPARISON substitutes the label —
  rows keep their raw values until the display pass, so drill metadata still
  snapshots stored values, and ordering + windowing stay one adjacent step (a
  "top 10 by account name" truncates the right ten).

  Cost model: sorting by a measure or a plain/date dimension is unchanged (SQL
  pushdown included). A label-ordered `select` resolves from field metadata (no
  query). A label-ordered `lookup` costs one batched id→name read over the
  pre-window grouped ids (chunked, and reused by the display pass via a
  per-request cache), and its window can no longer be pushed into SQL — the
  inherent price of ordering by a value the database doesn't store.

- f522e95: fix(service-analytics): the dataset raw-SQL bridge routes by object, so datasets over non-default datasources stop reading `0` (#5033)

  `AnalyticsServicePlugin`'s `executeRawSql` auto-bridge received the object name
  and threw it away: `engine.execute(knexSql, { args: params })`. `ObjectQL.execute()`
  picks its driver in the order `options.object` → `getDriver(object)`, then
  `options.datasource`, then the default driver — so rule 1 could never fire and
  **every dataset raw-SQL read landed on the default datasource**. Any object routed
  elsewhere (the ADR-0057 §3.6 telemetry split for `lifecycle.class ∈ {audit,
telemetry, event}`, an explicit `object.datasource`, a `datasourceMapping` rule)
  raised `no such table`, which the widget-level graceful degradation then turned
  into an empty result — a confident `0` over live rows, on a green dashboard.
  Measured: `sys_audit_log` returned 49 records through the object-routed read and
  `{"rows":[]}` through the dataset raw-SQL read, on the same running kernel.

  The bridge now passes `{ args: params, object: objectName }`, matching the
  `executeAggregate` bridge beside it (`engine.aggregate(objectName, …)`), so both
  dataset execution paths give **one** answer to "which datasource is this object in".
  No configuration change is needed; misrouted dashboards start reading real data.

  **Behaviour change worth knowing about.** A dataset whose SQL `LEFT JOIN`s (what
  `NativeSQLStrategy` emits for a dotted dimension such as `account.industry`) across
  two datasources previously ran against the default datasource and silently read the
  wrong database. It now runs on the base object's own datasource, where the joined
  table genuinely is not — and **fails loudly** instead of degrading, because the base
  table resolved fine and reporting it as "unavailable" would keep the confident `0`
  alive under a new cause. The error names the actual cause and the remedy:

  ```
  [Analytics] dataset "audit_by_actor" cannot be executed as one statement:
  table "account" is not on datasource "telemetry", which is where its base object
  "sys_audit_log" lives — "account" is registered on the default datasource.
  A dataset JOIN cannot cross datasources. Fix it by binding both objects to the
  same datasource, or by dropping the cross-datasource relationship from the
  dataset's `include`/dimensions.
  ```

  Graceful degradation is unchanged for genuine absence: a dataset whose own backing
  object (or a joined object that this kernel never registered) has no table still
  renders as "no data" with the existing server-side `warn`, rather than failing the
  widget. `AnalyticsServiceConfig` gains one optional, diagnostics-only hook —
  `getObjectDatasource(objectName)` — used solely to name the datasources in that
  message; it never selects a driver.

- 0a6fb1e: fix(analytics): the read-scope auto-bridge no longer depends on plugin order (#3618)

  `getReadScope` was only wired when the `security` service already existed at this
  plugin's `init()`. The closure itself resolved lazily, but the ASSIGNMENT was
  gated on an init-time probe — so a kernel that registers `AnalyticsServicePlugin`
  before the security plugin got **no read-scope provider at all**, and every
  analytics strategy ran unscoped with only a WARN to show for it.

  Both sibling bridges (`executeAggregate`, `executeRawSql`) are wired
  unconditionally and resolve at call time, and this one's own comment claimed the
  same. Now it actually does: the probe only decides the log wording.

  The CLI (`os serve`) registers security before analytics, so that path was
  already correct. The exposure was for embedders composing their own kernel — and
  for this repo's own `bootStack` harness, which registers analytics first, meaning
  the entire dogfood/verify suite had analytics RLS silently disabled and any RLS
  assertion written there passed vacuously.

  Also corrects the WARN text: with no provider, scoping is absent on ALL paths and
  ALL objects, not just "the raw-SQL path" and "joined objects" as it claimed.

  Adds `analytics-rls.dogfood.test.ts`: an owner-scoped RLS fixture driven over real
  HTTP as a real non-admin, asserting the rows a member's aggregate actually
  returns. Reverting either this fix or the #3597 strategy fix turns it red.

- fb3d99b: fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
  lower used to answer `400 DATASET_INVALID` with the refusal message echoed
  verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
  (`"Internal server error"`); the full text goes to the server log. Monitoring that
  counted these as client errors will see a 4xx disappear and a 5xx appear, and a
  client retrying on 5xx will now retry a request that cannot succeed until an
  administrator fixes the policy. Both follow from the correction below and are
  stated rather than buried.

  ## What was wrong

  These ten fail-closed refusals were the last family `/analytics/dataset/query`
  classified by **prose** — the final entry of the hardcoded message-substring list
  #5352 introduced, which #5367's first PR had already shrunk from six entries to
  one. Two defects in one verdict:

  - **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
    `FilterCondition` the security service compiled from an **administrator's**
    sharing rule / permission set, and a join alias the **dataset compiler**
    generated. Neither is caller input — the caller's own predicate goes through
    `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
    what can arrive here is a broken policy, or drift between two of our own
    components (#5557's `$regex` was literally the second case). For this request's
    caller both are a **server** fault; `400` told them to fix a request that was
    never wrong and kept the real fault out of 5xx alerting.
  - **Disclosure.** A 400 echoed the message, so
    `unsafe field identifier "secret_policy_field"` and
    `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
    and comparands of the RLS policy governing them.

  The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
  was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
  path, a 4xx misreports a condition the client cannot fix, and 422 would have left
  the disclosure question to be re-decided message by message).

  ## What changed

  - `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
    `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
    module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
    `:104`'s alias-vs-field split (option C on the card) collapses under B: both
    branches answer the same verdict, pinned so the collapse is a recorded decision.
  - `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
    fully retired** — nothing in this catch reads prose any more, and #5367's
    Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
    on a schedule") is paid off.
  - The route's 5xx branch now withholds the message of any producer that
    **declares** a server fault (`status >= 500` with a `code`). This was needed
    rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
    over SQL/driver _phrasing_, and measured, every read-scope message returns
    `false` from it — so retiring the list alone would have moved the policy content
    from a 400 body into a 500 body instead of out of the response. Teaching that
    heuristic to recognise `[read-scope-sql]` would have been _more_ message
    sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
    errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
    query …") stays readable.
  - `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-analytics` (ADR-0112 D3) and typed as
    `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
    error. It is legible on the wire through the sibling `/analytics/query` exit,
    which puts a thrown `err.code` at **`error.code`** (#3842) — read it there.
    `errorResponseBase` only stages the code inside a `details` object;
    `buildApiError` then runs `splitSemanticCode`, which promotes it into the
    declared `error.code` field and drops the now-empty `details`, so the key is
    omitted from the body and `error.details.code` is never present:
    `{"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED","message":"Internal server error","httpStatus":500}}`.

  **Which inputs are refused did not change.** No refusal condition moved: nothing
  that used to lower now throws, and nothing that used to throw now lowers. That is
  pinned input-by-input — refusals _and_ accepted read scopes with their compiled
  SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
  before and after; only the envelope assertions move.

  Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
  sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
  (rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
  asserting the 500, that the body contains no policy detail, and that the withheld
  text is present in the log — plus a positive control and both sides of the
  declared-vs-undeclared withhold.

- 1eaea20: fix(service-analytics): gate the `/analytics/query` SQL echo on debug, as the contract has always declared (#8286)

  `POST /api/v1/analytics/query` returned the executed statement to the caller in
  `data.sql` on every deployment, `NODE_ENV=production` included, with no debug
  flag requested and none available to request. The contract had declared the
  field debug-only since it was introduced — `AnalyticsResultResponseSchema`
  (`spec/api/analytics.zod.ts`) types it `optional()` and describes it as
  "Executed SQL (if debug enabled)" — but no implementation ever read a debug
  switch. This restores declared = enforced. **The contract is unchanged; the
  response now matches it.**

  **What was disclosed.** More than table and column names. The echoed statement
  carries the compiled read scope, so it describes the SHAPE of the tenant
  isolation predicate: on the reported deployment it showed that `sys_user` is
  walled by an enumerated `"sys_user"."id" IN ($2, $3, …)` member list rather than
  by an `organization_id` comparison — that is, which column the wall is built on
  and how — plus the bound-parameter arity, which counts the caller's own
  organization's membership and hands a prober the exact query surface to work
  against.

  **No wall was breached.** This is information disclosure and nothing more. The
  reporter ran the isolation probes on the same deployment and every one held:
  cross-tenant read answered 404, cross-tenant update and delete answered 403 at
  row-level security, a `filter`/`where` naming another organization came back
  empty, a batch write by foreign id answered per-row `PERMISSION_DENIED`, and the
  audit log and activity stream were partitioned cleanly. The wall works; it
  simply should not have been describing itself to callers.

  **The gate is one gate.** It lives at the response-assembly seam —
  `AnalyticsService.query`, the single point every strategy's result leaves
  through — not on any one strategy. `NativeSQLStrategy` returns the statement it
  ran, `ObjectQLStrategy` renders a representative one, and the fallback delegate
  passes through whatever the service it delegates to minted (the in-memory
  analytics service always echoes); gating one of the three would have left the
  others serving. `queryDataset` reaches the same seam through `DatasetExecutor`,
  so dataset-backed dashboard and report responses inherit the verdict without a
  second gate to keep in step.

  **The switch, and its default.** New `debugSql` option on
  `AnalyticsServicePlugin` (forwarded to `AnalyticsServiceConfig`). Unset means no
  host choice, which resolves to `NODE_ENV === 'development'` — and only that: an
  **unset** `NODE_ENV` counts as production and the echo stays off, matching how
  `os start`, `os serve` and `os doctor` already read that absence. Of the two ways
  to be wrong, disclosing on a production deployment whose operator forgot the
  variable is the dangerous one.

  It is deliberately a HOST switch with no request field behind it: a
  caller-settable debug flag would let any tenant reopen the disclosure on demand,
  which is the shape of the defect rather than a fix for it. It is also
  deliberately separate from the plugin's existing `debug` option, which stays
  server-side log verbosity only — raising log level on a live deployment must not
  widen what travels to a tenant.

  **Unaffected.** `POST /api/v1/analytics/sql` — the dedicated dry-run route that
  exists to hand back a statement — is not gated and behaves exactly as before; it
  is where an author debugging a widget should look. Rows, `fields`, `totals`,
  drill-through metadata, error envelopes and every gate on the query path are
  untouched, and no shipped consumer read the echo (the Studio console does not
  render it).

- 3abd233: fix(analytics): project a `timeDimensions` bucket into the result rows and fields (#4033)

  An analytics query that buckets by `timeDimensions` alone grouped correctly —
  the echoed SQL read `date_trunc('month', due_date) AS "due_date"` — but the row
  mapper and `buildFieldMeta` both enumerated `query.dimensions` only, so the
  bucket never reached the caller: rows carried just the measures and `fields`
  never mentioned the dimension. A trend chart got N values and no x-axis. The
  same query written with `dimensions: ['due_date']` was unaffected, which is why
  it went unnoticed.

  Grouping, row mapping and field metadata now derive the projected set from one
  `projectedDimensions()` helper — `dimensions` plus every _granular_
  `timeDimensions` entry not already among them. A `timeDimensions` entry without
  a granularity contributes only its `dateRange` predicate and stays out of the
  projection, so no phantom column is declared.

- 628b028: fix(service-analytics): thirteen caller-shaped analytics refusals answer 4xx from their own envelope instead of `500` (#5716)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  Thirteen refusal conditions in `service-analytics` (twelve `throw` sites — the
  cross-object measure and filter share one) used to reach the caller as
  `500 {"code":"ANALYTICS_QUERY_FAILED"}` on `POST /analytics/dataset/query`, and as
  `500 {"code":"INTERNAL_ERROR"}` on `POST /analytics/query`. They now answer **400** —
  `DATASET_INVALID` for the seven that are a verdict about the dataset or the whole
  selection, `INVALID_FIELD` for the six that name one member of the request:

  | refusal                                                          | now                     |
  | ---------------------------------------------------------------- | ----------------------- |
  | dataset JOIN crosses datasources (#5115)                         | `DATASET_INVALID` / 400 |
  | `include` names a relationship the object does not have          | `DATASET_INVALID` / 400 |
  | `include` path past the 3-hop limit                              | `DATASET_INVALID` / 400 |
  | a `dateRange` bound that is not a date                           | `DATASET_INVALID` / 400 |
  | `compareTo` names a timeDimension with no `dateRange`            | `DATASET_INVALID` / 400 |
  | `compareTo` with no dated window to shift                        | `DATASET_INVALID` / 400 |
  | `compareTo` ambiguous between two dated windows                  | `DATASET_INVALID` / 400 |
  | cube declares no such measure (#4157)                            | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object time-dimension bucket                     | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object measure                                   | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object filter                                    | `INVALID_FIELD` / 400   |
  | ObjectQL: multi-hop cross-object dimension                       | `INVALID_FIELD` / 400   |
  | ObjectQL: non-recombinable measure over a cross-object dimension | `INVALID_FIELD` / 400   |

  Monitoring that counted these as server errors will see a 5xx disappear and a 4xx
  appear, and a client retrying on 5xx will stop retrying a request that cannot
  succeed until the request or the dataset changes. **No refusal condition moved and
  no message was reworded** — the same inputs are refused, in the same words; only
  the envelope is new. (The messages are load-bearing beyond readability: #5923's
  tests assert the `planCrossObject` wording, and #5717 tracks one compiler message
  for colliding with a downstream sniffer.)

  ## What was wrong

  #5352 gave the dataset route a list of message SUBSTRINGS so six refusal families
  could answer 400, and #5367 retired five of those entries by giving their
  producers an ADR-0112 envelope. Both rounds worked from that list — and the list
  was only ever the refusals someone had already hit. Reading every `throw` in the
  package afterwards found thirteen more of exactly the same kind, which had never
  been on it: a typo in `compareTo`, a `dateRange` the dashboard sent, a dataset
  whose `include` names a relationship that does not exist. Each answered "the
  platform is broken" for a mistake the caller or the author could fix, on both
  analytics faces.

  **Both faces move, measured.** `/analytics/dataset/query` reads the envelope in
  its catch (#5352); `/analytics/query` exits through
  `dispatcher-plugin.errorResponseBase`, which already adopts a thrown `status` and
  carries the `code` (#3867/#3842) — so the cross-object refusals go from
  `500 INTERNAL_ERROR` to `400 INVALID_FIELD` there as well, without touching that
  route. The open question #5811 tracks on that face is about _withholding the
  message of a declared 5xx_, which none of these are.

  ## Why two codes

  `dataset-refusal.ts` gains a second constructor, `invalidMemberError`
  (`INVALID_FIELD` / 400 + `member`/`param`/`cube`), beside `datasetInvalidError`.
  The split is by what the refusal is a verdict ABOUT: the dataset/selection as a
  whole, or one member the request named. The member family is `INVALID_FIELD`
  because the three shipped analytics gates already answer exactly that for the
  NEIGHBOURING member-level mistakes on the same request keys — `measures` (#4437),
  `dimensions`/`timeDimensions` (#5520), `where` (#5669) — so one class of mistake
  keeps one wire shape; and because these six fire on `/analytics/query` too, where
  there is no dataset for `DATASET_INVALID` to be about. No new code is registered:
  both are already in the ADR-0112 vocabulary.

  ## What deliberately did NOT change

  `native-sql-strategy`'s "measure … has unrecognised type" stays a bare `Error`
  (an undeclared 500) although #5716 listed it as author-shaped. Measured:
  `Metric.type` is the closed `AggregationMetricType` enum, `metric-type-coverage.test.ts`
  pins that the strategy handles every member of it, the dataset compiler writes
  only `SUPPORTED_AGGREGATES` into a cube, and `inferMeasure` mints six known types
  — so no spec-valid cube can reach it. An arrival is our own drift or a host
  registering an unparsed cube, and blaming the caller would hide a platform fault
  from 5xx alerting. The two "Cube not found" guards and the two operator-drift
  throws stay bare for the same reason.

  Coverage: `unlisted-refusal-envelope.test.ts` (service-analytics) drives all
  thirteen refusals through the real producers — one block pinning that the refusal
  SET and its wording are unchanged, one pinning the envelope, one pinning the
  verdicts that stay 500; `analytics-dataset-unlisted-refusal-envelope.test.ts`
  (rest) drives eleven of them end-to-end through the route with a real
  `AnalyticsService`, plus three positive controls and the two sites that route
  cannot reach (with the measurement that explains why).

- b857356: fix(service-analytics): a `where` written as a `FilterArray` is lowered instead of silently dropped (#5334)

  **Observable behaviour change.** An analytics query whose `where` arrived as an
  ARRAY had its filter **deleted**: `normalizeAnalyticsFilterTree` answered every
  array with `return null`, so no predicate was compiled, no error was raised, and
  the widget charted the **entire dataset**. The compiled SQL stayed perfectly
  valid — just broader than the author asked for — which is why it was invisible
  to every test that asserts a SQL string. The issue's own measurement:
  `generateSql({cube:'deals', measures:['total'], dimensions:['id'], where:
[['stage','=','won']]})` emitted `SELECT id AS "id", COUNT(*) AS "total" FROM
"deal" GROUP BY id` with an empty `params`. It now emits the bound `WHERE` and
  returns the two won deals.

  `FilterArray` (`['stage','=','won']`, `['and', […], […]]`, `[[…], […]]`) is
  INPUT-ONLY authoring sugar (#5285), and #5158's ruling C says every door into
  the runtime lowers it through the single `parseFilterAST` sink before anything
  downstream sees a filter. #5329 closed ObjectQL's six entry points that way and
  deleted the four drivers' private array dialects. Analytics is the **fifth
  door**: it compiles `where` itself — to SQL (`NativeSQLStrategy`) or to a
  `FilterCondition` for the engine (`ObjectQLStrategy`) — so nothing upstream
  lowers for it. It now gives the same three answers the engine door gives:

  - `[]` — "no filter", not a failed filter: no predicate, no error (unchanged).
  - A well-formed `FilterArray` — **lowered** through `parseFilterAST`, so both
    spellings of one filter select the same rows on both strategies.
  - Any other non-empty array — **refused** with `INVALID_FILTER` / 400
    (ADR-0112), the envelope the drivers' `filterArrayReachedDriverError` uses.
    This is where the undeclared INFIX form (`[condA, 'or', condB]`) lands, and
    where a list of `FilterCondition` objects (`[{stage:'won'}]`) lands — neither
    is a `FilterArray`, `parseFilterAST` has no lowering for either, and dropping
    them is what returned the unfiltered dataset.

  Lowering rather than refusing keeps one dashboard's metadata meaning one thing:
  the same `where` on a plain `find()` already lowers at the engine door, so
  refusing it here would have forked the product by which face read the metadata.

- fce4c73: fix(service-analytics): an analytics `where` over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5669)

  `ensureCube` carried two source-field gates — `assertMeasureFields` (#4437,
  `param: 'measures'`) and `assertDimensionFields` (#5520,
  `param: 'dimensions' | 'timeDimensions'`) — and none for the filter face, the
  request key most likely to carry a hand-typed field name. A `where` naming a
  field the object does not have compiled straight into the statement and came
  back as a driver error with no envelope:

  ```
  POST /analytics/query {"cube":"crm_account","measures":["count"],"where":{"bogus_col":"x"}}
  → SELECT COUNT(*) AS "count" FROM "crm_account" WHERE bogus_col = $1
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437 / #5520
  POST /analytics/query {"cube":"crm_account","measures":["count"],"dimensions":["bogus_dim"]}
  → 400 {"code":"INVALID_FIELD","message":"Dimension 'bogus_dim' … "}
  ```

  A driver error class as the caller's `error.code` for a caller-shaped mistake is
  the ADR-0112 fault #4437 was filed about; the `/data` route has answered the same
  typo with a field-naming 400 since #4315/#4254.

  **The gate.** `ensureCube` now runs `assertWhereFields` after the other two on
  every path, so a filter whose source column the backing object does not have is
  refused **before** any SQL is built, with the same envelope its two siblings
  use: `INVALID_FIELD` / 400 plus `field` / `object` / `param: 'where'`, and a
  message naming the field, the valid filter members and the object's known field
  list. `query`, `generateSql` and `queryDataset` (both `runtimeFilter` and a
  dataset's own declared `filter`) are covered, and a rejected query leaves
  nothing behind in the cube registry. `/analytics/dataset/query` needed no
  change: #5352's envelope branch already carries a coded 4xx through, which the
  new REST-face test pins end to end.

  **Field names come from the SQL producer's own reader.** The members are
  collected through `normalizeAnalyticsFilterTree` + `collectFilterLeaves` — the
  same pair both strategies call to build the predicate — rather than by walking
  the raw `where` object. So `$and`/`$or`/`$not` nesting, `$`-prefixed operator
  keys, `$between` lowering, the `{owner: {region: 'NA'}}` → `owner.region`
  flattening and the #5334 array spelling are all read exactly as they will be
  compiled, in one place, instead of in a second walker that could drift from it.

  **What deliberately did not change:**

  - Filtering on a REAL field the cube never declared (`where: {phone: '555'}`)
    still works — the gate asks "does the _object_ have this field", never "did the
    cube declare it".
  - A filter member resolves through `cube.dimensions` **and** `cube.measures`,
    which is what the strategies do: a cube declaring
    `measures.revenue = {sql: 'annual_revenue'}` still answers
    `where: {revenue: {$gt: 100}}` as `annual_revenue > ?`.
  - A declared member is followed to its real column, so a dimension `assessed`
    over column `assessed_at` is not judged by its own name.
  - `id` / `created_at` / `updated_at` stay admitted unconditionally, matching the
    data path's `resolveQueryFields`.
  - An expression `sql` (on the cube or on a member), a dotted relation traversal,
    and a host that wires no field-name probe are all stood down on, exactly as the
    measure and dimension gates stand down.
  - The `INVALID_FILTER` family is untouched. A `where` the normalizer refuses
    outright — an unknown operator, a zero-operator field constraint, an
    unlowerable filter array — is _not_ judged here: the gate stands down and the
    refusal stays where it already happens (#5352 / #5367's geography). A field
    gate that cannot read the tree has nothing to say about it, and pulling those
    refusals forward would also have newly refused them on the draft-preview path,
    whose matcher never consults the normalizer.

- 1986594: feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

  Three presentation options were accepted by the metadata layer and then dropped
  by the analytics query builder. They reached no SQL, produced no error, and the
  only way to notice was to read the `sql` a dataset response echoes — so a
  dashboard could declare `dateGranularity: 'month'` and quietly render one bar
  per record.

  - **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
    `dateGranularity`, applied to every selected `date` dimension. Precedence per
    dimension: an explicit `timeDimensions` granularity, then the selection's,
    then the dataset dimension's own default. A widget can bucket a trend by month
    without the dataset committing every other consumer to that granularity.
  - **`order` / `limit` / `offset` now apply on every path.** They are applied to
    the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
    columns attach, and after derived measures are computed — so a derived measure
    is a valid sort key and the ObjectQL aggregate path (which has no ordering
    grammar, and which native SQL hands every date-bucketed query to) orders
    identically to native SQL. A single-query selection still pushes the window
    down into the statement. An `order` key that names nothing the selection
    projects is now rejected (400) rather than silently ignored.
  - **`limit` is deterministic.** Without an `order`, a limit orders by the
    selected dimensions first, so it truncates a reproducible window instead of an
    arbitrary subset.
  - **Widget `options` is a contract again.** The four query-affecting keys
    (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
    declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
    an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
    `striped`, …) pass through untouched.

  Two latent bugs surfaced while fixing the above and are fixed here too:

  - `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
    supplementary query selects one measure, so an inherited `ORDER BY` named a
    column it never selected, and an inherited `LIMIT` truncated it before the
    merge — dropping rows from the assembled grid. Nothing hit this only because
    nothing passed `order`.
  - The `compareTo` pass built its query by hand and skipped granularity
    resolution, so a month-bucketed primary grid was merged against raw-timestamp
    comparison rows. No dimension key matched and every `<measure>__compare`
    column came back empty.

  `ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
  `WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
  Previously the `sql` field simply vanished from the response whenever a query
  was date-bucketed, leaving an author unable to tell "not implemented" from "this
  strategy doesn't report".

- f6385c7: fix(service-analytics): a `timeDimensions` entry used only as a date WINDOW no longer buckets the grid (#5688)

  **Observable behaviour change — read this if you render, page, or assert on
  dataset responses.** A selection that used a date dimension only as a window —
  `timeDimensions: [{ dimension, dateRange }]` with no `granularity`, and the
  dimension NOT listed in `selection.dimensions` — used to have the dataset
  dimension's declared `dateGranularity` filled in anyway. That made the entry a
  `GROUP BY` item, so the response grew a time column nobody selected and every
  row split per bucket. "Count by Owner" plus a dashboard date-range filter came
  back as "by Owner × month":

  ```
  before  fields  [owner, close_date, opp_count]
          rows    [{owner:'u1', close_date:'2026-01', opp_count:1},
                   {owner:'u1', close_date:'2026-02', opp_count:1},
                   {owner:'u2', close_date:'2026-01', opp_count:1}]

  after   fields  [owner, opp_count]
          rows    [{owner:'u1', opp_count:2},
                   {owner:'u2', opp_count:1}]
  ```

  Both the **row count and the column set** change for such a selection: the extra
  month column disappears and rows that were split per bucket collapse back into
  one row per selected dimension tuple. A KPI single-value card that was reading
  the first of several month rows now reads the only row. Consumers that pinned
  the previous shape (a snapshot of `fields`, a row count, a hard-coded column
  index) need updating; consumers that render the response's own `fields` do not.

  Three conditions had to hold together to be affected, so a selection outside
  them is byte-identical: the dataset dimension declares an explicit
  `dateGranularity`, the `timeDimensions` entry states no `granularity`, and
  `selection.dateGranularity` is unset.

  **What still buckets, unchanged.** An entry is bucketed when the request says
  that date is being bucketed: the dimension is one of the selection's own
  `dimensions`, the entry carries its own `granularity` (#4033 — still projected
  as a column even when not selected), or `selection.dateGranularity` is set. The
  granularity _precedence_ chain is untouched. A dataset dimension's
  `dateGranularity` says how that date renders **when** grouped — it is no longer
  read as a request to group by it.

  **`compareTo` alignment (#3588/#4870) holds by construction.** The comparison
  pass re-enters the same query builder with the same grid dimensions, differing
  only in the shifted `dateRange`, so both passes bucket an entry alike or not at
  all — never one of each, which was the state that left every `__compare` column
  empty. For a window-only anchor this **repairs** the comparison rather than
  preserving it: the merge has always keyed on `selection.dimensions` alone, so
  the backfilled bucket column sat outside the merge key, and with several
  month-split rows per group the comparison value landed on whichever row the
  index held last while the others read a confident `0`.

  Also fixed, same root cause: a time column that IS projected via
  `timeDimensions` (an entry carrying its own `granularity`, never listed under
  `dimensions`) now carries its dataset `label` in `fields` instead of a bare
  `type` — the label enrichment walked `selection.dimensions` only.

- 344a22a: refactor(plugin-audit)!: retire `export` and `permission_change` from the `sys_audit_log` action enum — two declared actions nothing has ever written (#8147, #7675, ADR-0049/ADR-0087)

  <!-- adr-0087: registered audit-log-action-enum-retired -->

  **BREAKING** (shipped as `minor` under the launch-window lockstep convention).

  `sys_audit_log.action` declared ten actions. Two of them named events this
  platform does not record, and has never recorded. Enumerating every
  `sys_audit_log` writer in the repo finds exactly two:

  - `plugin-audit/src/audit-writers.ts` — the generic hook writer, whose
    `actionFor()` maps `afterInsert`/`afterUpdate`/`afterDelete` to
    `create`/`update`/`delete` and **nothing else**;
  - `plugin-auth/src/admin-import-users.ts` — the admin user-import run-level row.

  Neither has ever emitted `export` or `permission_change`. The cost was not a
  dormant string: `sys_audit_log` ships **list views** filtered on those values and
  the platform dashboard ships **metric widgets** counting them, so an operator got
  a permanently empty "Permission Changes" tile and an Auth view whose filter could
  never match, while an auditor reading the enum believed the platform captured
  permission changes and data exports. That is false compliance on a compliance
  surface — the sharpest form of ADR-0049 declared-≠-enforced.

  Maintainer ruling 2026-08-12 (#7675) split the finding in two: build the cheap
  writers (`login`/`logout` in #8144, `config_change` in #8145) and retire the enum
  values with no feature behind them. 原则记录:空 widget + 永远查不到东西的过滤器
  是可见产品缺陷;审计面宁窄勿谎。

  ### Migration: FROM → TO

  | Wrote                                                                | Write instead                                                                                                                                                                 |
  | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | a filter, saved query or dashboard on `action = 'permission_change'` | filter the permission objects' own `create` / `update` rows by `object_name` — a grant or binding write is an ordinary record write and the generic writer already ledgers it |
  | a filter, saved query or dashboard on `action = 'export'`            | delete it — no export feature ever wrote an audit row, so it returned nothing on every deployment                                                                             |
  | a `switch` / badge map with arms for either value                    | delete those arms; an exhaustive `switch` over the action type now fails to compile if they stay                                                                              |

  Every such query returned an empty result set before this change and returns the
  same empty result set after it. What changed is that the contract stops promising
  otherwise.

  ⚠️ **Existing rows are untouched and must stay untouched.** The enum is not
  enforced on this object — `validateRecord` skips `readonly` fields and every
  `sys_audit_log` field is `readonly: true` — so stored history parses and reads
  back exactly as written. Audit history is append-only; do not migrate or delete
  rows to satisfy a schema narrowing.

  ### Also in this change

  - `auth_events` list view: filter narrowed to `['login', 'logout']`.
  - `config_changes` list view: `export` dropped from the filter.
  - `plugin-audit`'s generated translation bundles regenerated for all four locales.
  - ADR-0087 registration as the semantic migration `audit-log-action-enum-retired`
    (D3 step 17). An enum-VALUE retirement, so nothing lands in
    `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are byte-identical by
    construction — no authorable key and no def changed.

  ### `import` is deliberately NOT retired

  The 2026-08-12 ruling named `import` alongside the other two on the stated
  premise 无此 feature. That premise is measurably false and the value stays:
  `plugin-auth`'s admin user-import writes a real run-level row on every run
  (`action: 'import'`, `record_id: null`), pinned by case W4 of
  `packages/qa/dogfood/test/admin-identity-audit-trail.dogfood.test.ts`. Retiring
  it would make the enum deny a value the platform writes — and silently, since
  the enum is unenforced here. Referred back for a maintainer ruling on #8147.

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 8e2bbba: fix(service-analytics): `compareTo` 在「日期维度本身就是网格维度」时把比较桶键平移回当期 (#6007)

  趋势图 + 同比是 `compareTo` 最常见的形状:日期维度既写进 `selection.dimensions`
  (它就是图表的时间轴),又被 `compareTo` 用作锚点。这个形状下比较趟从来没有对齐过。

  比较趟查询的是**平移后**的窗口,所以它的行按平移后的桶键落地;而
  `mergeByDimensions` 按 `selection.dimensions` 元组建键 —— `2025-01` 不等于
  `2026-01`,于是**没有一条**比较行合并得进去,全部作为新行追加。两趟各自只报告了自己
  那一半,`fillEmptyGroups` 把另一半填成自信的 `0`,再加上平移后的桶键坐在网格里,而它们
  落在调用方筛选窗口之外。一个 2 桶窗口的「今年 vs 去年同期」回来是这样的:

  ```
  [{"close_date":"2025-01","opp_count__compare":5,"opp_count":0},
   {"close_date":"2025-02","opp_count__compare":7,"opp_count":0},
   {"close_date":"2026-01","opp_count":1,"opp_count__compare":0},
   {"close_date":"2026-02","opp_count":2,"opp_count__compare":0}]
  ```

  四行、每行一个 0、两行在窗口外;期望是 2 行 × 2 列。

  **修法(维护者裁决 2026-08-07,方向 1):合并之前,把每个比较桶键用当期的说法重述一遍。**
  上例现在返回 `[{close_date:'2026-01',opp_count:1,opp_count__compare:5},
{close_date:'2026-02',opp_count:2,opp_count__compare:7}]`。

  - `previousYear` —— 窗口是按日历年平移的,所以逆运算就是按日历年往前推一年:对桶自己的
    首日做平移再重新分桶。`2025-01` → `2026-01`、`2025-Q1` → `2026-Q1`、
    `2025-W03` → `2026-W03`。它刻意是 `shiftRange` 那套年运算的精确逆运算(含
    `setUTCFullYear` 的溢出行为),窗口与桶键因此不可能对「一年」有两种理解。
  - `previousPeriod` —— 任意天数窗口没有日历对应物,所以按**桶序(bucket ordinal)**对齐:
    上一窗口的第 n 个桶对上本窗口的第 n 个桶,n 各自从自己窗口的起点数起。序号由**日历**算出
    而不是数组下标,所以本期网格里某个桶没有数据(存在空档)不会让其后每个桶都错位一格。

  **响应形状不变** —— 仍然是 `<measure>__compare` 列,行仍然是网格维度元组,所以消费端
  (objectui#3337 正在收敛的那条契约)不受影响。

  不确定时一律**保持原样**(即改动前的行为),而不是猜:空桶(两条聚合路径上键都是 `null`,
  两趟本来就互相合并)、未分桶的日期维度(分组的是原始时间戳,不是桶键)、以及平移回来落在
  当期窗口之外的桶(两个等长的天数窗口可以切出不同的桶数)。

  范围严格限定在坏掉的那个形状:锚点必须是**网格维度**(仅作窗口的锚点两趟都不是列,#5688
  之后本来就对齐)且必须**被分桶**。两趟通过同一个 `granularityOf` 读取桶大小,所以这里重述
  的桶大小按构造就是查询分组用的桶大小。

- 8dbd2a8: fix(service-analytics): dataset 响应的 `fields` 在「度量全部自带 filter」的路径上也描述维度列 (#5537)

  一个 dataset 查询,只要它的**基础度量全部带有自身的 `filter`**(或它选中的 derived
  度量的依赖全部如此),响应里的 `fields` 就只剩度量列,被选中的维度**完全没有描述符**。
  维度值一直都在 `rows` 里(它就是合并键),但读取列元数据的消费者拿不到维度列的
  `label` 与 `type`,只能退回去 humanize 原始行键。

  HotCRM「Sales Performance」上肉眼可见:同一个声明了 `label: 'Owner'` 的 `owner` 维度,
  "Open Pipeline by Owner"(度量无 filter)表头是 `Owner`,而 "Win / Loss by Rep"
  (`won_count`/`lost_count` 各带 filter、`win_rate` 是 ratio)表头是小写 `owner`。
  换成字符串维度 `lead_source` 看起来正常纯属巧合 —— humanize 后恰好等于真 label;
  两种维度的描述符其实都丢了。

  根因在网格装配处,不在渲染端:`DatasetExecutor.runMeasurePass` 只有在存在**无 filter**
  度量时才发那条主查询;当每个基础度量都自带 filter 时,它从 `{ rows: [], fields: [] }`
  起步,而随后每个补充子查询只追加一个**度量**描述符。现在这种情况下,维度描述符取自
  **第一个补充子查询自己的结果** —— 它 group by 的维度与整个网格完全一致 —— 因此两条路径
  的 `fields` 形状(维度在前、顺序、`type`)按构造收敛,而不是靠 executor 再抄一份
  「哪些维度被投影」的规则(该规则的单一事实源在各 strategy 的 `buildFieldMeta`,#4033)。

  `compareTo`、`totals` 与 derived 度量都经由同一条 pass,所以一并修好。

  已知的相邻缺口**不在**本次修复范围,单独立了 #5688:一个只带 `dateRange` 的
  `timeDimensions` 条目会被补上 dataset 的默认粒度,于是「窗口」变成第二层 GROUP BY,
  网格被按月拆分、并多出一个没人选过的时间列(该列在 `fields` 里也拿不到 `label`)。
  它在两条路径上表现一致(本次修复前后皆然),且修它会改变响应形状,故不搭车。

- ab54608: fix(service-analytics): a dataset `label` written as an inline locale map reaches the wire resolved, instead of being dropped (#6761)

  `I18nLabelSchema` has authorized two forms of a display label since #5728: a
  plain string, and an inline locale map `{ en: 'Owner', 'zh-CN': '负责人' }`. The
  analytics producer only understood the first one, so a dataset written the way
  the schema documents came back with **no label at all**:

  | dataset declares                            | `fields[]` carried, before |
  | ------------------------------------------- | -------------------------- |
  | `label: 'Owner'`                            | `label: 'Owner'`           |
  | `label: { en: 'Owner', 'zh-CN': '负责人' }` | _(no `label` key)_         |
  | _(no label)_                                | _(no `label` key)_         |

  Measured identically on both strategies. All three renderers that read
  `fields[].label` first — `DatasetWidget`, `DatasetPreview`,
  `DatasetReportRenderer` — then fell back to humanizing the raw key, so a Chinese
  deployment authoring exactly what the spec documents got English-ish machine
  names for its column headers.

  One layer earlier, `dataset-compiler` substituted the machine **name** for the
  same map (`typeof d.label === 'string' ? d.label : d.name`), which additionally
  made `/analytics/meta` publish `title: 'owner'` as a _display title_ — a face
  that lied rather than one that was merely bare.

  Both are fixed by calling the shared `I18nLabel → string` resolver
  (`resolveI18nLabel`, `@objectstack/spec`, #6765), which is pinned in its own
  package to rule parity with objectui's `pickLocalized`. Nothing is
  re-implemented here: the maintainer's ruling on #6761 chose one shared resolver
  precisely so the two ends cannot answer the same authored map differently.

  **The wire is unchanged.** `AnalyticsResult.fields[].label` is still
  `string | undefined` on both ends — this resolves _to_ a string rather than
  widening the contract, so no consumer changes and no map can reach a renderer
  that would print `[object Object]`.

  **Which locale each site uses:**

  - `queryDataset`'s two field-enrichment sites resolve at
    `ExecutionContext.locale` — the per-request BCP-47 tag derived from the
    caller's `Accept-Language`, falling back to the workspace `localization`
    setting. Both sites read one hoisted value, so a single response cannot mix
    two audiences.
  - `dataset-compiler` resolves with **no** locale, i.e. the resolver's documented
    nullish answer `en`. A compiled Cube is a registry artifact shared by every
    later reader, and `getMeta()` — the `/analytics/meta` face — takes no
    execution context at all; baking a request locale there would make
    `/analytics/meta` answer whoever queried last.

  **Nothing is invented on a miss.** A label the resolver cannot resolve (an
  absent label, or an empty map) writes no `label` key on the wire at all — a
  placeholder would permanently pre-empt the real label under the downstream
  `if (field.label == null)` guard. In the compiler, where `Metric.label` /
  `Dimension.label` are required strings, the machine-name fallback is unchanged
  from before; it never reaches `fields[]`, so it cannot pre-empt anything either.

- c8124e5: fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

  Any window filter on a `Field.datetime` column returned an empty set on SQLite —
  a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
  rows existed.

  There was never a storage _convention_, only a description of what better-sqlite3
  happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
  deliberately left `datetime` untouched — so the form was decided by whichever
  writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
  write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
  platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
  held both forms while the read path coerced comparands to epoch ms purely from
  the _declared_ type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
  window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
  regardless of the bound.

  `Field.datetime` now has one canonical instant per dialect, produced by one
  function applied on write **and** to every filter comparand, so the two sides of
  a comparison cannot disagree about shape:

  - **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order _is_
    chronological order, so range filters and `ORDER BY` read the column directly
    and can use an index; `strftime` parses it, so the date-bucket expression needs
    no CASE.
  - **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
    comparand side: a zone-naive write was previously resolved against the
    _server's_ timezone (measured 8 hours off on `Asia/Shanghai`), and an
    un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
    identical query over the identical instant landed a row on a different calendar
    day than SQLite did.
  - **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
    both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
    same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
    in a datetime literal, so datetime writes over REST had always failed outright;
    `TIMESTAMP` additionally truncated milliseconds and could not store an instant
    outside 1970..2038.

  Existing rows converge at schema sync. Both migrations are allowed to fail: they
  log, mark nothing, and the read paths keep a repair expression, so an un-migrated
  column still compares and buckets **correctly** — just unindexed. Neither can
  repair instants the old timezone-ambiguous write path recorded wrongly; they
  preserve what is on disk.

  Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
  construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

  The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
  existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
  column side too. Absent hook → byte-identical SQL.

- 6fde910: fix(objectql,service-analytics): report the datasource an object is actually on, not the one it declares (#5288)

  Analytics' `getObjectDatasource` probe read `getObject(name).datasource` — the
  object's **declared** value, which is step 1 of the five `ObjectQL.getDriver`
  resolves by. `ObjectSchema.datasource` carries `.default('default')`, and
  `'default'` means "no explicit binding, keep looking" inside the engine, so
  every object placed by a `datasourceMapping` rule, by the ADR-0057 §3.6
  lifecycle split, or by its package's `defaultDatasource` answered `'default'`
  and was read out here as "the primary DB".

  `sys_audit_log` is the live specimen: `lifecycle.class: 'audit'` puts it on the
  `telemetry` datasource with nothing declared to read. So #5033's query-time
  diagnostic — whose entire job is to NAME the database a table is missing from —
  named the wrong one:

  ```
  before: table "account" is not on datasource "default",   which is where its base object "sys_audit_log" lives
  after:  table "account" is not on datasource "telemetry", which is where its base object "sys_audit_log" lives
  ```

  **New engine accessor — `ObjectQL.resolveEffectiveDatasource(objectName)`.** The
  public, name-only face of the resolution order `getDriver` already routes by,
  extracted so the order exists exactly once (the same argument that produced
  `resolveMappedDatasource` in #4462: a second, shorter copy of a routing order
  drifts by one step, silently). `getDriver` now consumes the same resolver and
  keeps every existing behaviour — precedence, the refusal to fall through to the
  default store when a declared or mapped datasource has no live driver, and both
  of its diagnostics.

  It answers `undefined` when nothing binds the object anywhere and it simply
  rides the deployment's default driver. That is deliberate and unchanged from
  what consumers already documented: the default driver keeps its natural name
  (#3826), so that name identifies a driver rather than a datasource anyone bound
  the object to. `getDefaultDriverName()` is still there for callers that want it.

  Analytics' probe now asks the engine instead of the declaration; the routing
  rules are **not** re-implemented on the analytics side. #5115's compile-time
  cross-datasource join gate keeps its predicate exactly as written — what changed
  is that its input can now answer for objects bound by a mapping rule, by the
  lifecycle split, or by a package default, so a join between two bound
  datasources is refused at registration instead of exploding at query time. A
  join from a bound object to one that merely rides the deployment default is
  still not decidable at compile time and remains the query-time diagnostic's
  business.

- a227ed7: fix(objectql)!: one key for the empty group bucket — real `null`, on both aggregation paths (#3839)

  A grouped row whose dimension value is empty now carries `null` for that
  dimension no matter which way the aggregate ran. Downstream code can test the
  empty bucket with a plain `value == null` again: charts render their own empty
  label, drill-through on that bucket builds `field = null` and returns the rows
  it should, and a dashboard no longer changes shape when the driver, the
  granularity or the reference timezone changes.

  ### What was wrong

  `engine.aggregate` has two implementations of one feature. It pushes the
  aggregate down as SQL when the driver advertises every requested granularity and
  the reference timezone is UTC; otherwise it fetches rows and buckets them in JS.
  The two disagreed about how to spell "empty":

  ```
  --- same dataset, same query, one row with a NULL value ---
    pushed-down SQL : [{ "key": null,     "type": "null",   "total": 2 }, …]
    in-memory       : [{ "key": "(null)", "type": "string", "total": 2 }, …]
  ```

  The measures were always right — only the key's type and literal differed —
  which is why this went unnoticed for so long: every total reconciled. But the
  engine picks a path per query, so the same data produced a different bucket key
  on SQLite-plus-UTC-plus-`month` than on `week` (which SQLite does not advertise),
  a non-UTC timezone, or `driver-rest` / `driver-memory` / a remote Turso, all of
  which bucket in memory unconditionally.

  It was never date-specific either. A plain `groupBy: ['stage']` over a NULL
  column diverged the same way.

  Consumers are written against `null` — they check `== null` and supply their own
  empty label ('—', '(empty)', a localized "Uncategorized"). The sentinel defeated
  every one of them: it rendered a raw English debug string in the UI, and a drill
  on the empty bucket compiled to `field = '(null)'` and matched nothing.

  The in-memory path's comment justified the string as staying "consistent with
  the client `useReportData` hook". That hook was removed with ADR-0021, and the
  literal never appeared in it.

  ### What changed

  - `applyInMemoryAggregation` and `bucketDateValue` (`@objectstack/objectql`) key
    the empty bucket as `null`. `bucketDateValue` now returns `string | null`. A
    null instant and an unparseable one still share one bucket, because SQL cannot
    tell them apart either (`strftime('%Y-%m', 'not-a-date')` is NULL).
  - The internal composite bucket id is JSON-encoded, so the empty bucket stays
    distinct from a row whose value is the literal string `"null"`.
  - `bucketKeyToCalendarRange` (`@objectstack/core`) accepts `string | null`. The
    empty bucket has no calendar span, so a drill on it opens the unscoped
    superset instead of an invented bound — unchanged behavior, honest signature.
  - The driver output contract in `@objectstack/spec` now states the rule: a row
    with no value keys as `null`, never a sentinel. Propagating NULL through the
    bucket expression is the whole of it; a driver only breaks it by adding a
    `COALESCE`.

  ### Gates

  `checkDateBucketParity` (`@objectstack/verify`) deliberately carried no null
  instant, because the divergence would have failed it for a reason it was not
  about. Its fixture now has one, so the convergence is held in place — including
  for out-of-tree drivers that run the check against themselves.

  Two fixes were needed to make that fixture meaningful:

  - The check folded bucket labels through `String(value)`, which turns SQL NULL
    into `'null'` — a label a TEXT column can genuinely hold. A driver spelling
    "empty" as a string could compare equal to one returning real NULL. The empty
    bucket is now keyed out of band.
  - Label sets were compared with `JSON.stringify`, which is sensitive to key
    insertion order. Row order is not part of this contract and the two paths
    naturally differ (SQL sorts its groups; the in-memory path emits first-seen
    order), so a driver with entirely correct buckets could be reported as
    disagreeing — with an empty diff message, since nothing actually differed.
    The comparison is now order-insensitive.

  A new dogfood check covers the non-date half against real drivers: same dataset,
  plain and date-bucketed `groupBy`, both paths, one key.

- 1a19e9d: fix(service-analytics): fence `$icontains` comparands on the analytics `where` door (#7693)

  `$icontains` was the one text-pattern operator the #5234 comparand fence never
  covered on the analytics `where` door. It arrived after the fence: #6520 added
  it to `filter-normalizer.ts`'s `MONGO_TO_CUBE_OP` and gave `read-scope-sql.ts`'s
  arm its `assertRenderableText` call, but not the entry in `comparand-shape.ts`'s
  `TEXT_PATTERN_OPERATORS` — the set the `where` door's shape gate reads. So one
  operator had **two answers inside one package**. Measured on `origin/main` @
  `b54aaab`:

  | filter                           | analytics `where` door                                         | `read-scope-sql`                            |
  | -------------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
  | `{name: {$contains: {foo: 1}}}`  | REFUSED (`INVALID_FILTER` / 400)                               | REFUSED (`READ_SCOPE_COMPILE_FAILED` / 500) |
  | `{name: {$icontains: {foo: 1}}}` | **compiled** — `NativeSQLStrategy` bound `'%[object Object]%'` | REFUSED                                     |

  The compiled statement was the #5234 defect verbatim: a parameterised,
  syntactically perfect `LIKE` pattern nobody wrote, which a row whose text really
  is `[object Object]` matches. `driver-sql`'s own `TEXT_PATTERN_OPERATORS` has
  listed the operator since #6520, and #7158 closed the same gap at objectql
  `having`; this closes the third and last face.

  **What changes for a caller.** A malformed `$icontains` comparand — an object, a
  `{$field}` reference, or an array — on the `/analytics` `where` door is now
  refused with `INVALID_FILTER` / 400 and the same sentence `$contains` gets,
  instead of compiling into a pattern that matches the wrong rows. A well-formed
  comparand is untouched: strings, numbers, `null`, booleans and `Date`s compile
  exactly as before, ASCII fold and metacharacter escaping included. The
  read-scope door is unchanged — it already refused these shapes.

  Held by `__tests__/cross-field-reference-refusal.test.ts`, where #7598's
  RECORDED GAP pin is flipped to assert the refusal and the shared `#5222` corpus
  is now driven whole (its `$icontains` case no longer has to be filtered out),
  and by the fifth member added to the LIKE-family loops in
  `__tests__/comparand-shape-refusal.test.ts`. Reverse-verified against the whole
  package: deleting the entry turns exactly those five `where`-door cells red and
  leaves every read-scope and narrowness control green.

- 88a6bed: fix(service-analytics): an ad-hoc cube's dimensions no longer depend on how the `where` was spelled (#5353)

  `inferCubeFromQuery` mints a Cube for a free-form analytics query that names no
  registered cube, seeding `dimensions` from the fields the query mentions — its
  `measures`, `dimensions`, `timeDimensions`, and its `where`. The `where` arm was
  guarded by `!Array.isArray(query.where)`, written when an array `where` was not a
  filter. #5334 made it one, so from then on one filter minted two different cubes
  depending on its spelling:

  ```
  where: {stage: 'won'}          → dimensions: {stage}   ← seeded
  where: [['stage','=','won']]   → dimensions: {}        ← skipped
  ```

  The `where` is now LOWERED to its canonical `FilterCondition` before its keys are
  read, so the spelling stops mattering. The lowering is the same one the
  strategies already use (#5334's `parseFilterAST` call, extracted from
  `normalizeAnalyticsFilterTree` as `lowerAnalyticsWhere` so there is still exactly
  one of it), and the keys are read through `conjunctFieldKeys`, which descends
  `$and` — necessarily, because the lowering itself introduces `$and` where the
  object spelling has none: `[[a,…],[b,…]]` lowers to `{$and: [{a…},{b…}]}`. As a
  result an explicit `{$and: […]}` object `where` now also seeds its conjuncts'
  keys, which it never did.

  `$or` / `$not` are not descended, and contribute no key on either spelling, as
  before.

  **No compiled statement, bound value or gate verdict changes.** Both spellings
  already compiled a byte-identical predicate (which is why this shipped as an
  observation rather than a defect): `resolveFieldSql` falls back to the bare
  column name for an undeclared member, and `qualifyAndRegisterJoin` leaves bare
  columns bare on a cube with no `joins` — which an inferred cube never has. So the
  newly-declared dimensions move those members from the undeclared branch to the
  declared one and both yield the same column. What does change is the suggestion
  list in a rejection: `Valid filter members:` / `Valid dimensions:` now read the
  same for both spellings of one filter, and `getMeta` reports the same dimension
  vocabulary for both.

  **Still spelling-dependent: a DOTTED `where` key.** `{'owner.region': 'NA'}`
  seeds the stripped tail `region` as a base-table dimension; the array spelling
  `[['owner.region','=','NA']]` seeds nothing and compiles the relation traversal.
  Unifying them is #5739's call, not this change's — propagating the mint to the
  array spelling turns a working traversal into a base-column filter over different
  rows (and a `400 INVALID_FIELD` where the base table has no such column), while
  withdrawing it from the object spelling would split a verdict #5740 deliberately
  shares with the `dimensions` request key. Dotted keys therefore keep today's
  per-spelling answer, pinned by tests, until #5739 rules.

- a6b3ee7: fix(service-analytics): 即席推断的 Cube 把 `owner.region` 当成关系穿越,不再铸成基表列 `region` (#5739)

  `inferCubeFromQuery` 为「没有注册 Cube 的自由查询」即席合成一个 Cube,并从查询提
  到的字段里播种 `dimensions`。每个铸造点都先把成员过一遍 `stripPrefix` —— 一个把
  **任何**点号名的首段剥掉的判定。对 `<cube>.` 限定符(`crm_account.industry` →
  `industry`)这是对的;对**关系穿越**则不是:`owner.region` 被铸成
  `dimensions.region = { sql: 'region' }`,一个**基表列**。下游 `lookupMember` 的
  「plain second-segment」那一档随即命中它,**赶在**「synthetic relation traversal」
  那一档把点号路径交给 JOIN 机制之前就返回了 —— 关系穿越被基表列遮蔽。

  危害分两档,而更糟的是安静的那一档。当基表**恰好有同名列**时(`crm_account` 自己
  就有 `region`),四个组合全部静默通过、无任何拒收:

  ```
  ① ObjectQL,  where: {'owner.region':'NA'} → executeAggregate 收到 {"region":"NA"}
  ② NativeSQL, where: {'owner.region':'NA'} → … FROM "crm_account" WHERE region = $1
  ③ ObjectQL,  dimensions: ['owner.region'] → groupBy: ["region"]
  ④ NativeSQL, dimensions: ['owner.region'] → SELECT region AS "owner.region" … GROUP BY region
  ```

  行数与图表都是错的,而没有任何错误可读 —— ④ 尤甚:响应列名标着 `owner.region`,值
  却来自基表,读者无法从结果里看出来。基表**没有**同名列时则落到 `400 INVALID_FIELD`
  且点名 `region`,而调用方写的是 `owner.region`。

  维护者 2026-08-06 裁定(issue #5739):即席路径**支持**关系穿越。铸造改为**原样**
  (`dimensions['owner.region'] = { sql: 'owner.region' }`),真正的 `<cube>.` 限定
  前缀(首段 == cube 名)仍然剥。这同时收敛了一处早有的分叉:同一个过滤器写成数组
  (`[['owner.region','=','NA']]`)时铸不出 dimension,于是一直走 synthetic 档、一直
  编出正确的 JOIN —— 两种写法现在逐字生成同一条语句。

  **Observable behaviour change —— 若你按状态码告警/重试,或消费即席 cube 的元数据,
  请读这一段。**

  - **对象写法的点号 member 从「静默错列」/「`INVALID_FIELD` 指错名」变为 JOIN 穿越。**
    NativeSQL 上 `where: {'owner.region': 'NA'}` 与
    `dimensions: ['owner.region']` 现在编出
    `LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"` 并按 `"owner"."region"`
    筛选/分组;此前它们筛/分组的是基表 `region`(有同名列时),或以
    `400 INVALID_FIELD "constrains field 'region'"` 被拒(无同名列时)。**同一个请求
    现在返回的行可能与此前不同 —— 此前那些行是错的。**
  - **ObjectQL 上同一个 member 改为响亮拒收或正确穿越,不再有第三种更安静的答案。**
    `where` 得到 `cannot evaluate a cross-object filter ("owner.region")` —— 与**已
    注册 cube** 上的既有答案逐字一致;`dimensions` 走 FK-expand 正确穿越,返回关联对象
    的值。带 `granularity` 的跨对象 `timeDimensions` 得到
    `cannot bucket a cross-object time dimension`。
  - **即席 cube 的 `dimensions` 词汇表里现在出现点号键**(`getMeta` 上是
    `crm_account.owner.region`)。此前该穿越要么以剥掉的尾段出现(`crm_account.region`),
    要么(数组写法)完全不出现。
  - **不变的部分**:真正的 `<cube>.` 限定符照旧剥除;裸列名照旧是基表列(基表自己的
    `region` 仍可作为 `region` 分组);#4437 / #5520 / #5669 三道源字段闸门的代码一行未
    动,它们对裸名拼错的 `400 INVALID_FIELD` 拒收原样保留;点号 **measure**(如
    `total.sum`)仍按 #4437 的 `400 INVALID_FIELD` 拒收 —— `lookupMember` 的 synthetic
    穿越档是 dimension-only,dotted measure 没有可收敛的穿越答案。

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- 49f208b: fix(analytics): an `undefined` comparand in an analytics `where` is refused (400 `INVALID_FILTER`), not read seven different ways

  **Observable behaviour change.** A `where` key whose value is `undefined` used to
  compile — in seven different ways, depending on where it sat. It is now refused
  with `INVALID_FILTER` / 400, the envelope every other refusal at this door
  already carries.

  The three that mattered WIDENED the query, which is the failure mode
  `filter-normalizer.ts` forbids in its own body ("NEVER drop: a missing predicate
  does not narrow the query, it WIDENS it"), while its entry line did exactly that:

  | `where`                        | used to normalize to             | reading                                                  |
  | ------------------------------ | -------------------------------- | -------------------------------------------------------- |
  | `{d: undefined}`               | `null`                           | the WHOLE filter dropped — the query ran **unfiltered**  |
  | `{stage: 'won', d: undefined}` | `stage equals 'won'`             | the `d` conjunct vanished in silence                     |
  | `{$not: {d: undefined}}`       | `NOT (d set)`                    | `d IS NULL` — a predicate the author never wrote         |
  | `{d: {$eq: undefined}}`        | `d equals [null]`                | a value comparison, **not** `$eq: null`'s null predicate |
  | `{d: {$gt: undefined}}`        | `d gt [null]`                    | ditto                                                    |
  | `{d: {$in: [undefined]}}`      | `d in [null]`                    | ditto                                                    |
  | `{d: {$ne: undefined}}`        | `d notSet OR d notEquals [null]` | ditto                                                    |

  The direction is silently **wrong results** — an analytics figure, a report
  total, an aggregate, wrong with nothing to read — **not** a permission bypass:
  read scope is compiled by a different door (`read-scope-sql.ts`) and never passed
  through here, so a caller still saw only rows it was entitled to, just more of
  them than it asked for.

  **What to change if this refuses your filter.** `undefined` cannot cross JSON, so
  neither REST door can carry it — this only reaches in-process callers of
  `AnalyticsService.query({ where })` that spread a possibly-absent value into the
  filter object (`{ owner_id: ctx.user?.id }`). Two repairs, both stated by the
  error message:

  - meant the null predicate → write `{ field: null }` or `{ field: { $null: true } }`;
  - the value is genuinely absent → **omit the key**, which is the same "no
    constraint" without the ambiguity.

  Inside stored metadata, the platform's own answer to "scope this to the current
  user" is unaffected and was already fail-closed: a `{current_user_id}`
  placeholder resolves through `resolveFilterTokens`, which raises
  `FILTER_TOKEN_UNRESOLVED` / 400 rather than emitting `undefined`.

  ⛔ **`null` does not move.** `{d: null}`, `{$eq: null}`, `{$ne: null}`,
  `{$null: …}`, `{$exists: …}` and `$contains: null` keep their exact lowering —
  `null` is a declared comparand and is the null predicate. `$null` / `$exists`
  carry a declared boolean flag rather than a comparand and are likewise untouched.

- ff39e63: fix(service-analytics): 维度合并键不再把「未分配」并进「空白」,并改为长度前缀消歧 (#4821)

  `mergeByDimensions` 是每一份多查询 dataset 结果的装配缝:主查询与每个带 `filter`
  的 measure 的补充子查询在这里对齐,`compareTo` 窗口自 #4870 起也按 measure 扇出后
  经由同一个缝合并回来。这里一次键碰撞不会报错 —— 一个分组静默吸走另一个分组的数字,
  网格仍然保持看起来合理的行数和列数。

  **#4821 报告的机制与实际的缺陷不完全一致,先把这一点说清楚。** 原键是
  `String(row[d] ?? '')` 以一个**直接写进源码的裸 U+0001 字节**相连。裸控制字符渲染
  为空,所以 issue 正文读到的是 `join('')`,其头号复现(`['ab','c']` 与 `['a','bc']`
  同键为 `"abc"`)其实并不成立 —— 分隔符一直在,只是看不见。真正咬人的是另外两条:

  - `?? ''` 让**真正为 null** 的维度与**空字符串**维度键成同一个值。于是「未分配」被
    并进「空白」:一行吞掉另一行的 measure,另一行的列则整个缺失 —— 而 #4708 的空组
    填充随后会给它填上一个理直气壮的 `0`。一个真实计数为 3 的分组因此显示为 0。
  - 单字符分隔符只在「没有任何维度**值**包含该字符」时才无歧义。维度值是用户数据
    (文本字段、导入记录),所以那是一个假设而非保证,且一旦不成立同样静默。

  **改法:长度前缀 + 显式空值哨兵。** 每段编码为 `<长度>:<值>`,`2:ab1:c` 与
  `1:a2:bc` 对任意输入都不同,不再保留任何字符、也不再有看不见的字节留给下一个读者
  误读(本 issue 正是这样被误读出来的)。null/undefined 单独走一个哨兵段,与消歧这件
  事解耦。

  **逐段的 `String()` 强制被刻意保留**,这与一文件之隔的 `cross-object-rebucket.ts`
  的 JSON 键不是同一笔交易:后者重新分桶的是**同一个查询**的行,一列只有一种类型,
  JSON 在那里免费且能换来真实的区分(空桶 `null` vs 字面量字符串 `"null"`)。本函数
  做的是相反的事 —— 跨**不同查询**对齐行,而驱动确实会对同一个分组返回不同的 JS 类型
  (本文件 `compareValues` 的注释即记着 "numeric strings, which is how some drivers
  return SUM results")。改用 `JSON.stringify` 会把 `1` 与 `"1"` 渲染成两个键,让今天
  能正确合并的行不再合并 —— 用一个新的静默缺陷换掉旧的,不算修好。该行为已有回归钉
  测试锁住。

  仅影响内部合并键,响应中的任何值都不改变。

- 2604d34: fix(analytics): a field constraint mixing `$` operators with non-`$` sibling keys is refused (400 `INVALID_FILTER`), not silently narrowed to its operators

  **Observable behaviour change.** A `where` field wrapper that carries `$`-operator
  keys and non-`$` keys at once used to compile its operators and silently DROP
  every non-`$` sibling. It is now refused with `INVALID_FILTER` / 400, the
  envelope every other refusal at this door already carries. Ruled Option A
  (refuse) on #6444, 2026-08-08; Option B (flattening the siblings as nested
  paths) was rejected because it would compile the likely-real cause — a dropped
  `$` — into a predicate on a non-existent member such as `amount.gte`.

  | `where`                                   | used to normalize to      | reading                                             |
  | ----------------------------------------- | ------------------------- | --------------------------------------------------- |
  | `{d: {$eq: 1, nested: 'x'}}`              | `d equals [1]`            | the `nested` conjunct vanished in silence           |
  | `{amount: {gte: 10, $lte: 20}}`           | `amount lte 20`           | the missing-`$` typo: the lower bound silently gone |
  | `{$not: {d: {$null: true, nested: 'x'}}}` | `NOT(d set AND d notSet)` | a contradiction that negates to TRUE — every row    |

  Every row WIDENED the query — a dropped conjunct returns rows the author
  excluded, with nothing to read (the #3650 family this module refuses everywhere
  else). Unlike #6386's `undefined` comparand, this shape survives JSON, so it can
  sit in stored dashboard / report / dataset metadata as well as in-process
  callers of `AnalyticsService.query({ where })`.

  **What to change if this refuses your filter.** The message names the offending
  key(s) and both repairs, because the shape has two readings this door cannot
  tell apart:

  - an operator missing its `$` was meant → spell it with the prefix
    (`gte` → `$gte`: `{ "amount": { "$gte": 10, "$lte": 20 } }`);
  - a nested-relation member was meant → give it a wrapper of its own with no `$`
    siblings (`{ "d": { "nested": "x" } }` compiles to the member `d.nested`) and
    AND it with the operator constraint explicitly via `$and`.

  ⛔ **The two pure shapes do not move.** A wrapper that is all `$`-operators
  compiles exactly as before (`{amount: {$gte: 10, $lte: 20}}` stays the AND of
  its bounds), and a wrapper that is all non-`$` keys keeps flattening to the
  dotted member (`{d: {nested: 'x'}}` → `d.nested`). `$null` / `$exists` flag
  semantics, the `null` comparand rulings (#5332 / #5526) and the sibling door
  `read-scope-sql.ts` — which has always failed closed on this shape — are
  untouched.

- adabaa8: fix(analytics): fail closed on cross-object aggregation the ObjectQL path cannot join (#3654)

  `engine.aggregate()` has no join — it never expands a lookup and the SQL driver's
  aggregate emits no `JOIN`. So a dotted dimension/measure like `account.region`
  reaching `ObjectQLStrategy` (the fallback NativeSQL declines: date-granularity
  bucketing, in-memory driver, federated objects) failed SILENTLY: the in-memory
  path bucketed every row under one `(null)` group and summed the whole table into
  it (a plausible number that is actually a mislabelled full-table total), and the
  native path errored on the unresolved column.

  `ObjectQLStrategy` now rejects any cross-object reference outright, with a clear
  message, before the query reaches the engine. This generalizes the #3597 guard
  (which only rejected when the joined object carried a read scope, and skipped the
  check entirely when no read-scope provider was configured — so the silent
  `(null)` bucket still shipped on unsecured/in-memory setups) into an
  unconditional one, and subsumes it: a rejected query never loads the joined
  object, so there is nothing left unscoped.

  Cross-object datasets are unaffected on `NativeSQLStrategy`, which hand-compiles
  the LEFT JOINs (and scopes each). This only changes the fallback path, turning a
  silent wrong answer into a loud, actionable error. Full lookup-traversal support
  in the aggregate path is left as follow-up (see #3654).

- 605c23f: fix(analytics): ObjectQLStrategy applies `timeDimensions[].dateRange` — the predicate every date-bucketed chart was missing (#3650)

  `ObjectQLStrategy.execute()` built its engine filter purely from
  `normalizeAnalyticsFilters(query)`, which reads only `query.where`. But
  `dateRange` is a **sibling** of `where`, never folded into it — so the window
  was dropped on the floor. No error, no warning: the chart rendered, and the
  numbers were for all of history.

  This was not a "some drivers only" corner. `NativeSQLStrategy.canHandle`
  declines any query carrying a `granularity`, so a **date-bucketed trend lands on
  the ObjectQL path on every driver**, Postgres and SQLite included — and a
  bucketed trend is precisely the shape that also carries a range ("last 12
  months", "this quarter"). The other two paths always applied it
  (`NativeSQLStrategy` as `BETWEEN`, `preview-evaluator` row-wise); only this one
  did not.

  **Two visible symptoms:**

  - A trend chart with a time filter plotted **every row ever recorded** instead
    of the selected window.
  - `compareTo` (period-over-period) was **structurally dead**. `runCompare`
    builds the comparison pass by shifting `dateRange` and changing nothing else,
    so with the window ignored both passes issued a byte-identical aggregate:
    every `<measure>__compare` column equalled its primary and the delta was a
    flat 0%. And since `compareTo` requires a time dimension, it always took this
    path.

  The window now lowers to an inclusive `{$gte, $lte}` on the resolved field — the
  same shape `NativeSQLStrategy` binds as `BETWEEN` and the memory driver builds
  as a `$match` — so one dashboard reads the same on every driver. No storage
  coercion is applied here on purpose: unlike the raw-SQL path (which had to learn
  about SQLite's INTEGER epoch in #2034), this path goes through
  `engine.aggregate()`, where the driver's own CRUD filter coercion already
  handles a `where` bound on that same column.

  **Same-field composition was fixed alongside it**, because the window makes it
  routine. Operands merged into one field entry by spreading, which silently kept
  whichever came last: a `where` bound and a window bound on `close_date` would
  have had one erase the other, and a `where` that names one field twice through
  `$and` (`{$and: [{stage: 'won'}, {stage: {$ne: 'lost'}}]}`) already lost its
  first operand today. Operands that name **different** operators still share one
  entry; colliding ones become their own `$and` conjunct, so the engine
  intersects them instead of the strategy picking a winner.

  `generateSql()` renders the window as a parameterised `BETWEEN` to match — its
  comment previously explained why a `BETWEEN` was deliberately absent, which was
  correct only while `execute()` dropped the window. Bounds bind as `$n`
  placeholders, never inlined: the echoed statement travels to the browser.

  A window on a **cross-object** time dimension is still rejected, and is now
  reported as the bucketing error it is rather than as the "cross-object filter"
  its lowered predicate would otherwise resemble. `execute()` and
  `/analytics/sql` continue to accept and reject the same set.

  Relative-phrase ranges ("Last 7 days") are still not resolved on this path, and
  a bare-string `dateRange` degenerates to a single point — both matching
  `NativeSQLStrategy` exactly, rather than inventing a second interpretation for
  the driver-independent path.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- 3cc8676: fix(analytics): read scope 里非布尔的 `$null` / `$exists` 比较数改为拒收，不再按真值性编成相反的谓词 (#6387)

  **⚠️ 行为变更。** `compileScopedFilterToSql` 遇到 `$null` / `$exists` 上的非布尔比较数，从「按 JS 真值性归入两个声明答案之一、静默编出合法 SQL」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。今天靠这个静默翻转在跑的 read scope，从此会响亮地失败。

  ## 实测到的毛病

  发射器读的是 `val ? … : …` —— **真值性**，不是 `@objectstack/spec` `FieldOperatorsSchema` 声明的 `z.boolean()`。在 `5faa23ca3` 上直接调 `compileScopedFilterToSql`，alias `t`：

  | read scope                           | 编译结果                     |                           |
  | ------------------------------------ | ---------------------------- | ------------------------- |
  | `{ owner_id: { $null: "false" } }`   | `"t"."owner_id" IS NULL`     | ⛔ 与作者写的意思**相反** |
  | `{ owner_id: { $null: "true" } }`    | `"t"."owner_id" IS NULL`     |                           |
  | `{ owner_id: { $null: 0 } }`         | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $null: null } }`      | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $null: undefined } }` | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $exists: "false" } }` | `"t"."owner_id" IS NOT NULL` | ⛔ 与作者写的意思**相反** |
  | `{ owner_id: { $exists: 0 } }`       | `"t"."owner_id" IS NULL`     |                           |
  | `{ owner_id: { $exists: "no" } }`    | `"t"."owner_id" IS NOT NULL` |                           |

  两行 ⛔ 是要害：字符串 `"false"` 是**真值**，于是它落在它被写下来所要表达的 `false` 的**对面** —— `{ $exists: "false" }` 写来表示「没有 owner 的行」，编出来是「**有** owner 的行」。这与 #6125 那一格方向相反：那边是 fail-**closed**（匹配零行、只是安静），这边是**加宽** —— admit 了策略要排除的行，出现在一个自述「A read-scope predicate must never be silently dropped、fail-closed」的模块里。

  ## 修法

  按 #5347（`$null`）/ #5369（`$exists`）在 `driver-sql` 面确立的先例，理由逐字适用：非布尔比较数**按声明拒收**，不做强转。闸落在 `compileField`，紧挨 #6125 的 `undefined` 闸 —— 两道闸的作用域互不相交（那一道按名字跳过这两个算子），所以谁也盖不住谁的措辞。

  两个算子**共用一条措辞**（#5240「一个条件一种措辞」），只有算子名与 `path` 不同：`driver-sql` 给孪生实现两条措辞，是因为各自要指名**自己**发射器默认倒向哪边；本模块只有一条规则（真值性）同时管着两个算子，两者失败方式完全一样，所以一条措辞才是诚实的写法。测试里有一条断言把「只有这两处不同」钉死。

  信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #5347 的 `INVALID_FILTER` / 400：read scope 由平台自己从 CEL 与库存 metadata 编出来，报 400 等于让调用方去修一个他既没写、也改不动的东西。继承的是**处置**（拒收），不是信封。

  极性表**同 PR 一起改**：`nullValueSatisfiesOperator` 的 `$null` / `$exists` 两臂从真值性（`Boolean(value)` / `!value`）改为恒等（`value === true` / `value === false`）。每张极性表钉的是它**自己**发射器的拼写（#5146 / #5298），只改发射器不改表，不变量会安静地断在定义处。这条差异消失后，本编译器与 `driver-sql` 的同名表第一次逐臂一致。

  ## ⚠️ 触达性：实测结论是**库存 metadata 走不通**

  定级依据是测量，不是立单时的措辞。`{ $null: <非布尔> }` **无法**从库存 metadata 走到本编译器，三道闸各自独立关死：`RowLevelSecurityPolicySchema` 把 `using` / `check` 声明为 `z.string()`（CEL 谓词，不是 FilterCondition），存对象直接被拒；CEL 下降只在两处发射 `$null` 且比较数是**硬编码布尔**（`== null` → `{$null: true}`，`!= null` → `{$null: false}`），`$exists` 一次都不发射；绕开 schema 塞裸对象会在 `sqlPredicateToCel` 里抛错，被 `getReadFilter` 的 catch 变成 `RLS_DENY_FILTER`。其余 read scope 生产者（Layer 0 租户过滤、`plugin-sharing` 的 `buildReadFilter`、controlled-by-parent、deny 哨兵）压根不含这两个算子。

  **仍然开着的那条**：`getReadScope` 是 `AnalyticsPluginOptions` 上有文档的公开扩展点，宿主自带的 read scope（来自 JSON 配置或没走类型检查的 JS）与本编译器之间没有任何闸 —— 本单也确认了 `plugin-security` 全路径无 `FilterConditionSchema` / `safeParse`。所以：今天不从库存 metadata 触达，但没有任何结构性的东西挡住下一个生产者。在编译器处拒收，才让「声明为布尔」等于「强制为布尔」，与谁写这条 scope 无关。

  ## ⛔ 一字未动的邻居

  - **合法布尔**：`$null: true/false`、`$exists: true/false` 的 SQL 逐字节不变（`IS NULL` 下降正是 RLS 用来圈无主行的写法，也是 CEL 唯一能产出的四种形状）。有自己的对照组回归 pin。
  - **比较数位置上的 `null`**：`{ d: null }`、`{ $eq: null }`、`{ $ne: null }`、`$in: [null]` 等 #6125 的 `NULL_CONTROL` 全部保持绿。
  - `driver-sql` / `driver-turso`（#5347 / #5369 已落地）、`packages/spec`（声明已是 `z.boolean()`）、以及本包的 `where` 门 `strategies/filter-normalizer.ts` 均未触碰。

- 2cca98b: fix(service-analytics): 分析查询的 RLS read scope 不再被 `{ $not: {} }` 整表放行,`$not` 改为 NULL-safe

  **这是一次安全相关的行为变更,涉及分析查询的可见行集合。请读完再升级。**

  ### 变更一(要害):`{ $not: {} }` 的 read scope 以前**完全不加 WHERE**,整表可见;现在是零行

  `read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的**唯一**通道(ADR-0021 D-C),
  被 `NativeSQLStrategy.applyReadScope` 与 `ObjectQLStrategy` 用来给分析查询加可见性约束。
  它以空字符串表示「无约束」(布尔常量 TRUE)。`compileNode({})` 返回空串,于是:

  ```
  compileNode({}) → ''  →  if (inner) 为假  →  $not 不产出任何子句
                        →  compileScopedFilterToSql 返回 ''
                        →  applyReadScope 的 `if (!sql) return;` 接手
                        →  生成的 SQL 里没有 WHERE
  ```

  一条语义为 `NOT TRUE ≡ FALSE`(**什么都不给看**)的 read scope,实际效果是**整张表都给看**。
  同一段循环里 `$and` / `$or` 的空数组一直是 fail-closed 抛错的,只漏了 `$not` 这一格。

  修复后 `{ $not: {} }` 编译为恒假子句 `1 = 0`,`applyReadScope` 照常拼进 WHERE,返回零行 ——
  与 driver-sql 在 #5134 / PR #5243 上的口径一致。

  **升级影响:** 如果你的 RLS 策略(或 `cel-to-filter.ts` 降解出的 CEL 规则)在某条路径上
  产出过 `{ $not: {} }`,该对象的分析查询此前是**无边界**的,现在会返回零行。行数从「全部」
  掉到「零」不是本次引入的收紧,而是那条策略本来就该有的答案 —— 请核对策略本身。

  同源、方向相反的一处一并修正:`$or` 的空析取项 `{}` 以前被 `.filter(s => s.length > 0)`
  丢掉,`{ $or: [{}, { a: 1 }] }` 收紧成 `a = 1`。`{}` 是 TRUE 析取项,TRUE 吸收整个析取,
  所以现在整条 `$or` 为 TRUE(无约束)。被丢弃分支的绑定值同时被丢弃 —— 否则 `params` 里
  会留下没有 `?` 消费的值,把后面每一个占位符都错位到别人的值上。

  ### 变更二:`$not` 改为 NULL-safe

  SQL 是三值逻辑,`WHERE` 只保留 TRUE,所以裸 `NOT ("t"."stage" = ?)` 会把 `stage IS NULL`
  的行整批丢掉;`driver-memory`、`formula` 以及 #5296 之后的 `driver-sql` 都**返回**这些行。
  同一条 read scope,普通查询与分析查询给出不同的可见集合。#5146 已由维护者判定以 JS 家族的
  答案为准,本次把这个编译器对齐过去 —— 它是仓内最后一个按三值逻辑回答 `$not` 的 SQL 家族实现。

  `$not` 的操作数在取反前先被改写成**全域(total)谓词**:

  ```sql
  -- 之前
  NOT ("t"."stage" = ?)
  -- 现在
  NOT (("t"."stage" IS NOT NULL AND "t"."stage" = ?))
  ```

  守卫**下推到每个叶子**而不是挂在 `NOT` 旁边:操作数一旦嵌套(`$not` 里套 `$or`),顶层的
  `OR col IS NULL` 会把 JS 家族排除的行重新放进来。守卫方向**逐算子**判定,不是一刀切 ——
  `{ $not: { a: { $ne: 5 } } }` 语义是「a 就是 5」,无条件加 `OR a IS NULL` 会把 scope 排除的
  行交回去,正是本次要避免的静默放松。所以 `$ne` / `$nin` / `$notContains` 用
  `col IS NULL OR (…)`,`$eq` / `$in` / `$gt` / `$between` / `$contains` 一族用
  `col IS NOT NULL AND (…)`,而 `$null` / `$exists` / `$eq: null` / `$ne: null` 本就是全域谓词,
  一个字节都不加。

  **升级影响:** 形如 `{ $not: { stage: 'won' } }` 的 read scope,以前**不返回** `stage` 为
  NULL 的行,现在**返回**它们 —— 分析查询的行数与图表数值会随之变化。这是把分析侧对齐到其余
  后端,不是新增的放宽。

  ### 不变的部分

  `$not` 路径以外一个字符都没动:普通比较仍然编译成原样的 SQL。fail-closed 的全部保证原封不动
  ——未知算子、嵌套关系值、裸数组、不安全标识符、非 filter 节点的 `$not` 操作数,以及
  `$and: []` / `$or: []` 的空组合子(那一格是 #5322 的独立裁定)统统照旧抛错。

- 07f1822: fix(service-analytics): read scope 的 `$ne` / `$nin` / `$notContains` 改为 NULL-safe,与写侧 `check` 对齐

  **这是一次安全相关的行为变更,涉及分析查询的可见行集合。**
  read scope 里的 `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,
  现在**返回**它们。`$nin` / `$notContains` 同理。

  `read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的唯一通道(ADR-0021 D-C)。
  它此前把这三个算子编译成裸的 `col <> ?` / `col NOT IN (…)` / `col NOT LIKE ?`,
  而 SQL 是三值逻辑:被比较列为 NULL 时谓词是 UNKNOWN,`WHERE` 只保留 TRUE,于是
  「该列没有值」的行被整批丢掉。

  **为什么必须与 `driver-sql` 同一个 PR 落地,而不是排到下一批。** 同一条 RLS 规则被
  写一次、在**两侧**求值:读路径由本文件降解成 SQL,写路径由 `formula` 的
  `matchesFilterCondition` 逐记录求值。`formula` 一直用两值 JS(`undefined !== 'won'`
  为真)返回这些行。只对齐其中一侧,得到的不是「更小的修复」,而正是那个缺陷本身 ——
  一条权限规则准入两个不同的行集,写侧允许的记录读侧看不见。

  ```sql
  -- 之前
  "t"."stage" <> ?
  "t"."stage" NOT IN (?)
  "t"."stage" NOT LIKE ? ESCAPE ?
  -- 现在
  ("t"."stage" IS NULL OR "t"."stage" <> ?)
  ("t"."stage" IS NULL OR "t"."stage" NOT IN (?))
  ("t"."stage" IS NULL OR "t"."stage" NOT LIKE ? ESCAPE ?)
  ```

  括号不是排版:`compileField` 用裸 `AND` 连接同一字段的多个算子,不加括号的
  `col IS NULL OR …` 会比那个 AND 结合得更松,从而**静默放宽整条 scope**。

  与 `driver-sql` 一样统一用 OR 展开而非方言等价物(`NOT LIKE` 没有对应形式;SQLite
  写法依赖本仓不锁定的引擎版本;实测执行计划相同)。正向比较逐字符不变,
  `$ne: null` 仍是 `IS NOT NULL`(空值谓词,不是比较)。

  `$not` 路径的逐叶守卫(#5146 / #5326)按原样保留,两条路径读同一张极性表。
  `filter-normalizer`(Cube 面)不在本次范围内,归本裁决第二批。

- 76bcb83: feat(spec): filter-subtree provenance — the cross-field refusal names an author's own columns again, without re-disclosing policy (#8220, A of the #7929 ruling)

  #8198 (B of the 2026-08-12 #7929 ruling) made the SQL family's cross-field
  `{ $field }` refusal withhold its operands from **every** caller, because the
  predicate reached the driver as a bare `FilterCondition`: an administrator's
  CEL sharing/permission rule and the author's own filter were indistinguishable
  there. The accepted, named cost was the author's diagnostic. This change is A
  — the sanctioned follow-up that pays it back behind a real mark instead of a
  guess.

  **The mark** (`@objectstack/spec/data`, `filter-subtree-provenance.ts`) is a
  spec-declared symbol on a filter subtree: `markFilterSubtreeProvenance(subtree,
'author' | 'policy')`, read positionally by
  `resolveFilterSubtreeProvenance(root, node)` (innermost mark on the ancestor
  chain wins; located by object identity, never structural equality). It rides
  the `where` tree by reference across the `DriverQuery` boundary — no new slot,
  documented on `DriverQuery` itself — and is dropped by exactly the operations
  (serialize, copy, rewrite) after which no attestation could be trusted.

  **Set at both read-scope merge boundaries**: `plugin-security`'s CRUD RLS
  injection marks every injected scope `'policy'` and the caller's verbatim
  predicate `'author'` — the latter only under the identity vouch
  `ast.where === options.where`, so a tree a sibling middleware already rewrote
  is vouched for nobody. `service-analytics`' `ObjectQLStrategy.withReadScope`
  marks its scope `'policy'` and the strategy-built user filter `'author'` (and
  `resolveFkAttr`'s scope arm `'policy'`).

  **Consumed by the SQL family** (`driver-sql`, `driver-turso`'s
  `RemoteTransport`; `driver-sqlite-wasm` inherits): a refusal raised from a
  subtree positively marked `'author'` carries its full diagnostic on the wire
  again — both columns, the operator, the list index, the boundary reason —
  same identity (`INVALID_FILTER` / 400).

  **⚠️ The fail direction is closed, and it is the design**: unmarked or
  ambiguous — no mark anywhere, a mark lost to serialization, a node
  unreachable from the query's own `where`, conflicting aliased marks —
  withholds exactly like `'policy'`. The mark is permission to reveal, never a
  requirement to prove secrecy; a driver-side guess at provenance is the shape
  the #7929 triage rejected.

  **Two B-era pins were REWRITTEN deliberately, not weakened.** First,
  `service-analytics`' `cross-field-engine-fallback.test.ts` pinned B's blanket
  redaction on refusals of the caller's OWN `where` (no scope in play) — under A
  that caller is the vouched author, so those cases now assert the corpus's
  `diagnosticIncludes` fragments are back on the wire, while the
  policy-injected-scope case gains the explicit non-disclosure assertions as its
  fail-closed pair. Second, the sharper one:
  `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts` pinned
  author-written and policy-injected refusals **byte-identical** — the strongest
  available statement of "the driver cannot tell them apart", and explicitly the
  assertion A was chartered to supersede. Its successor pins the three-way split
  #8220's "Done means" names: policy-injected withholds (unchanged), the vouched
  author's filter names its columns again (the messages now differ, by design),
  and an unmarked predicate still withholds **byte-identical to the policy
  case** — B's surviving half. Reading that diff as a regression is exactly what
  the old pin's comment warned against; the file header carries the full
  account.

  Unaffected: the REST boundary's 5xx-only withhold (#5367/#5667) and every
  refusal outside the cross-field family.

- e15bf7e: fix(analytics): read scope 里的 `undefined` 比较数改为拒收，不再编成绑了 `undefined` 的合法 SQL (#6125)

  **⚠️ 行为变更。** `compileScopedFilterToSql` 遇到比较数位置上的 `undefined`，从「编出合法 SQL、绑一个 `undefined`、匹配零行、零日志」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。

  ## 实测到的毛病

  #6050 于 2026-08-07 裁定（B 案）：比较数位置的 `undefined` 一律拒收，并落在了**已证实可触达**的 `driver-sql` / `driver-turso` 两面。#6125 在同一轮把仓内其余求值面逐格实测，同一个形状拿到五种读法；本条改的是其中一格 —— `service-analytics` 的 `read-scope-sql.ts`。在 `d8e8d9cbc` 上把本次拒收关掉复测，alias `t`、字段 `d`，四格与 #6125 正文表一致：

  | read scope                    | 编译结果                                      | 绑定表        |
  | ----------------------------- | --------------------------------------------- | ------------- |
  | `{ d: undefined }`            | `"t"."d" = ?`                                 | `[undefined]` |
  | `{ d: { $gt: undefined } }`   | `"t"."d" > ?`                                 | `[undefined]` |
  | `{ d: { $in: [undefined] } }` | `"t"."d" IN (?)`                              | `[undefined]` |
  | `{ $not: { d: undefined } }`  | `NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))` | `[undefined]` |

  绑定表里是 JS 的 `undefined` 本身，不是 `null`：`applyReadScope`（`native-sql-strategy.ts`）在把 `?` 改写成 `$N` 时原样 `push(scopeParams[i])`。所以 NULL 是**驱动**对一个 JS `undefined` 的读法 —— 同一格在不肯猜的驱动上则是一句裸 `Undefined binding(s)` 崩溃。一次绑定、两种败法，取决于数据源恰好挂的是哪个驱动，这正是它该在编译器处拒收、而不是在某一个消费者处修补的理由。

  方向与 #6050 不同，如实记：那边是**越权**（`{ owner_id: ctx.user?.id }` 在 Turso remote 上编成 `IS NULL`，匹配全环境行）；这边是 fail-**closed** —— 匹配零行，永远不会多给行。所以它不是潜伏的权限绕过，#6125 也没有按那个级别定级。之所以照样拒收：一个「答了没人问的问题、且一条日志都不报」的 read scope，与一个真的生效了的 read scope 在外部完全无法区分。本次改动的价值就是把沉默变成响亮。

  ## 修法

  一道闸落在 `compileField` 的开头 —— 在 `quoteIdent` 之后（不安全标识符是注入向量，保留它自己的措辞与优先级），在任何 `bind()` 之前。

  拒收的**位置**逐个清点，因为「比较数」是位置而不是类型：直接比较数（`{ d: undefined }`）、单值算子的比较数（`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族）、列表算子数组的**成员**（`$in`/`$nin`/`$between`）。四格共用**一条**措辞，只有 `path` 不同（#5240「一个条件，一种措辞」）。

  信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #6050 的 `INVALID_FILTER` / 400：read scope 的 filter 由平台自己从 CEL 与库存 metadata 编译而来，不是调用方输入 —— 报 400 等于让调用方去修一个他既没写、也改不动的东西。消息里指名要修的是**生产者**（管理员写的共享规则 / 权限集、它的 CEL 下降、或进程内拼这条 FilterCondition 的代码），并按 #5367 只进日志、不进响应体。

  三个位置**故意不扫**，各自因为本模块已经用更贴切的诊断拒了它：`$null` / `$exists`（比较数是声明的布尔量，不是比较数位置）、直接位置上的裸数组（`compileField` 整体拒「用 `{ $in: [...] }`」）、以及约束对象里的非 `$` 键（那是嵌套关系，改写成 `null` 一样编不过 —— 这一条是与 `driver-sql` 孪生实现的唯一有意分歧，来自本模块拒收嵌套关系，而不是对 #6050 的另一种读法）。

  ## ⛔ `null` 一字未动

  `{ d: null }` / `{ $eq: null }` → `IS NULL`；`{ $ne: null }` → `IS NOT NULL`；`$null` / `$exists`、`$in: [null]`、`$nin: [null]`、`$between: [null, 5]`、`$contains: null`（`%null%`，#5526）、以及 `$not` 下的各式 —— SQL 与绑定表逐字节不变。这是本次改动唯一可能造成伤害的方向（模块里每张极性表都只用一个 `===` 把 `null` 与 `undefined` 分开），所以它有自己的对照组回归 pin。

  ## 刻意不动的邻居

  - ⛔ `@objectstack/formula` 把同一个 `undefined` 读作「这个键在记录里不存在」—— 那是**第三种语义**，不是第三个 bug 拼写，也正是 #5299 在争的问题。在这里顺手改掉等于替 #5299 拍板。
  - ⛔ `driver-memory` / `driver-mongodb` 维持 #5499 投入冻结，只 pin 不改。后果是本编译器与 `driver-memory` 在这一格上从此不一致 —— 这是裁决接受的代价，解冻时一并还，账记在 #6125。
  - ⛔ `driver-sql` / `driver-turso` 已由 #6050 落地，未触碰。

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- f752ee3: feat(analytics): order the time axis by default, and give reports a sort declaration (#3916)

  A matrix report with a date dimension across rendered its columns in arbitrary
  order — `2026-07-01, 2026-07-05, …, 2026-07-02`. Declaring `dateGranularity` on
  the dataset dimension made the bucket keys _sortable_ (`2026-07`, `2026-Q3`)
  without making anything _sort_ them, and the report author had no way to ask:
  `DatasetSelection.order` existed on the wire, but `ReportSchema` had no ordering
  field at all (dashboard widgets had their own `options.sortBy` channel; reports
  did not). Nothing in the chain supplied an order either — `resolveOrdering`
  returned `undefined` unless the selection carried one explicitly, the ObjectQL
  aggregate path has no ordering grammar so its buckets came back in Map-insertion
  order, and the pivot builds its column headers in row-arrival order.

  - **A selected time dimension is now chronological by default.** When a
    selection states no `order` (and no `limit`, whose own fallback already
    ordered by every dimension), each selected dimension the cube types as `time`
    defaults to ASCENDING, in selection order. Bucket keys are minted sort-stable
    precisely so this works — `2026-07` sorts after `2026-06`, `2026-Q3` after
    `2026-Q1`. This lands on both strategy paths: a real `ORDER BY` where native
    SQL serves the query, and the executor's post-pass where a date-bucketed query
    is handed to the ObjectQL path. Null / empty buckets stay last, as everywhere
    else. Deliberately narrow: only time dimensions get a default, so grids with
    nothing wrong with them are not reordered.
  - **Reports can declare an ordering.** `ReportSchema.order` (and
    `blocks[].order` for a `joined` report) is a list of `{ by, direction }` sort
    keys, most significant first — an array, not a `Record`, because key order is
    the contract and JSON object key order should not have to be. `by` must name a
    dimension the report groups by (`rows` / `columns`) or a measure it displays
    (`values`); anything else fails at authoring time rather than becoming an
    ordering that silently does nothing. Duplicate keys are rejected. A `joined`
    report orders per block — declaring `order` on the container is an error.
    `reportSelectionOrder()` lowers the list into the `DatasetSelection.order` a
    renderer posts, and returns `undefined` for an empty list so the runtime's own
    defaults still apply.

  An explicit `order` still wins outright — the chronological default is a
  default, not a policy, so "newest month first" is one declaration away.

  `report.order` ships as `planned` + `authorWarn` in the liveness ledger: the
  framework half is complete and live (schema, lowering helper, executor), but
  objectui's `DatasetReportRenderer` does not yet carry `report.order` into the
  selection it posts. The default time-axis ordering needs no renderer change and
  is live now.

- b3a3d83: feat(spec): a shared temporal conformance matrix, and the `$between` gap it found (ADR-0053 D-A3, #4081)

  `@objectstack/spec/data` gains `TEMPORAL_ROWS` and `TEMPORAL_CASES` — the
  single set of temporal filter cases every backend is checked against, the twin
  of the existing `FILTER_LOGIC_CASES`. Five backends consume it and assert **row
  results**: `driver-sql` (and, through the live-dialect CI job, real Postgres and
  MySQL), `driver-memory`, `driver-mongodb` (real MongoDB), the analytics preview
  evaluator, and `formula`'s RLS write-side `check`.

  This is the regression backstop ADR-0053 D-A3 has asked for since 2026-06 and
  the last of its decisions to be actioned. Four separate incidents — #3650,
  #3773, #3777, #4047 — were each found by a human by accident, and each left a
  suite proving only its own issue against its own fixture. Nothing held the
  backends to one standard, so the fifth divergence had nowhere to fail.

  **`service-analytics` — a real fix the matrix found on its first run.** The
  draft-preview evaluator had no `$between` case, so it fell through to its
  permissive `default` and matched **every** row: a drafted dashboard carrying a
  range filter charted the entire dataset, then changed its numbers at publish —
  the exact continuity the preview exists to provide. It now evaluates
  `$between`, sharing the upper-bound helper with `$lte` so the whole-day
  calendar-day rule (#3777) applies to a range's max as well.

  Also recorded (ADR-0053 D-A3.1): `$gt` with a bare-day comparand on a
  `datetime` column cannot agree between typed and type-blind backends, and the
  gap is irreducible without field types. It is asserted in the shared matrix on
  `date` only, with the `datetime` cell left to the typed drivers' own suites,
  rather than papered over.

- 35accbf: feat(spec): promote the temporal storage hooks onto the IDataDriver contract (ADR-0053 D-A2)

  `temporalFilterValue` and `temporalFilterColumnSql` — the pair that closed
  #3912's storage-form drift — were duck-typed: analytics probed
  `typeof driver.x === 'function'` against a locally-invented interface, and
  nothing at the type level said a driver must implement both or neither. The
  lesson of #3912 is precisely that coercing the comparand without normalising
  the column reintroduces half the bug, so a driver implementing one hook alone
  would silently regress.

  Both are now optional members of `IDataDriver`
  (`@objectstack/spec/contracts`), documented as a pair with "absent = identity"
  semantics for drivers whose storage form is the wire form (memory, mongo).
  `SqlDriver implements IDataDriver`, so its signatures are compile-checked from
  here on; analytics derives its driver seam by `Pick`-ing the contract instead
  of a local duck type. Runtime `typeof` guards remain — that is the correct way
  to consume an optional contract member — but the shape they guard now has one
  authoritative definition.

  No runtime behaviour change. ADR-0053 D-A2 is recorded as resolved.

- e4c2dc8: Order temporal operands correctly when one side is a JS `Date` on the two
  type-blind filter backends (ADR-0053 D-A3 / #4191).

  `utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
  (re-exported from `@objectstack/core`): it reads the UTC instant a temporal
  operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
  bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
  zone-naive one being UTC, per D-B2) — and returning `null` for everything
  else, notably a bare wall clock, which denotes no instant.

  Both type-blind evaluators now use it to compare a `Date` against wire text,
  which JS relational operators cannot do: `<` and friends coerce with hint
  `number`, so the `Date` becomes its epoch and the string becomes `NaN`.

  - `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
    every `Date`-valued row in 10 of the 16 shared conformance cases. The
    post-image is the caller's raw write payload, so an SDK write of
    `new Date()` hit this directly, and fail-closed turned it into a **denied
    write**.
  - `service-analytics`' preview evaluator diverged on the same 10 cases in
    BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
    comparand — a drafted chart both lost rows and gained ones, then changed
    its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
    `Date`s, so this was reachable in normal use.

  Comparisons that did not involve a `Date` are unchanged.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 3f8817a: feat(spec,drivers,objectql,analytics,formula): `$icontains` reaches every JS evaluation face (#6520)

  The other half of #5702. That change implemented `$icontains` on the SQL family
  and correctly left the spec's `FILTER_OPERATORS` alone; this one adds the
  operator to that array and gives every remaining evaluation face an arm, in ONE
  change, because those two steps cannot be separated.

  **Why one PR.** `FILTER_OPERATORS` is not a word list, it is a runtime allowlist:
  `driver-memory`'s shape gate derives from it, and its matcher's `default:` arm
  assumes the gate already refused anything unimplemented. Measured on a branch
  that added the name early (#5701): the gate stopped refusing, the matcher fell
  through, and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
  `true` — the predicate silently dropped, every row matched. A dropped predicate
  does not narrow a query, it WIDENS it, and on an RLS read scope that is a
  permission bypass rather than a degraded feature (#3948). So the word list
  travels with the evaluators or not at all.

  **What now answers it**, all folding the same domain: `driver-memory` (query
  path, reference matcher, and the analytics/cube face), `driver-mongodb`,
  `objectql`'s `having`, `@objectstack/formula`'s `matchesFilterCondition` (the RLS
  write-side `check`), and `service-analytics`' three SQL compilers (the RLS
  lowering, the native-SQL strategy, and the `/analytics/sql` echo).

  **The fold is ASCII-only, and that is the contract, not an implementation
  detail** (#4706 Q1 = A). `$icontains: 'café'` does not match `CAFÉ`. Every face
  reads one shared definition — `foldAsciiCase` /
  `asciiCaseInsensitiveContains` / `asciiCaseInsensitiveRegexSource`, new exports
  on `@objectstack/spec/data` — because the two obvious per-package spellings are
  both wrong in the same direction: `toLowerCase()` folds the whole Unicode range,
  and so does a `RegExp` built with the `i` flag. SQLite folds ASCII only and three
  of the five drivers are SQLite underneath, so a Unicode fold on a JS face would
  re-open exactly the divergence the ruling closed. The pattern-binding faces
  (mingo, mongo) therefore emit one `[Aa]` character class per ASCII letter and
  pass NO flags; mongo's `$icontains` is the one arm in its family that does not
  set `$options: 'i'`.

  The comparand keeps the rules its SQL twin has: matched LITERALLY (`%`, `_` and
  regex metacharacters are ordinary characters), and refused when empty or
  non-string — an empty comparand matches every row, which is a predicate that
  constrains nothing.

  **User-visible effect.** A filter using `$icontains` now behaves the same on the
  in-memory double and on SQL, so an app whose tests run on one and whose
  production runs the other stops getting two answers from one filter. Downstream,
  #5814 (better-auth `Where.mode: 'insensitive'`) no longer hits a 400 on the
  memory double.

  Not changed, and still tracked: the `$contains` family still folds Unicode on
  `driver-memory`'s query path and `driver-mongodb` (#6682) — both remain DEBT rows
  in `scripts/check-driver-conformance.mjs`, now naming one open requirement each
  instead of two. `formula`'s unknown-operator posture stays a silent, fail-closed
  `false` (it governs a write-side check, where an unevaluable condition denies
  rather than widens); the decision and its limits are documented on
  `matches-filter.ts`, and no operator the spec DECLARES is answered that way any
  more.

- 3264516: fix(driver-sql,service-analytics)!: 两类无意义比较对象不再编译成「静默空谓词」——`$in`/`$nin` 的对象成员与 LIKE 族的对象比较值一律拒收 (#5234)

  两个形状此前都**编译通过、执行、并给出一个作者没写过的答案**,而且没有任何东西记录这件事:

  | filter                             | 改前                                                                                   | 改后                                               |
  | ---------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
  | `{status: {$in: ['a', {foo: 1}]}}` | 该成员绑不上任何行,查询答得**就像第二个成员从没被写过**                                | `INVALID_FILTER` / 400,点名 `index 1`              |
  | `{status: {$nin: [{foo: 1}]}}`     | `NOT IN ('[object Object]')` —— **一行都没排除**,作者写下的排除悄悄没发生              | 同上                                               |
  | `{name: {$contains: {}}}`          | `LIKE '%[object Object]%'` —— 对一行文本恰好是 `[object Object]` 的记录,**真的命中了** | `INVALID_FILTER` / 400,点名 `StringOperatorSchema` |
  | `{name: {$notContains: {}}}`       | 反过来:为一个没人记录的理由**排除了一条真实记录**                                      | 同上                                               |

  #5041(PR #5223)在 `assertCompilableComparand` 的头注释里把这两个形状写为 "Deliberately NOT
  extended",理由是它们 fail-closed(只收窄结果集)、比 #5041 实测的裸 `TypeError` 低一级。**实测下来这
  两条理由都不成立**:`$nin` / `$notContains` 方向是**放宽**(该排除的没排除,在 read-scope 下即 #5347 /
  #5324 判过的 over-reach);而 `$contains: {}` 给的从来不是「零行」,是**错行**。

  ## 三份实现一起动,否则修完仍是方言

  同一个 `String()` 宽容在本仓有多份;只收紧 `driver-sql` 会变成「哪个面接的就是哪个答案」——
  #5146 / #5332 / #5567 各花一轮消掉的那类分叉。守卫因此落在**每个包自己的收口点**,而不是三个发射器:

  - **`driver-sql`** —— `assertCompilableComparand`,#5041 已有的那一个门。
  - **`service-analytics` 的 `where` 门** —— `filter-normalizer.ts` 的 `fieldLeaves`。它是本包**唯一**的
    leaf 生产者,所以一处拒收同时覆盖三个消费方:`NativeSQLStrategy`(真正执行的语句)、
    `ObjectQLStrategy.generateSql`(`/analytics/sql` 回显)与 `ObjectQLStrategy.convertFilter`(引擎路径)。
    这个顺序是关键而非顺手:`convertFilter` 是**生产者**,在那里 `String()` 会把对象洗成一个类型完全正确
    的 `'[object Object]'` 字符串交给驱动,下游再严格的驱动也永远看不到它该严格的那个形状。
  - **`service-analytics` 的 read-scope 门** —— `read-scope-sql.ts` 的 `compileOperator`,它编译的
    `FilterCondition` 不经过上面那个门。

  `like-pattern.ts` 与 `applyLike` 里的 `String(value)` **原样保留**:它们不再是缺陷所在,因为门前已经没有
  渲染不出来的值能到达。两包的谓词由 `like-metacharacter-escape.test.ts` 逐值互锁——正是该文件已经用来锁
  转义表达式的同一套办法。

  ## 围栏是 allow-list,而且每一条都是实测后决定的

  抄 `driver-turso` `RemoteTransport` 的形状(cloud#1004 / #1058):deny-list 会把下一个被发明出来的值形状
  悄悄放进来,这正是那个 bug 熬过第一次修复的原因。顺带说明,**turso 自 #1058 起就已经拒收这两个形状**,
  所以本地 SQLite 与远程 SQLite 此前对同一条查询给的是不同答案;本次改动把它们收敛到一起。

  留在围栏内的(逐条实测,不是假设):

  - **数字 / 布尔 / `null`**:`{$contains: 5}` → `%5%`、`{$contains: null}` → `%null%` 在 `driver-sql`、
    `driver-memory` 与 analytics 两个面上**今天答案一致**,#5526 还专门把 `null` 这条钉住了。拒收它们是在
    **破坏**一致,不是建立一致——所以只拒**对象**。
  - **`Date`**:turso 的 allow-list 把它作为唯一的对象转换保留,拒收会重新叉开本地与远程。
  - **binary**:`$in` 成员照收(`isBindableComparand` 与写路径 `formatInput` 同一套分类),LIKE 拒收——它
    绑得上但渲染不出作者想要的东西。这就是两个谓词而不是一个带 flag 的原因。
  - **`undefined`**:不可授权(JSON 没有 `undefined`),analytics 门按 #5526 / #5332 归一为 `null` 而非拒收;
    在 `driver-sql` 拒收它会**造出**一个分歧而不是消除一个,故照旧。

  被拒的**数组**是本次唯一一个「拒收即消分叉」的形状:`{name: {$contains: ['al','be']}}` 在 `read-scope-sql`
  (与 `driver-sql`)绑 `%al,be%`,在 analytics 的 `where` 门却绑 `%al%`(它读 `values[0]`,后面的成员被
  静默丢弃)。同一个包对同一条 filter 有两个答案,两个门现在都拒。

  ## 作者需要知道的迁移

  这两个形状本来就没有能用的读法——`filter.zod.ts` 的 `StringOperatorSchema` 早就把 LIKE 族比较数声明为
  `z.string()`,本次只是让声明变成强制(Prime Directive #12,declared = enforced)。改后它们答 400 而不是
  一个错答案;把比较数换成字面值即可。`{$eq: {…}}` **不在本次范围**,仍按 `toSqlBindValue` 绑 JSON(#5526
  钉住的行为)。

### Patch Changes

- 259459d: refactor(spec)!: retire `array_agg` / `string_agg` from `AggregationFunction` — `count_distinct` deliberately kept (#6188, ADR-0049)

  `AggregationFunction` declared eight functions; the SQL family compiles five.
  `SqlDriver.mapAggregateFunc` and the Turso `RemoteTransport.aggregate` each lower
  `count`/`sum`/`avg`/`min`/`max` and route everything else to one refusal, so
  three of the eight were declared-but-unenforced against the backends this
  platform targets — and, worse, the _set_ each backend implemented was different,
  so "which aggregations can I use" had no answer an author could read off the
  schema.

  What makes these two sharper than an ordinary inert declaration is that another
  package had to carry a denylist for them. `service-analytics` subtracted
  `array_agg` and `string_agg` by name in `UNSUPPORTED_AGGREGATES`, because
  without that subtraction they reached the Cube strategy's `default` and came
  back as `COUNT(*)` — **a row count in place of the value the author asked for**,
  with no error and no log (objectui#2945).

  **The three unlowered functions were SPLIT, not retired as a block** (maintainer
  ruling, 2026-08-07):

  - **`count_distinct` STAYS** and takes ADR-0049's _enforce_ leg. It is a
    dashboard staple with one portable lowering (`COUNT(DISTINCT x)`), and
    `service-analytics` lowers it already; the SQL-driver implementation follows
    on its own card. Its declaration leads its implementation here by decision,
    not by drift.
  - **`array_agg` / `string_agg` take the _remove_ leg.** Display conveniences
    with no measured pull, and `string_agg` never had one shape to lower to at
    all: the delimiter is a second argument in PostgreSQL, a `SEPARATOR` clause in
    MySQL and a differently named function in SQL Server.

  FROM → TO, both authoring surfaces:

  | Was                                                                         | Now                                                                                                                                       |
  | :-------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
  | `aggregations: [{ function: 'array_agg', field: 'tag', alias: 'tags' }]`    | no replacement — read the rows with an ordinary `fields` query and shape them in the caller, or materialise the roll-up as a stored field |
  | `aggregations: [{ function: 'string_agg', field: 'name', alias: 'names' }]` | as above                                                                                                                                  |
  | `measures: [{ name: 'tags', aggregate: 'array_agg', field: 'tag' }]`        | delete the measure — `compileDataset` already refused it by name, so it never produced a number                                           |

  The retirement kit:

  - This is an enum **VALUE** retirement, so there is no `retiredKey()` tombstone:
    the enum's own error map carries the prescription, keyed on the received value
    so that only the two spellings which used to be legal are told they "were
    removed" (the `crypto.hash` / `HookBodyCapability` precedent, #4391). A
    mis-spelling still gets zod's list of the legal functions. For the same reason
    nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are
    byte-identical — no def and no authorable key changed.
  - **ADR-0087 D2 conversion + D3 chain step**
    (`dataset-measure-array-string-agg-removed`): `os migrate meta --from 16`
    drops any `dataset.measures[]` declaring a retired aggregate, plus any derived
    measure the drop strands, with a notice each. The measure is dropped rather
    than stripped down because one with neither `aggregate` nor `derived` fails
    the dataset's own refinement — a conversion whose output cannot parse is worse
    than none.
  - **D3 semantic entry** (`query-array-string-agg-retired`) for
    `QueryAST.aggregations[].function`: a request surface, never stored, so there
    is no source for the chain to rewrite and callers move their own queries.
  - The engine's in-memory fallback (`@objectstack/objectql`) drops its arms for
    both functions — a `switch` case on a value the enum no longer has does not
    type-check, and a dead arm is how a retired vocabulary returns by accident.
  - `service-analytics`' `UNSUPPORTED_AGGREGATES` is now **empty and kept**: it is
    half of an arithmetic the lockstep suite enforces (`SUPPORTED = spec
vocabulary − this`), which is what stops the next aggregate added to the spec
    from silently reaching that `COUNT(*)` default.

  **Behaviour that actually changes** — this is the rare narrowing that removes
  reachable behaviour, and it is worth stating plainly: on `driver-mongodb` and on
  the engine's in-memory fallback these two DID compute. A raw QueryAST
  aggregation against those backends returned an array or a joined string and will
  now be refused at parse. That unpredictability is precisely what the ruling
  ended — an aggregation that worked on one backend and failed on another is not a
  capability — and both of those backends are inside the #5499 freeze. Their code
  is untouched; it is simply no longer reachable through a spec-valid request. On
  the dataset path nothing changes: `compileDataset` refused both by name already.

    <!-- adr-0087: registered query-array-string-agg-retired, dataset-measure-array-string-agg-removed -->

- 2bc1876: fix(service-analytics): refuse a dotted `measures` entry loudly instead of aggregating the base column (#5918)

  **Observable behaviour change.** An analytics query whose `measures` entry
  carries a dot that is not the cube-name qualifier — `owner.region_count_distinct`,
  `total.sum` — now answers `400 INVALID_FIELD` naming the entry **as the request
  spelled it**. Some of these queries used to succeed.

  That is the point: succeeding is what was wrong with them. The auto-inference
  path minted a measure by dropping the first segment of any dotted entry, so on
  an object that happened to carry a same-named column the query ran

  ```
  SELECT COUNT(DISTINCT region) AS "owner.region_count_distinct" FROM "crm_account"
  ```

  — no JOIN, no error, a response column labelled with a relation attribute and a
  number that came from the base table. The caller could not tell from the result
  that it was wrong. Where the object had no same-named column it degraded to the
  #4437 gate's `400 INVALID_FIELD`, which was honest about what reached SQL
  (`aggregates field 'score'`) but named a string nobody had written; the caller
  had sent `owner.score_sum`.

  `measures` was the fourth and last mint site of the punctuation #5739 sorted
  out on `dimensions` / `where` / `timeDimensions`. It is ruled the other way, and
  deliberately so: `lookupMember`'s relation-traversal tier is dimension-only, so a
  dotted measure has no correct traversal answer to converge on. A refusal is the
  honest answer, and it costs nothing that was working. Maintainer ruling,
  2026-08-07.

  Both a genuine traversal intent (`owner.amount_sum`) and a plain typo
  (`total.sum`) get this refusal. They are lexically indistinguishable on this
  path, and separating them would need field metadata the ad-hoc path does not
  have. A real relation-traversal measure (`SUM("owner"."amount")` + LEFT JOIN)
  would be a capability with its own justification, not a side effect of a strip.

  The refusal is applied at both places a Metric is minted from a request
  spelling — the ad-hoc mint and the suffix-augmentation mint for a cube that is
  already registered — because the ad-hoc path registers what it infers, so the
  very same query reaches the second one from the second request onwards.

  Unchanged: the `<cube>.` qualifier (`crm_account.region_count_distinct`) is
  still stripped and still runs; bare measures (`region_count_distinct`, `count`,
  `created_at_max`) are untouched; a cube's own declared measure is authored, not
  minted, so a Cube whose measure names a related column in its `sql` still
  compiles the JOIN — which is the supported way to aggregate across a
  relationship; and dotted **dimensions** still traverse, per #5739.

  **Migration.** Aggregate one of the object's own fields
  (`<field>_sum` / `_avg` / `_min` / `_max` / `_count_distinct`), or declare a Cube
  whose measure names the related column. The refusal message says both, and names
  the entry you sent.

- 1d0faa7: fix(service-analytics): postgres 的「缺列」措辞不再被判为「缺源」(#6035)

  数据集查询的降级路径靠驱动措辞判断「后端表没挂载」,从而把控件渲染成空网格而不是 500。
  它的判据 `isMissingSourceError` 自己的文档写明范围**只含缺表/缺对象,不含列/语法错误——
  后者要保持硬失败,好让真正的查询 bug 浮上来**。有一条 postgres 措辞按构造违反了这条承诺:

  ```
  column "label" of relation "acct" does not exist        (SQLSTATE 42703)
  ```

  它内部**逐字包含**一整段合法的缺表措辞 `relation "acct" does not exist`。#5717 把 postgres
  那一支从「同时含两个词的任意句子」收紧为锚定真实缺表措辞后,这条依然命中——它必然命中,因为它
  字面上**就是**那段措辞。所以任何对「这句话是不是在说某个 relation 不存在」的收紧都排除不掉它,
  只有**先问更具体的问题**才可以:修法是一个**判定顺序**(先摘掉缺列措辞,再做缺源判定),而不是
  一个更好的正则。

  两种后果都是错的,而具体触发哪一种只取决于措辞里那个关系名是否恰好是数据集自己的对象:

  - 名字是**被 JOIN 的表** → 报出一条响亮但**虚假**的跨数据源拓扑错误,把一个拼写错误说成数据源
    布局问题;
  - 名字是**数据集自己的对象** → 控件降级成空网格,只留一条 warn,拼错的列名不会告诉任何人。

  两半现在都作为回归钉住。判定顺序抄 `rest-server.ts` 的 `mapDataError` 自 #5352 起就在用的先例
  (它同样先摘出这条措辞,于是 REST 面回答 `400 INVALID_FIELD` 而不是 `404`),用的是同一条正则
  而不是它的第二种方言——两个面不该对「postgres 什么时候在说 column」给出不同答案。兄弟函数
  `missingSourceRelation` 做同样的前置摘除:实测在修改前它对这条措辞回答 `sys_team`,只修其一会让
  「是不是缺了什么」与「缺的是什么」相互矛盾,而那正是 #5717 在这一支上刚消除的分歧。

  **这不修线上事故,而是让判据与它自己的文档一致。** analytics 是只读面,而 postgres 在 SELECT
  下的未知列措辞是 `column "bogus" does not exist`(不含 `relation`,本来就不命中);
  `column … of relation …` 是 INSERT/UPDATE/ALTER 措辞。价值在于:这条分歧不再依赖「读路径不产生该
  措辞」这个假设活着——哪天有任何写形状语句、驱动改措辞、或多包一层 `cause` 把它送到这个 catch
  面前,它会被正确分类,而不是被静默吞掉。

  #5717 量过的 13 条仓内真实措辞全部重新钉住,并且是**按调用方可观测的结果**(空网格 / 拓扑拒收 /
  原样上抛)钉的,而不是按私有判据的布尔值——实测 **13 条里只有 1 条改判**,就是缺列那条,其余 12
  条(三个驱动家族的措辞、框架的 not-registered 信号、本包自己的拒收)逐条不变。

- 8e2bbba: fix(service-analytics): `compareTo` 在「日期维度本身就是网格维度」时把比较桶键平移回当期 (#6007)

  趋势图 + 同比是 `compareTo` 最常见的形状:日期维度既写进 `selection.dimensions`
  (它就是图表的时间轴),又被 `compareTo` 用作锚点。这个形状下比较趟从来没有对齐过。

  比较趟查询的是**平移后**的窗口,所以它的行按平移后的桶键落地;而
  `mergeByDimensions` 按 `selection.dimensions` 元组建键 —— `2025-01` 不等于
  `2026-01`,于是**没有一条**比较行合并得进去,全部作为新行追加。两趟各自只报告了自己
  那一半,`fillEmptyGroups` 把另一半填成自信的 `0`,再加上平移后的桶键坐在网格里,而它们
  落在调用方筛选窗口之外。一个 2 桶窗口的「今年 vs 去年同期」回来是这样的:

  ```
  [{"close_date":"2025-01","opp_count__compare":5,"opp_count":0},
   {"close_date":"2025-02","opp_count__compare":7,"opp_count":0},
   {"close_date":"2026-01","opp_count":1,"opp_count__compare":0},
   {"close_date":"2026-02","opp_count":2,"opp_count__compare":0}]
  ```

  四行、每行一个 0、两行在窗口外;期望是 2 行 × 2 列。

  **修法(维护者裁决 2026-08-07,方向 1):合并之前,把每个比较桶键用当期的说法重述一遍。**
  上例现在返回 `[{close_date:'2026-01',opp_count:1,opp_count__compare:5},
{close_date:'2026-02',opp_count:2,opp_count__compare:7}]`。

  - `previousYear` —— 窗口是按日历年平移的,所以逆运算就是按日历年往前推一年:对桶自己的
    首日做平移再重新分桶。`2025-01` → `2026-01`、`2025-Q1` → `2026-Q1`、
    `2025-W03` → `2026-W03`。它刻意是 `shiftRange` 那套年运算的精确逆运算(含
    `setUTCFullYear` 的溢出行为),窗口与桶键因此不可能对「一年」有两种理解。
  - `previousPeriod` —— 任意天数窗口没有日历对应物,所以按**桶序(bucket ordinal)**对齐:
    上一窗口的第 n 个桶对上本窗口的第 n 个桶,n 各自从自己窗口的起点数起。序号由**日历**算出
    而不是数组下标,所以本期网格里某个桶没有数据(存在空档)不会让其后每个桶都错位一格。

  **响应形状不变** —— 仍然是 `<measure>__compare` 列,行仍然是网格维度元组,所以消费端
  (objectui#3337 正在收敛的那条契约)不受影响。

  不确定时一律**保持原样**(即改动前的行为),而不是猜:空桶(两条聚合路径上键都是 `null`,
  两趟本来就互相合并)、未分桶的日期维度(分组的是原始时间戳,不是桶键)、以及平移回来落在
  当期窗口之外的桶(两个等长的天数窗口可以切出不同的桶数)。

  范围严格限定在坏掉的那个形状:锚点必须是**网格维度**(仅作窗口的锚点两趟都不是列,#5688
  之后本来就对齐)且必须**被分桶**。两趟通过同一个 `granularityOf` 读取桶大小,所以这里重述
  的桶大小按构造就是查询分组用的桶大小。

- ab54608: fix(service-analytics): a dataset `label` written as an inline locale map reaches the wire resolved, instead of being dropped (#6761)

  `I18nLabelSchema` has authorized two forms of a display label since #5728: a
  plain string, and an inline locale map `{ en: 'Owner', 'zh-CN': '负责人' }`. The
  analytics producer only understood the first one, so a dataset written the way
  the schema documents came back with **no label at all**:

  | dataset declares                            | `fields[]` carried, before |
  | ------------------------------------------- | -------------------------- |
  | `label: 'Owner'`                            | `label: 'Owner'`           |
  | `label: { en: 'Owner', 'zh-CN': '负责人' }` | _(no `label` key)_         |
  | _(no label)_                                | _(no `label` key)_         |

  Measured identically on both strategies. All three renderers that read
  `fields[].label` first — `DatasetWidget`, `DatasetPreview`,
  `DatasetReportRenderer` — then fell back to humanizing the raw key, so a Chinese
  deployment authoring exactly what the spec documents got English-ish machine
  names for its column headers.

  One layer earlier, `dataset-compiler` substituted the machine **name** for the
  same map (`typeof d.label === 'string' ? d.label : d.name`), which additionally
  made `/analytics/meta` publish `title: 'owner'` as a _display title_ — a face
  that lied rather than one that was merely bare.

  Both are fixed by calling the shared `I18nLabel → string` resolver
  (`resolveI18nLabel`, `@objectstack/spec`, #6765), which is pinned in its own
  package to rule parity with objectui's `pickLocalized`. Nothing is
  re-implemented here: the maintainer's ruling on #6761 chose one shared resolver
  precisely so the two ends cannot answer the same authored map differently.

  **The wire is unchanged.** `AnalyticsResult.fields[].label` is still
  `string | undefined` on both ends — this resolves _to_ a string rather than
  widening the contract, so no consumer changes and no map can reach a renderer
  that would print `[object Object]`.

  **Which locale each site uses:**

  - `queryDataset`'s two field-enrichment sites resolve at
    `ExecutionContext.locale` — the per-request BCP-47 tag derived from the
    caller's `Accept-Language`, falling back to the workspace `localization`
    setting. Both sites read one hoisted value, so a single response cannot mix
    two audiences.
  - `dataset-compiler` resolves with **no** locale, i.e. the resolver's documented
    nullish answer `en`. A compiled Cube is a registry artifact shared by every
    later reader, and `getMeta()` — the `/analytics/meta` face — takes no
    execution context at all; baking a request locale there would make
    `/analytics/meta` answer whoever queried last.

  **Nothing is invented on a miss.** A label the resolver cannot resolve (an
  absent label, or an empty map) writes no `label` key on the wire at all — a
  placeholder would permanently pre-empt the real label under the downstream
  `if (field.label == null)` guard. In the compiler, where `Metric.label` /
  `Dimension.label` are required strings, the machine-name fallback is unchanged
  from before; it never reaches `fields[]`, so it cannot pre-empt anything either.

- 6fde910: fix(objectql,service-analytics): report the datasource an object is actually on, not the one it declares (#5288)

  Analytics' `getObjectDatasource` probe read `getObject(name).datasource` — the
  object's **declared** value, which is step 1 of the five `ObjectQL.getDriver`
  resolves by. `ObjectSchema.datasource` carries `.default('default')`, and
  `'default'` means "no explicit binding, keep looking" inside the engine, so
  every object placed by a `datasourceMapping` rule, by the ADR-0057 §3.6
  lifecycle split, or by its package's `defaultDatasource` answered `'default'`
  and was read out here as "the primary DB".

  `sys_audit_log` is the live specimen: `lifecycle.class: 'audit'` puts it on the
  `telemetry` datasource with nothing declared to read. So #5033's query-time
  diagnostic — whose entire job is to NAME the database a table is missing from —
  named the wrong one:

  ```
  before: table "account" is not on datasource "default",   which is where its base object "sys_audit_log" lives
  after:  table "account" is not on datasource "telemetry", which is where its base object "sys_audit_log" lives
  ```

  **New engine accessor — `ObjectQL.resolveEffectiveDatasource(objectName)`.** The
  public, name-only face of the resolution order `getDriver` already routes by,
  extracted so the order exists exactly once (the same argument that produced
  `resolveMappedDatasource` in #4462: a second, shorter copy of a routing order
  drifts by one step, silently). `getDriver` now consumes the same resolver and
  keeps every existing behaviour — precedence, the refusal to fall through to the
  default store when a declared or mapped datasource has no live driver, and both
  of its diagnostics.

  It answers `undefined` when nothing binds the object anywhere and it simply
  rides the deployment's default driver. That is deliberate and unchanged from
  what consumers already documented: the default driver keeps its natural name
  (#3826), so that name identifies a driver rather than a datasource anyone bound
  the object to. `getDefaultDriverName()` is still there for callers that want it.

  Analytics' probe now asks the engine instead of the declaration; the routing
  rules are **not** re-implemented on the analytics side. #5115's compile-time
  cross-datasource join gate keeps its predicate exactly as written — what changed
  is that its input can now answer for objects bound by a mapping rule, by the
  lifecycle split, or by a package default, so a join between two bound
  datasources is refused at registration instead of exploding at query time. A
  join from a bound object to one that merely rides the deployment default is
  still not decidable at compile time and remains the query-time diagnostic's
  business.

- 49f208b: fix(analytics): an `undefined` comparand in an analytics `where` is refused (400 `INVALID_FILTER`), not read seven different ways

  **Observable behaviour change.** A `where` key whose value is `undefined` used to
  compile — in seven different ways, depending on where it sat. It is now refused
  with `INVALID_FILTER` / 400, the envelope every other refusal at this door
  already carries.

  The three that mattered WIDENED the query, which is the failure mode
  `filter-normalizer.ts` forbids in its own body ("NEVER drop: a missing predicate
  does not narrow the query, it WIDENS it"), while its entry line did exactly that:

  | `where`                        | used to normalize to             | reading                                                  |
  | ------------------------------ | -------------------------------- | -------------------------------------------------------- |
  | `{d: undefined}`               | `null`                           | the WHOLE filter dropped — the query ran **unfiltered**  |
  | `{stage: 'won', d: undefined}` | `stage equals 'won'`             | the `d` conjunct vanished in silence                     |
  | `{$not: {d: undefined}}`       | `NOT (d set)`                    | `d IS NULL` — a predicate the author never wrote         |
  | `{d: {$eq: undefined}}`        | `d equals [null]`                | a value comparison, **not** `$eq: null`'s null predicate |
  | `{d: {$gt: undefined}}`        | `d gt [null]`                    | ditto                                                    |
  | `{d: {$in: [undefined]}}`      | `d in [null]`                    | ditto                                                    |
  | `{d: {$ne: undefined}}`        | `d notSet OR d notEquals [null]` | ditto                                                    |

  The direction is silently **wrong results** — an analytics figure, a report
  total, an aggregate, wrong with nothing to read — **not** a permission bypass:
  read scope is compiled by a different door (`read-scope-sql.ts`) and never passed
  through here, so a caller still saw only rows it was entitled to, just more of
  them than it asked for.

  **What to change if this refuses your filter.** `undefined` cannot cross JSON, so
  neither REST door can carry it — this only reaches in-process callers of
  `AnalyticsService.query({ where })` that spread a possibly-absent value into the
  filter object (`{ owner_id: ctx.user?.id }`). Two repairs, both stated by the
  error message:

  - meant the null predicate → write `{ field: null }` or `{ field: { $null: true } }`;
  - the value is genuinely absent → **omit the key**, which is the same "no
    constraint" without the ambiguity.

  Inside stored metadata, the platform's own answer to "scope this to the current
  user" is unaffected and was already fail-closed: a `{current_user_id}`
  placeholder resolves through `resolveFilterTokens`, which raises
  `FILTER_TOKEN_UNRESOLVED` / 400 rather than emitting `undefined`.

  ⛔ **`null` does not move.** `{d: null}`, `{$eq: null}`, `{$ne: null}`,
  `{$null: …}`, `{$exists: …}` and `$contains: null` keep their exact lowering —
  `null` is a declared comparand and is the null predicate. `$null` / `$exists`
  carry a declared boolean flag rather than a comparand and are likewise untouched.

- 2604d34: fix(analytics): a field constraint mixing `$` operators with non-`$` sibling keys is refused (400 `INVALID_FILTER`), not silently narrowed to its operators

  **Observable behaviour change.** A `where` field wrapper that carries `$`-operator
  keys and non-`$` keys at once used to compile its operators and silently DROP
  every non-`$` sibling. It is now refused with `INVALID_FILTER` / 400, the
  envelope every other refusal at this door already carries. Ruled Option A
  (refuse) on #6444, 2026-08-08; Option B (flattening the siblings as nested
  paths) was rejected because it would compile the likely-real cause — a dropped
  `$` — into a predicate on a non-existent member such as `amount.gte`.

  | `where`                                   | used to normalize to      | reading                                             |
  | ----------------------------------------- | ------------------------- | --------------------------------------------------- |
  | `{d: {$eq: 1, nested: 'x'}}`              | `d equals [1]`            | the `nested` conjunct vanished in silence           |
  | `{amount: {gte: 10, $lte: 20}}`           | `amount lte 20`           | the missing-`$` typo: the lower bound silently gone |
  | `{$not: {d: {$null: true, nested: 'x'}}}` | `NOT(d set AND d notSet)` | a contradiction that negates to TRUE — every row    |

  Every row WIDENED the query — a dropped conjunct returns rows the author
  excluded, with nothing to read (the #3650 family this module refuses everywhere
  else). Unlike #6386's `undefined` comparand, this shape survives JSON, so it can
  sit in stored dashboard / report / dataset metadata as well as in-process
  callers of `AnalyticsService.query({ where })`.

  **What to change if this refuses your filter.** The message names the offending
  key(s) and both repairs, because the shape has two readings this door cannot
  tell apart:

  - an operator missing its `$` was meant → spell it with the prefix
    (`gte` → `$gte`: `{ "amount": { "$gte": 10, "$lte": 20 } }`);
  - a nested-relation member was meant → give it a wrapper of its own with no `$`
    siblings (`{ "d": { "nested": "x" } }` compiles to the member `d.nested`) and
    AND it with the operator constraint explicitly via `$and`.

  ⛔ **The two pure shapes do not move.** A wrapper that is all `$`-operators
  compiles exactly as before (`{amount: {$gte: 10, $lte: 20}}` stays the AND of
  its bounds), and a wrapper that is all non-`$` keys keeps flattening to the
  dotted member (`{d: {nested: 'x'}}` → `d.nested`). `$null` / `$exists` flag
  semantics, the `null` comparand rulings (#5332 / #5526) and the sibling door
  `read-scope-sql.ts` — which has always failed closed on this shape — are
  untouched.

- 3cc8676: fix(analytics): read scope 里非布尔的 `$null` / `$exists` 比较数改为拒收，不再按真值性编成相反的谓词 (#6387)

  **⚠️ 行为变更。** `compileScopedFilterToSql` 遇到 `$null` / `$exists` 上的非布尔比较数，从「按 JS 真值性归入两个声明答案之一、静默编出合法 SQL」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。今天靠这个静默翻转在跑的 read scope，从此会响亮地失败。

  ## 实测到的毛病

  发射器读的是 `val ? … : …` —— **真值性**，不是 `@objectstack/spec` `FieldOperatorsSchema` 声明的 `z.boolean()`。在 `5faa23ca3` 上直接调 `compileScopedFilterToSql`，alias `t`：

  | read scope                           | 编译结果                     |                           |
  | ------------------------------------ | ---------------------------- | ------------------------- |
  | `{ owner_id: { $null: "false" } }`   | `"t"."owner_id" IS NULL`     | ⛔ 与作者写的意思**相反** |
  | `{ owner_id: { $null: "true" } }`    | `"t"."owner_id" IS NULL`     |                           |
  | `{ owner_id: { $null: 0 } }`         | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $null: null } }`      | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $null: undefined } }` | `"t"."owner_id" IS NOT NULL` |                           |
  | `{ owner_id: { $exists: "false" } }` | `"t"."owner_id" IS NOT NULL` | ⛔ 与作者写的意思**相反** |
  | `{ owner_id: { $exists: 0 } }`       | `"t"."owner_id" IS NULL`     |                           |
  | `{ owner_id: { $exists: "no" } }`    | `"t"."owner_id" IS NOT NULL` |                           |

  两行 ⛔ 是要害：字符串 `"false"` 是**真值**，于是它落在它被写下来所要表达的 `false` 的**对面** —— `{ $exists: "false" }` 写来表示「没有 owner 的行」，编出来是「**有** owner 的行」。这与 #6125 那一格方向相反：那边是 fail-**closed**（匹配零行、只是安静），这边是**加宽** —— admit 了策略要排除的行，出现在一个自述「A read-scope predicate must never be silently dropped、fail-closed」的模块里。

  ## 修法

  按 #5347（`$null`）/ #5369（`$exists`）在 `driver-sql` 面确立的先例，理由逐字适用：非布尔比较数**按声明拒收**，不做强转。闸落在 `compileField`，紧挨 #6125 的 `undefined` 闸 —— 两道闸的作用域互不相交（那一道按名字跳过这两个算子），所以谁也盖不住谁的措辞。

  两个算子**共用一条措辞**（#5240「一个条件一种措辞」），只有算子名与 `path` 不同：`driver-sql` 给孪生实现两条措辞，是因为各自要指名**自己**发射器默认倒向哪边；本模块只有一条规则（真值性）同时管着两个算子，两者失败方式完全一样，所以一条措辞才是诚实的写法。测试里有一条断言把「只有这两处不同」钉死。

  信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #5347 的 `INVALID_FILTER` / 400：read scope 由平台自己从 CEL 与库存 metadata 编出来，报 400 等于让调用方去修一个他既没写、也改不动的东西。继承的是**处置**（拒收），不是信封。

  极性表**同 PR 一起改**：`nullValueSatisfiesOperator` 的 `$null` / `$exists` 两臂从真值性（`Boolean(value)` / `!value`）改为恒等（`value === true` / `value === false`）。每张极性表钉的是它**自己**发射器的拼写（#5146 / #5298），只改发射器不改表，不变量会安静地断在定义处。这条差异消失后，本编译器与 `driver-sql` 的同名表第一次逐臂一致。

  ## ⚠️ 触达性：实测结论是**库存 metadata 走不通**

  定级依据是测量，不是立单时的措辞。`{ $null: <非布尔> }` **无法**从库存 metadata 走到本编译器，三道闸各自独立关死：`RowLevelSecurityPolicySchema` 把 `using` / `check` 声明为 `z.string()`（CEL 谓词，不是 FilterCondition），存对象直接被拒；CEL 下降只在两处发射 `$null` 且比较数是**硬编码布尔**（`== null` → `{$null: true}`，`!= null` → `{$null: false}`），`$exists` 一次都不发射；绕开 schema 塞裸对象会在 `sqlPredicateToCel` 里抛错，被 `getReadFilter` 的 catch 变成 `RLS_DENY_FILTER`。其余 read scope 生产者（Layer 0 租户过滤、`plugin-sharing` 的 `buildReadFilter`、controlled-by-parent、deny 哨兵）压根不含这两个算子。

  **仍然开着的那条**：`getReadScope` 是 `AnalyticsPluginOptions` 上有文档的公开扩展点，宿主自带的 read scope（来自 JSON 配置或没走类型检查的 JS）与本编译器之间没有任何闸 —— 本单也确认了 `plugin-security` 全路径无 `FilterConditionSchema` / `safeParse`。所以：今天不从库存 metadata 触达，但没有任何结构性的东西挡住下一个生产者。在编译器处拒收，才让「声明为布尔」等于「强制为布尔」，与谁写这条 scope 无关。

  ## ⛔ 一字未动的邻居

  - **合法布尔**：`$null: true/false`、`$exists: true/false` 的 SQL 逐字节不变（`IS NULL` 下降正是 RLS 用来圈无主行的写法，也是 CEL 唯一能产出的四种形状）。有自己的对照组回归 pin。
  - **比较数位置上的 `null`**：`{ d: null }`、`{ $eq: null }`、`{ $ne: null }`、`$in: [null]` 等 #6125 的 `NULL_CONTROL` 全部保持绿。
  - `driver-sql` / `driver-turso`（#5347 / #5369 已落地）、`packages/spec`（声明已是 `z.boolean()`）、以及本包的 `where` 门 `strategies/filter-normalizer.ts` 均未触碰。

- e15bf7e: fix(analytics): read scope 里的 `undefined` 比较数改为拒收，不再编成绑了 `undefined` 的合法 SQL (#6125)

  **⚠️ 行为变更。** `compileScopedFilterToSql` 遇到比较数位置上的 `undefined`，从「编出合法 SQL、绑一个 `undefined`、匹配零行、零日志」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。

  ## 实测到的毛病

  #6050 于 2026-08-07 裁定（B 案）：比较数位置的 `undefined` 一律拒收，并落在了**已证实可触达**的 `driver-sql` / `driver-turso` 两面。#6125 在同一轮把仓内其余求值面逐格实测，同一个形状拿到五种读法；本条改的是其中一格 —— `service-analytics` 的 `read-scope-sql.ts`。在 `d8e8d9cbc` 上把本次拒收关掉复测，alias `t`、字段 `d`，四格与 #6125 正文表一致：

  | read scope                    | 编译结果                                      | 绑定表        |
  | ----------------------------- | --------------------------------------------- | ------------- |
  | `{ d: undefined }`            | `"t"."d" = ?`                                 | `[undefined]` |
  | `{ d: { $gt: undefined } }`   | `"t"."d" > ?`                                 | `[undefined]` |
  | `{ d: { $in: [undefined] } }` | `"t"."d" IN (?)`                              | `[undefined]` |
  | `{ $not: { d: undefined } }`  | `NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))` | `[undefined]` |

  绑定表里是 JS 的 `undefined` 本身，不是 `null`：`applyReadScope`（`native-sql-strategy.ts`）在把 `?` 改写成 `$N` 时原样 `push(scopeParams[i])`。所以 NULL 是**驱动**对一个 JS `undefined` 的读法 —— 同一格在不肯猜的驱动上则是一句裸 `Undefined binding(s)` 崩溃。一次绑定、两种败法，取决于数据源恰好挂的是哪个驱动，这正是它该在编译器处拒收、而不是在某一个消费者处修补的理由。

  方向与 #6050 不同，如实记：那边是**越权**（`{ owner_id: ctx.user?.id }` 在 Turso remote 上编成 `IS NULL`，匹配全环境行）；这边是 fail-**closed** —— 匹配零行，永远不会多给行。所以它不是潜伏的权限绕过，#6125 也没有按那个级别定级。之所以照样拒收：一个「答了没人问的问题、且一条日志都不报」的 read scope，与一个真的生效了的 read scope 在外部完全无法区分。本次改动的价值就是把沉默变成响亮。

  ## 修法

  一道闸落在 `compileField` 的开头 —— 在 `quoteIdent` 之后（不安全标识符是注入向量，保留它自己的措辞与优先级），在任何 `bind()` 之前。

  拒收的**位置**逐个清点，因为「比较数」是位置而不是类型：直接比较数（`{ d: undefined }`）、单值算子的比较数（`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族）、列表算子数组的**成员**（`$in`/`$nin`/`$between`）。四格共用**一条**措辞，只有 `path` 不同（#5240「一个条件，一种措辞」）。

  信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #6050 的 `INVALID_FILTER` / 400：read scope 的 filter 由平台自己从 CEL 与库存 metadata 编译而来，不是调用方输入 —— 报 400 等于让调用方去修一个他既没写、也改不动的东西。消息里指名要修的是**生产者**（管理员写的共享规则 / 权限集、它的 CEL 下降、或进程内拼这条 FilterCondition 的代码），并按 #5367 只进日志、不进响应体。

  三个位置**故意不扫**，各自因为本模块已经用更贴切的诊断拒了它：`$null` / `$exists`（比较数是声明的布尔量，不是比较数位置）、直接位置上的裸数组（`compileField` 整体拒「用 `{ $in: [...] }`」）、以及约束对象里的非 `$` 键（那是嵌套关系，改写成 `null` 一样编不过 —— 这一条是与 `driver-sql` 孪生实现的唯一有意分歧，来自本模块拒收嵌套关系，而不是对 #6050 的另一种读法）。

  ## ⛔ `null` 一字未动

  `{ d: null }` / `{ $eq: null }` → `IS NULL`；`{ $ne: null }` → `IS NOT NULL`；`$null` / `$exists`、`$in: [null]`、`$nin: [null]`、`$between: [null, 5]`、`$contains: null`（`%null%`，#5526）、以及 `$not` 下的各式 —— SQL 与绑定表逐字节不变。这是本次改动唯一可能造成伤害的方向（模块里每张极性表都只用一个 `===` 把 `null` 与 `undefined` 分开），所以它有自己的对照组回归 pin。

  ## 刻意不动的邻居

  - ⛔ `@objectstack/formula` 把同一个 `undefined` 读作「这个键在记录里不存在」—— 那是**第三种语义**，不是第三个 bug 拼写，也正是 #5299 在争的问题。在这里顺手改掉等于替 #5299 拍板。
  - ⛔ `driver-memory` / `driver-mongodb` 维持 #5499 投入冻结，只 pin 不改。后果是本编译器与 `driver-memory` 在这一格上从此不一致 —— 这是裁决接受的代价，解冻时一并还，账记在 #6125。
  - ⛔ `driver-sql` / `driver-turso` 已由 #6050 落地，未触碰。

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- d17df80: **BREAKING — `dashboard.widgets[].compareTo` converges on the analytics executor's contract (#5011).**

  The widget declared three period-over-period arms with confident TSDoc. The analytics
  executor implements one shape, and it was never the same one — so on the ADR-0021 dataset
  path (the spec's own "single author-facing analytics shape") **all three arms were
  broken**, in two different ways:

  - `compareTo: 'previousPeriod'` / `'previousYear'` were **silently DROPPED** by the dataset
    renderer. The widget rendered its base numbers and the comparison the author asked for
    simply was not there.
  - `compareTo: { offset: '7d' }` was forwarded into `DatasetSelection.compareTo`, whose
    contract is `{ kind, dimension }` and has no `offset` in it — so the executor threw
    `compareTo requires a timeDimension "undefined"` and the whole widget errored out.

  All three worked on the legacy inline chart path. Same key, two fates, and the failing one
  was the path the spec calls canonical.

  `compareTo` is now a thin projection of the contract that is actually implemented:

  ```ts
  compareTo?: { kind: 'previousPeriod' | 'previousYear'; dimension?: string }
  ```

  There is no widget-side vocabulary left to drift from the executor's, so `declared =
enforced` holds by construction rather than by review.

  ## FROM → TO

  | v16                                        | v17                                     | Fix                                                                                                                                   |
  | :----------------------------------------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
  | `compareTo: 'previousPeriod'`              | `compareTo: { kind: 'previousPeriod' }` | `os migrate meta --from 16` rewrites it                                                                                               |
  | `compareTo: 'previousYear'`                | `compareTo: { kind: 'previousYear' }`   | `os migrate meta --from 16` rewrites it                                                                                               |
  | `compareTo: { offset: '1y' }`              | `compareTo: { kind: 'previousYear' }`   | `os migrate meta --from 16` rewrites it — `1y` **is** `previousYear`                                                                  |
  | `compareTo: { offset: '7d' \| '1M' \| … }` | **no faithful target**                  | State the window on the widget's own `filter` and compare with `{ kind: 'previousPeriod' }`, which shifts by that window's own length |

  The last row is deliberately _not_ rewritten. `previousPeriod` shifts by the length of
  whatever window the filter resolves to, which equals `7d` only when that window happens to
  be seven days — a mechanical rewrite would silently change which rows the comparison
  column counts, turning a loud failure into a wrong number. It is registered as the
  `dashboard-widget-compareto-offset` semantic migration; the schema rejects the key with the
  prescription in hand.

  Retired at the schema, so every old spelling is a parse error carrying its own upgrade —
  including the bare strings, which are dispatched by value so a _typo_ is still told it is a
  typo rather than told it "was removed".

  ## `dimension` is optional — resolved by the executor, not by a renderer

  Omit it and `dataset-executor.ts` resolves it, by its own long-standing criterion (a
  `timeDimensions` entry carrying a `dateRange`):

  - exactly one candidate → that one is shifted;
  - **zero** → a loud error: a comparison is only defined against a bounded window;
  - **two or more** → a loud error **listing the candidates by name**, never a silent
    first-wins. Picking `created_at` when the author meant `close_date` produces a comparison
    that is _wrong_ rather than _missing_, which is the failure nobody audits.

  This is a producer-side resolution rule, not consumer-side tolerance (Prime Directive
  #12): every caller — dashboard widget, report, raw `queryDataset` — gets the same dimension
  or the same error, and no renderer is ever in a position to guess one.

  ## Notes

  - `DatasetCompareTo.dimension` is now optional. Callers that always passed it are
    unaffected; callers that relied on the old "must be present" typing get a wider type.
  - The converged slot is **union-free**. That is not cosmetic: zod collapses a failed union
    into one bare `Invalid input`, so curated guidance written inside a union arm never
    reaches the author (#5014). This slot's prescriptions are top-level and do.
  - objectui's legacy inline chart path adapts separately (objectui#3337), which also deletes
    the `DatasetWidget` string-drop workaround this change makes unnecessary.

### Minor Changes

- 1792384: fix(service-analytics)!: 分析查询的 `where` —— `$not` 变 NULL-safe、`{$not:{}}` 变零行、`$or` 的 `{}` 析取项不再被丢 (#5325)

  `filter-normalizer.ts` 的 `buildNode` 是这个包里**第二份**同缺陷拷贝:第一份
  (`read-scope-sql.ts` 的 `compileNode`,RLS 读作用域)已由 #5297 修好,而这一份编译的是
  **作者自己写的 `where`** —— dashboard widget / dataset 的筛选器。两者是各自独立的函数,
  所以那一单合入后这三条仍然在。以 `driver-sql` 同一份 fixture 实测(4 行,行 3、4 的
  `stage` 为 NULL,行 3 的 `amount` 为 NULL,行 4 的 `owner` 为 NULL):

  | widget 的 `where`                                 | 改前取到的行 | 改后(= driver-memory / formula / #5296 后的 driver-sql) |
  | ------------------------------------------------- | ------------ | ------------------------------------------------------- |
  | `{ $not: { stage: 'won' } }`                      | `2`          | `2,3,4`                                                 |
  | `{ $not: { stage: { $in: ['won'] } } }`           | `2`          | `2,3,4`                                                 |
  | `{ $not: {} }`                                    | **全表**     | **零行**                                                |
  | `{ $or: [{ stage: 'won' }, {}] }`                 | `1`          | 全表                                                    |
  | `{ $not: { $or: [{stage:'won'},{owner:'u1'}] } }` | `2`          | `2,4`                                                   |

  **这是可观察的行为变更,不是内部重构 —— 已有的图表数值会变:**

  - **`{$not: {}}` 的 widget 此前画的是整个数据集,现在是零行。** `buildNode({})` 返回
    `null`(= 无约束 = TRUE),`$not` 分支的 `if (inner)` 因此为假,整条 `$not` 消失,
    WHERE 一个字都不发 —— 一条意思是「什么都不显示」的筛选器显示了全部。`NOT TRUE ≡ FALSE`,
    现在它编译成 `1 = 0`。
  - **`$not` 下 NULL 行的去留变了,所以图上的数字会变。** SQL 是三值逻辑而 `WHERE` 只保留
    TRUE,裸 `NOT (stage = ?)` 把 `stage` 为 NULL 的行全部丢掉;`driver-memory`、`formula`
    和(#5296 之后的)`driver-sql` 都把它们算进来。同一条 widget filter,在分析查询和普通
    `find()` 上给出不同的行集,取决于哪个后端接住它。#5146 已拍板 JS 家族的答案为准,本次
    按同一口径把守卫**下推到叶子**(`{col: {$null: false}}` / `{$or: [{col:{$null:true}}, …]}`,
    极性逐算子决定)。**受影响的图表数值会上升**(负向筛选现在包含空值行)。
  - **`$or` 里的 `{}` 析取项不再被丢。** TRUE 是 AND 的单位元但**吸收** OR,所以
    `{$or: [{stage:'won'}, {}]}` 整条为 TRUE;此前它被 `.filter(n => n !== null)` 丢掉,
    查询被静默**收紧**成剩余分支。
  - **空集合是布尔常量,不再是「没有谓词」。** `{stage: {$in: []}}` 此前编译成空子句
    → 无约束 → 画全表,现在是零行(`1 = 0`);`{$nin: []}` 不排除任何行。
  - **两处新的响亮拒收(此前静默放宽):** `$not` / `$or` / `$and` 的**非对象**操作数
    (`{$not: null}` 曾整条消失 → 等于不筛),以及**零个操作符的字段约束** `{a: {}}`
    —— 后者按 #5240 的拍板拒收,与 driver-sql / driver-memory / formula 一致;不这么做的话,
    「TRUE 吸收 OR」会把 `{$or: [{a: {}}, {b: 2}]}` 从 `b = 2` 放宽成全表。

  实现落在 normalizer 而不是某个 strategy:守卫在这一层是**结构**(多一个 `$null` 合取项),
  经 `filterNodeToCondition` 交给 ObjectQL 引擎后在**任何驱动上都成立**,包括本身不 NULL-safe
  的那些;只加在 raw-SQL 那条路径,等于说「分析查询的 `$not` 是什么意思取决于哪个驱动接住它」。
  代价是引擎路径会**双重加守卫**,已实测幂等(`NOT (c IS NOT NULL AND (c IS NOT NULL AND c = v))`
  与单层等价),只是 SQL 多一层冗余谓词。

  `NormalizedFilterNode` 因此新增布尔常量 kind —— 该联合此前只有 `leaf | and | or | not`,
  没有 FALSE 的表示法,这正是 `{$not:{}}` 只能编译成「什么都不发」的根本原因。三个编译器
  (`native-sql-strategy.compileFilterNode`、`objectql-strategy.filterNodeToCondition`、
  回显给浏览器的 `renderFilterNodeSql`)各自实现它;引擎路径用的是 `{$not: {}}`,即
  driver-sql / formula / driver-memory 参考匹配器早已钉住的零行写法(#5134),没有另造第二种。

  `$and: []` / `$or: []` 的空组合子**不在本次范围**,仍然 fail-closed 抛错(独立裁定见 #5322),
  并已加用例钉在抛错这一侧。

- 1f0e7cb: fix(service-analytics): reject a dataset's cross-datasource JOIN when it is compiled, not when it is queried (#5115)

  #5033 routed a dataset's raw SQL to its base object's own datasource, which
  turned a JOIN whose target lives in another database into a **loud query-time
  failure** — correct, but late: the dataset can still be saved, published and
  put on a dashboard, and the failure lands in front of whoever opens that
  dashboard, usually in another environment on another day. It is a pure metadata
  error, decidable the moment the dataset is compiled: the whole dataset is
  lowered into ONE statement on the base object's datasource, so a join target
  bound elsewhere is simply not there.

  `compileDataset` now decides it. `AnalyticsService.registerDataset` — the single
  door every dataset passes through, whether pre-registered at boot, saved, or
  previewed as a Studio draft — hands the compiler the datasource and federation
  probes that already existed on `AnalyticsServiceConfig`, and a proven conflict
  is rejected before any SQL is built. The message names both objects, both
  datasources, the offending `include` path, and the two ways out (bind both
  objects to the same datasource, or drop the relationship), in the same wording
  family as the #5033 query-time diagnostic so the two never read as two bugs.

  **Who is affected.** This is a tightening: a dataset that used to compile and
  then fail (or, before #5033, silently read the wrong database) now fails at
  registration. It fires only where the metadata _proves_ the conflict — the base
  object and a join target each declare an explicit `object.datasource` and the
  two names differ. A dataset registered at boot is skipped with a WARN naming the
  conflict, as before; the rest of the host's datasets still register.

  **What is deliberately not rejected** ("cannot answer, do not block", the same
  tiering as `isRegisteredObject` / `getObjectFieldNames`):

  - a host that wires no datasource probe at all (no data engine) — compiles
    exactly as it did before;
  - either side leaving `datasource` at its default. `'default'` is the schema's
    default _value_, not a routing decision: `ObjectQL.getDriver` short-circuits
    only on an explicit non-`'default'` name, then falls through to
    `datasourceMapping` rules, the ADR-0057 §3.6 lifecycle split
    (audit/telemetry/event) and the owning package's `defaultDatasource` — none of
    which are visible to the compiler. Treating `'default'` as "the primary DB"
    would reject datasets whose objects a mapping rule in fact lands on the _same_
    database;
  - a federated (external) participant on either side. `NativeSQLStrategy` already
    declines such a cube (ADR-0062 D6), so the query is served by the ObjectQL
    FK-expand path, which crosses datasources by construction.

  Everything not proven here keeps failing loudly at query time via #5033.
  Making cross-datasource dashboards actually _work_ (declining in
  `NativeSQLStrategy` and serving the join with two reads) is separate and not
  part of this change.

### Patch Changes

- c637387: fix(service-analytics): only a canonical numeric spelling is recovered as a number, so `'007'` / `'1.50'` stay strings (#5528)

  An analytics `where` round-trips every comparand through the internal
  `values: string[]` form — `stringifyForCube` on the way out, and
  `coerceFilterValueForSql` / `coerceFilterValueForObjectQL` on the way back. The
  decoder decided "this is a number" from the string's **shape** alone
  (`/^-?\d+(\.\d+)?$/`), which cannot distinguish a number that was stringified on
  the way out from a string the author actually wrote.

  Measured before the fix, on cube `orders` / TEXT column `code`:

  | author's `where`        | leaf `values` | SQL bind | engine comparand |
  | ----------------------- | ------------- | -------- | ---------------- |
  | `{code: {$eq: '007'}}`  | `["007"]`     | `7`      | `7`              |
  | `{code: {$eq: '0912'}}` | `["0912"]`    | `912`    | `912`            |
  | `{code: {$eq: '1.50'}}` | `["1.50"]`    | `1.5`    | `1.5`            |

  Both consumers were affected: the raw-SQL bind in `NativeSQLStrategy` and the
  comparand handed to the ObjectQL aggregate engine.

  The failure was **silent and mis-targeted, not empty**. Against a text column
  SQLite applies the column's affinity to the integer bind, so a widget filtered on
  order number `'007'` returned the row storing `'7'` — a different row, with no
  error to read; on Postgres the same query is a `text = integer` type error, and on
  the engine path the strict comparison simply matched nothing (measured: 0 rows).
  Zero-padded and trailing-zero strings are ordinary business shapes — order
  numbers, work orders, SKUs, dialling codes, postcodes, `'1.50'` prices.

  Recovery is now limited to a number's **own canonical spelling**
  (`String(Number(s)) === s`):

  - a comparand that really was a number is `String(n)` by construction, so it
    still round-trips — `7` → `'7'` → `7`, `1.5` → `'1.5'` → `1.5`, `-3` → `-3`;
  - a string `Number()` would rewrite — `'007'`, `'0912'`, `'1.50'`, `'1.0'`,
    `'-0'`, or more digits than a double holds — cannot have come from a number, so
    it stays the string the author wrote.

  The narrowing can only ever **remove** recoveries: the shape regex still runs
  first, so `'1e3'`, `'1e+21'`, `'+7'`, `' 7'`, `'0x10'`, `'Infinity'` and `'NaN'`
  were strings before this change and are strings after it. This also aligns with
  ADR-0053 D-A2, which demoted this textual type re-derivation to a last resort
  behind the driver-backed `coerceTemporalFilterValue` hook.

  **Stopgap, and named as one.** `values: string[]` still has no escape, so the
  author strings `'null'` / `'true'` / `'false'` still collide with the tokens the
  encoder writes for the real `null` and booleans. Making the round trip lossless —
  tagged values, or an `unknown[]` internal representation — is #5526; the
  collision is pinned as unchanged in
  `src/__tests__/filter-value-canonical-number.test.ts` so it is not mistaken for
  fixed.

- c113690: fix(service-analytics): `contains` 以规范算子 `$contains` 送进引擎,比较值不再落进正则位置(#5557)

  `ObjectQLStrategy.convertFilter` 在同一个 `switch` 里处理 LIKE 家族的四个算子。
  其中三个(`notContains` / `startsWith` / `endsWith`)自 #4128 起就是规范 spec 算子,
  只有 `contains` 是 `{ $regex: values[0] }` —— 比较值**原样**放进一个正则位置,不转义。

  实测(修复前 → 修复后,引擎收到的 filter):

  | `where`                          | 修复前                           | 修复后                        |
  | -------------------------------- | -------------------------------- | ----------------------------- |
  | `{stage: {$contains: 'a.b'}}`    | `{stage: {$regex: 'a.b'}}`       | `{stage: {$contains: 'a.b'}}` |
  | `{stage: {$notContains: 'a.b'}}` | `{stage: {$notContains: 'a.b'}}` | 不变                          |
  | `{stage: {$startsWith: 'a.b'}}`  | `{stage: {$startsWith: 'a.b'}}`  | 不变                          |
  | `{stage: {$endsWith: 'a.b'}}`    | `{stage: {$endsWith: 'a.b'}}`    | 不变                          |

  三条后果,都是作者没有要求过的行为,且都不依赖 #4706 对 `$regex` 语义的裁决:

  1. **`$regex` 不在契约里。** `filter.zod.ts` 的 `FILTER_OPERATORS` 声明 15 个算子,
     没有 `$regex` —— 这是**生产方**在发送 schema 未声明的算子。按 Prime Directive #12
     修生产方(一个 `case` 标签),而不是给消费方加宽容。
  2. **同一棵过滤树在同包两个消费方之间不通。** `read-scope-sql.ts` 的
     `compileScopedFilterToSql` 也是一个 `FilterCondition` 消费方,`compileOperator`
     的 `default` 是 fail-closed,于是它对本策略产出的 filter 直接抛
     `unsupported operator "$regex" … (fail-closed)`。
  3. **行结果取决于哪个驱动来答。** 把 `$regex` 当真正则求值的后端(driver-memory 的
     `memory-matcher.ts` 就是,而且是有意为之 —— 服务 plugin-auth 的 ObjectQL adapter)
     把 `a.b` 读成「a、任意一个字符、b」,于是 `axb` 也被匹配上;而 `50% (+)` 作为正则
     根本编译不过(`Nothing to repeat`),`catch` 之后 `return false` —— 一个**有匹配行**
     的筛选器静默返回零行,作者那边只看到「无数据」。同一个 `$contains` widget 在
     `driver-sql` 上则被编译成子串 LIKE:同一张 dashboard,不同驱动,不同行集。

  `filter-normalizer.ts` 的 `MONGO_TO_CUBE_OP` 只把 `$contains` 映到 `contains`,
  别无来源,所以这里回送 `$contains` 就是作者自己那个 key 的往返。

  **测试**(`objectql-contains-canonical-operator.test.ts`,新增):引擎 filter 的算子键
  逐个对 `filter.zod.ts` 的 `ALL_OPERATORS` 校验(取自 spec 而非手抄一份);行结果跑在一个
  复刻 `memory-matcher.ts` 各 arm 的求值面上 —— `a.b` 只命中字面行、`50% (+)` 命中它该
  命中的那一行且**恰好**只有那一行(修复前分别是多一行和空集);同一个 filter 再送进
  `compileScopedFilterToSql` 确认它现在编译得过。只断言 filter/SQL 字符串会漏掉「不转义」
  这一半,所以两半都断言。

  顺带删掉 #5558(PR for #5333)在 `objectql-echo-operator-coverage.test.ts` 的替身引擎里
  留下的那处 `$regex` → `$contains` 翻译:它存在的理由就是本单,现在没有了。那也是本修复
  最直接的反向证据 —— 把 `case 'contains'` 退回 `$regex`,该文件的 `$contains` 行会以
  上面第 2 条的 fail-closed 报错红掉。

- 705efeb: fix(analytics): a dataset refusal that declares an ADR-0112 envelope is never degraded to an empty result (#5717)

  `queryDataset` wraps execution in a catch that exists for one deliberate reason
  (#5033): a widget whose backing object is not mounted in this kernel renders
  "no data" instead of failing with a 500. The criterion for "not mounted" was
  `isMissingSourceError` — a substring match over the error MESSAGE. So the
  leniency was available to any error that happened to phrase itself like a
  driver, and #5352 / #5367's finding on the REST face — "the wire shape of an
  error family must not be a property of its wording" — applied here one level
  worse: the outcome was not a wrong status code but a **silent empty result**.
  No exception, no 4xx, no 5xx; one `warn` line and a confident empty chart, which
  is the "populated table, Total Spend: 0" symptom #5033 was filed about.

  One refusal already matched. `dataset-compiler.ts` refuses an `include` naming a
  relationship the object graph does not have with

  > `[dataset-compiler] dataset "X" includes relationship "R" which does not exist on object "O".`

  which carries both `relation` (inside "relationship") and `does not exist` — and
  that conjunction was the postgres limb. It has never gone off for one reason:
  `queryDataset` compiles **before** the try, so that throw has never been inside
  the catch's reach. A mine, wired and unarmed.

  **Two independent defences, so the disarming does not depend on either one.**

  - **The criterion (main change).** An error carrying an ADR-0112 envelope —
    numeric `status` + non-empty `code`, the same structural fact
    `rest-server.ts`'s `/analytics/dataset/query` catch reads — is re-thrown
    untouched, ahead of any message inspection. Its producer already answered the
    classification question. The status RANGE is deliberately not part of the
    test: a `DATASET_INVALID` / 400 rendered as an empty grid is the loud case,
    but a declared 5xx (`READ_SCOPE_COMPILE_FAILED` — an RLS lowering that failed
    closed) is if anything worse to swallow, since nobody is told at all.
  - **The sniffer.** Its postgres limb is now anchored to postgres's actual
    wording (`relation "x" does not exist`) instead of "any sentence containing
    both words" — the same pattern the sibling `missingSourceRelation` already
    used, so "is something missing" and "what is missing" can no longer disagree.

  **Observable behaviour change — read this if you alert on empty widgets.** The
  guarantee is new, not the status of any shipped message: measured over the 13
  real wordings this repo carries (three driver families including sql-prefixed
  and schema-qualified forms, the framework's not-registered signals, and this
  package's own refusals), exactly one verdict moves — the compiler refusal above,
  which reaches callers as `400 DATASET_INVALID` either way because its throw site
  sits outside the try. What changes is that a caller-shaped refusal raised
  **during execution** can no longer become `{rows: [], fields: [], totals: []}`
  by phrasing alone: it now propagates and the route answers its declared code
  (4xx as itself, declared 5xx through `ANALYTICS_QUERY_FAILED`). A dashboard that
  silently rendered an empty chart for such a refusal will now surface the error.

  **#5033's leniency is untouched, and that is asserted rather than claimed.** A
  bare driver error is still classified by its words and still degrades: `no such
table` (sqlite/libsql), postgres's real `relation "x" does not exist`, mysql's
  `doesn't exist`, the framework's not-registered signals — and a bare error
  naming a JOINED table still fails loudly as a cross-datasource dataset. Those
  cases are green in all four states of the reverse verification
  (`dataset-degradation-envelope.test.ts`), including with both defences reverted.

  The compile point deliberately stays outside the try. Moving it in would newly
  expose the compiler's own bare invariants and the host-supplied relationship
  resolver to this degradation path — widening leniency in the opposite direction
  from the fix.

- 978fed2: fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

  `POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
  families because the route recognised their **prose**, not because the errors
  said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
  (`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
  list of message substrings behind it, since all six producers were still bare
  `throw new Error(…)`:

  ```
  /not declared in the dataset|not backed by a declared relationship|
   not supported by the v1 dataset runtime|read-scope-sql|
   not a selected dimension or measure|is not a subset of the selected dimensions/
  ```

  That made the HTTP status of six families a property of their wording.
  Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
  no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
  different family, and no test and no gate would have gone red. Prime Directive
  #12 permits an accommodation like that only while it is declared, loud, tested
  **and removable on a schedule**; #5366 delivered the first three and nothing
  carried the fourth.

  **Five producers now declare their own verdict.** A new
  `dataset-refusal.ts` in `@objectstack/service-analytics` exports
  `datasetInvalidError` — the same shape as that package's existing
  `invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
  (`INVALID_FIELD` / 400) — and five sites throw through it:

  - `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
    a dimension/measure traversing a relationship path the dataset never declared
    in `include`;
  - `dataset-executor.ts` — an `order` key that is not a selected dimension or
    measure; a `totals` grouping that is not a subset of the selected dimensions;
  - `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

  Their five entries are gone from the route's list, which is now a single
  `read-scope-sql` test.

  **`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
  read-scope lowering failures whose inputs are an admin-authored policy and a
  compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
  request is invalid") may well be the wrong verdict and choosing the right one is
  a separate judgement, still tracked by #5367. Deleting the entry before that
  judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

  **No outward behaviour change for the five.** They answered
  `400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
  message; what changed is the mechanism, from message-matching to the producer's
  own declaration. The one visible difference is for a bare `Error` that merely
  _resembles_ one of those messages: it is no longer promoted to a 400. That is the
  point — a phrase is no longer a classification.

  `DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
  ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
  constructor types it as `RegisteredErrorCode` so an unregistered code is a
  compile error rather than a body some route rejects at runtime.

  Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
  five refusals against its real producer — the refusal SET first, green before and
  after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
  drives all five end-to-end through a real `AnalyticsService` with positive
  controls on both the aggregate and raw-SQL paths; and
  `analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
  — the five messages answer 400 when enveloped and 500 when bare, so re-adding a
  regex entry turns it red.

- c36abfe: fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

  #4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
  the field, because a driver error class must never be the caller's `error.code`
  for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
  identical typo one request key over still reached the driver as a `GROUP BY`
  column:

  ```
  POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437
  POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
  → 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
  ```

  **The gate.** `ensureCube` now runs `assertDimensionFields` alongside
  `assertMeasureFields` on every path, so a dimension whose source column the
  backing object does not have is refused **before** any SQL is built, with the
  same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
  `field` / `object` / `param`, a message naming the field, the valid dimensions,
  and the object's known field list. `query`, `generateSql` and `queryDataset` are
  all covered, and a rejected query leaves nothing behind in the cube registry.
  `timeDimensions` are covered too — they resolve through the same
  `cube.dimensions` bag and produced the same 500 — with `param` reporting which
  request key carried the bad name.

  **What deliberately did not change:** grouping by a REAL field the cube never
  declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
  "does the _object_ have this field", never "did the cube declare this
  dimension". A cube whose `sql` is an expression, a dotted relation dimension,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure gate stands down.

  **The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
  5xx body and echoed the error message verbatim. Knex prefixes the offending
  statement to its message, so the caller received the generated SQL — physical
  table and column names included:

  ```
  500 {"code":"ANALYTICS_QUERY_FAILED",
       "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
  ```

  The sibling face never leaked it: `/analytics/query` exits through the
  dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
  to every >= 500 message since #3867. That same predicate now guards this route's
  500 body. Classification is untouched — the status stays 500, the code stays
  `ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
  message list are unchanged — and the full text still reaches server logs. A 500
  whose message does not look like driver output keeps its prose.

- 9ecdca9: fix(service-analytics): `/analytics/sql` 回显补上 `$startsWith` / `$endsWith` 谓词(#5333)

  `ObjectQLStrategy.generateSql` 是同一棵过滤树的**第三个**编译器 —— 输出给浏览器的
  展示 SQL。它的 `buildFilterClauseSql` 显式处理 `set`/`notSet`/`in`/`notIn`/
  `contains`/`notContains`,其余落到只有六个条目的 `SCALAR_SQL_OPS` 查表;
  `startsWith` / `endsWith` 两处都不在,于是走到 `return null`,而**这棵树的每个编译器
  都把 `null` 读成「本节点没有约束」**。结果:

  | `where`                       | 实际执行(`NativeSQLStrategy`)    | 修复前的回显                    | 修复后的回显                     |
  | ----------------------------- | -------------------------------- | ------------------------------- | -------------------------------- |
  | `{stage: {$startsWith: 'w'}}` | `WHERE stage LIKE $1` / `['w%']` | **没有 WHERE**,`params` 为空    | `WHERE stage LIKE $1` / `['w%']` |
  | `{stage: {$endsWith: 'n'}}`   | `WHERE stage LIKE $1` / `['%n']` | **没有 WHERE**,`params` 为空    | `WHERE stage LIKE $1` / `['%n']` |
  | `{stage: {$contains: 'w'}}`   | `WHERE stage LIKE $1`            | `WHERE stage LIKE $1`(本来就对) | 不变                             |

  回显比实际执行的查询**更宽**。这个字符串存在的唯一理由就是复现执行 —— 文件自己在渲染
  块顶上写着 “a rendering that contradicts execution is worse than no rendering” ——
  所以一个带着「为什么这张图少了几行」来看回显的作者,拿到的是一条**没有该筛选条件**的
  语句:跑一遍返回更多行,于是结论是「筛选器没生效」,而实际执行是生效的。与
  #3601 / #3602 / #3650 同一类「回显与执行不一致」,只是这次是从**算子表**这一侧到达的。

  不涉及越权或错行:该字符串从不执行(`execute()` 的 echo 会丢弃 `params`),损害限于
  可调试性。

  **两处修改:**

  1. **LIKE 家族收进一张表。** 新增 `LIKE_SQL_OPS`,四个算子(`contains` /
     `notContains` / `startsWith` / `endsWith`)的 SQL 拼写与 pattern 并排放在一起,
     与 `NativeSQLStrategy.buildFilterClause` 的 `opMap` / `likePattern` 逐条对应 ——
     回显描述的正是那个编译器产出的语句,两张表并列摆着,漂移才看得见。
     `contains` / `notContains` 的产物一字未变。

  2. **「渲染不了就静默丢」的出口改为 THROW。** `return null` 在这里与「无约束」同形,
     所以下一个新增算子会以同样的方式再丢一次。之所以**可以**抛错:上游算子词汇表是
     **封闭**的 —— `filter-normalizer.ts` 的 `fieldLeaves` 是叶节点的唯一生产者,它对
     `MONGO_TO_CUBE_OP` 之外的算子在建叶之前就以 `INVALID_FILTER` / 400 拒绝。因此任何
     调用方写出的过滤器都到不了这个出口;真到了,只能意味着 normalizer 的表新增了这里
     没有分支的算子,那是我们自己两张表漂移,而对此**唯一不能给的答案就是悄悄放宽作者的
     查询**。与 `convertFilter` 的 `default:` 分支在 #4128 做出的是同一个选择;刻意**不**用
     `invalidFilterError` 的 400 信封 —— 这不是调用方形状的错误。

  **该 throw 出口今天从公共入口不可达,这一点是测过的、也是刻意报告的**:把它改回
  `return null`(保留第 1 项修改)只会让它自己那一条断言变红,枚举断言和回显对照表
  全部保持绿色。它是一个漂移探针,不是行为修复 —— 行为修复是第 1 项。

  新增 `objectql-echo-operator-coverage.test.ts`:issue 那张对照表按**行结果**钉住
  (回显语句在同一份 fixture 上真的被执行,行 id 与查询实际返回的行 id 比对 —— 丢掉的
  谓词藏不住,它返回的正是筛选器排除掉的行),再按 `filter.zod.ts` 的
  `FILTER_OPERATORS` 枚举全部 15 个可编写算子,逐个断言回显渲染出谓词、且
  placeholder 与 `params` 对齐。只断言 SQL 字符串会放过下一个未映射的算子 —— #4128 里
  `$between` 就藏在 `$startsWith` 后面。

- cfc293f: fix(service-analytics): 空 `$and` / `$or` 按布尔单位元归约,两个编译器与五后端对齐 (#5322)

  同一个仓库对空组合子曾有两个对立答案:五个 `FILTER_LOGIC_CASES` 后端
  (`driver-sql` #5134/PR #5243、`driver-memory`、`formula`、`driver-sqlite-wasm`、
  `driver-mongodb` #5239)把 `{ $and: [] }` / `{ $or: [] }` 归约成布尔单位元,而
  service-analytics 的两个编译器 —— `read-scope-sql.ts` 的 `compileNode` 与
  `filter-normalizer.ts` 的 `buildNode` —— 成文地 fail-closed 抛错("An empty
  combinator has no defensible reading…"),并有 pin 测试钉住。2026-08-04 维护者拍板
  (#5322)取单位元,本次把两处对齐:

  - `{ $and: [] }` = TRUE(全部行,AND 单位元);`{ $or: [] }` = FALSE(零行,OR
    单位元)。嵌套可归约:空组合子作 `$or` 分支时按 TRUE 吸收/FALSE 退出析取,作
    `$not` 操作数时取反(`{$not: {$and: []}}` = 零行、`{$not: {$or: []}}` = 全部
    行)。`{}` = TRUE 与 `{ $not: {} }` = 零行两格已由 #5297(read-scope)/#5325
    (normalizer)先行落地,本次连同这四格由同一张一致性表钉住。
  - **迁移含义**:过去发出空组合子的调用方收到的是抛错(REST 面上是一次失败的请
    求);现在按上表求值。`{ $or: [] }` 在 RLS/图表场景是 fail-closed 的 —— 析取列
    表循环出零项时隐藏全部行,而不是放行全表。写作期对字面量空组合子的响亮拒收另立
    #5330(publish/lint),不在运行期。
  - **没有放宽的部分**:非数组的 `$and`/`$or`、非对象的分支、非对象的 `$not` 操作数
    仍然抛错(#5325 的形状拒收原样保留)。归约让「无约束」成为有意义的裁决,静默把
    畸形分支读成 TRUE 会让垃圾析取项吸收 `$or` 而放宽查询,所以畸形形状保持响亮。
  - 归约与 #5146/#5325 的 NULL-safe `$not` 重写的组合语义是「先归约、后 NULL-safe」
    —— 常量归约出的单位元不受重写影响,幸存的叶子照常加守卫,有测试钉住。
  - `packages/spec`:`FILTER_LOGIC_CASES` 补四条布尔单位元行(空 `$and`、空 `$or`、
    `{}` 析取项吸收、`{$not: {}}`),两个 analytics conformance suite 与五后端从此
    被同一张表钉住这四格。

- de70b42: analytics: `$ne` / `$nin` / `$notContains` in a dashboard `where` keep the rows that have no value

  Second batch of the #5298 ruling, after PR #5962 landed it on `driver-sql`,
  `read-scope-sql` and `formula`. An analytics filter meaning "not this" now
  returns the rows whose column is empty, the same answer every other backend
  gives — a `stage != 'won'` widget shows the deals with no stage set.

  The Cube face was the last surface still splitting on it, and it split three
  ways for one filter. Measured on the package's own fixture before the change,
  for `{stage: {$ne: 'won'}}` with rows 3-4 carrying a NULL `stage`:

  | compiler                            | was     | now     |
  | ----------------------------------- | ------- | ------- |
  | `NativeSQLStrategy` raw SQL         | `2`     | `2,3,4` |
  | `ObjectQLStrategy` display-SQL echo | `2`     | `2,3,4` |
  | `ObjectQLStrategy` engine condition | `2,3,4` | `2,3,4` |

  The engine column was already right — because `driver-sql` guards for itself
  since #5962, not because the analytics layer did — so which rows a widget drew
  depended on which compiler downstream caught the leaf, and the `/analytics/sql`
  echo described a narrower query than the one that ran.

  `filter-normalizer` now emits the guard as tree STRUCTURE (an `or` of the null
  predicate with the comparison) rather than as a SQL trick in one strategy, so
  all three compilers of that tree produce one predicate and none of them needs
  to know the rule. Which operators are guarded is decided by the polarity table
  the `$not` rewrite already consults, not by a second list of operator names:
  positive comparisons (`$eq`, `$in`, `$contains`, the ordering family) compile
  byte-identically to before, `$ne: null` stays `IS NOT NULL`, an empty `$nin`
  stays the TRUE constant, and `{$not: {stage: {$ne: 'won'}}}` still means
  "stage is won" rather than widening.

  `FILTER_LOGIC_CASES` is unchanged: the `$ne` and `$not` null rows enrol in
  #5903's PR, which clears the last backend (`driver-turso` remote). The spec
  table's measured blocker matrix drops the Cube row it no longer describes.

- 2f6516e: fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

  Misspell an operator in a dashboard widget's filter and analytics refuses it —
  correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
  argued for one refusal at a time: dropping a predicate the compiler cannot
  express does not narrow the query, it **widens** it to rows the author excluded,
  and a chart drawn over the whole dataset looks like a working chart.

  The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
  — read as "the platform is broken" rather than "your filter has a typo", and
  counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
  `400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
  chosen by which face happened to catch it.

  **One defect, two halves — either alone leaves it unfixed.**

  - **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
    `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
    `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
    becomes the module's only way to refuse.
  - **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
    discarded `error.code` / `error.status` and re-derived the classification from
    a hardcoded list of message substrings — so a producer that took ADR-0112
    seriously was punished for it. It now reads the envelope **first**; the
    substring list is demoted to a fallback for the families that still carry no
    envelope.

  **Observable behaviour change — read this if you alert or retry on status.**
  The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
  `400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
  already declared an envelope this route was discarding, `400 INVALID_FIELD` for
  a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
  unregistered cube). Monitoring that counted these as server faults will see the
  5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
  retrying a request that could only ever fail the same way. Both are the intended
  correction — the condition was always the caller's mistake — but they are
  visible, so they are stated rather than buried.

  **Which inputs are refused did not change.** This changes the SHAPE of the
  error and nothing about the judgement that produced it: no refusal condition
  was touched, no input that used to compile now refuses, and no input that used
  to refuse now compiles. That claim is pinned input-by-input (refusals _and_
  accepted inputs with their compiled trees) in
  `filter-refusal-envelope.test.ts`, which is green both before and after the
  change — only the envelope assertions move.

  The message-substring list survives on purpose. All six of its entries were
  re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
  `dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
  families from `400 DATASET_INVALID` to 500. It is a placeholder for their
  enveloping, not a second classification mechanism, and it is now documented as
  such: a new refusal should carry a `code`/`status` and be served by the
  envelope branch for free. The passthrough is deliberately **4xx-only** and
  requires **both** `code` and `status`, so an internal fault can never be
  re-labelled as the caller's fault, and this route never invents a code a
  producer failed to supply.

- e6b1bb0: fix(service-analytics): 过滤值不再被降级成字符串 —— `{code: {$eq: '007'}}` / `'null'` / `'true'` 按作者写的字面值绑定 (#5526)

  analytics 的 `filter-normalizer` 内部把每个比较数(comparand)压成 `values: string[]`
  再由消费方**猜**回类型:出口是 `stringifyForCube`,入口是 `recoverNumber` 与
  `coerceFilterValueForSql` / `coerceFilterValueForObjectQL`。字母表是"全体字符串"、
  解码规则是"这串看起来像不像数字/布尔/null"的编码没有任何转义机制,于是作者写的字符串
  和编码器为其他类型写下的 token 撞车。`{code: {$eq: v}}` 在 `main` 上实测:

  | 作者的 `v` | SQL 绑定          | 引擎绑定          |
  | ---------- | ----------------- | ----------------- |
  | `'007'`    | `7`(#5528 已修)   | `7`(#5528 已修)   |
  | `'1.50'`   | `1.5`(#5528 已修) | `1.5`(#5528 已修) |
  | `'null'`   | 真 NULL           | 真 `null`         |
  | `'true'`   | `1`               | `true`            |

  每一行都是一个缺陷:存着作者那种写法的 TEXT 列不再匹配。`'007'` 在 SQLite 上是
  整数与 TEXT 列的跨类型比较、恒不相等,在 Postgres 上 `text = integer` 直接报类型错;
  `'null'` 那一行比"空"更糟 —— 与真 NULL 的比较对任何行都是 UNKNOWN,图表永远画不出东西。
  零填充串、当枚举码用的 `'true'`/`'false'`、当字面标签用的 `'null'` 都是真实业务形状
  (订单号、SKU、邮编、国际长途区号)。

  **修法**:`NormalizedFilterNode` 的 leaf `values` 由 `string[]` 改为 `unknown[]`,
  作者写的值原样穿过整棵树,不再有任何东西去解码它。仅在边界真正要求时才转换:

  - `toSqlBindValue`(唯一留下的转换,且是**单向**的:值 → 它的 SQL 绑定形态,不是解码器)
    ——只处理驱动绑不了的 JS 类型:`boolean` → `1`/`0`(better-sqlite3 拒绝 JS 布尔)、
    `Date` → ISO 文本、其他对象 → JSON 文本。它不检查任何字符串。
  - LIKE 族的比较数被 `filter.zod.ts` 声明为 `z.string()`,所以在发射点字符串化 ——
    与 `driver-sql` 的 `applyLike` 同一个 `String(value)`,两个面上 `$contains` 仍是一件事。

  ObjectQL 引擎路径现在不需要任何转换:引擎按**存储**的运行时类型比较,而它拿到的就是
  作者写的值。`stringifyForCube` / `recoverNumber` / `coerceFilterValueForSql` /
  `coerceFilterValueForObjectQL` 一并删除。

  两处读法作为直接后果改变了,方向都是 fail-closed:

  - `{name: {$contains: null}}` 原先编译成 `LIKE '%%'` —— 匹配**每一个**非 NULL 行,
    因为 `stringifyForCube(null)` 是 `''`;现在是 `LIKE '%null%'`,与 `driver-sql`
    一直以来的编译结果一致。
  - `{amount: {$gt: null}}` 原先编译成 `amount > ''`(一次针对空字符串的真实比较);
    现在绑定 NULL,谓词为 UNKNOWN、图表画不出行 —— 无序比较数的诚实答案,也是
    `driver-memory` / `formula` 给出的答案。(#5332 明确指出这个比较数位置没有任何裁决
    覆盖、`''` 只是占位符;删掉编码器就按构造把它定了。)

  `timeDimensions[].dateRange` 的两个边界现在按 spec 声明的类型(`string[]`)原样传递:
  原先它们也过 `coerceFilterValueForObjectQL`,其文档宣称"epoch-ms 边界会还原成数字"——
  那是消费方在宽容地兜一个契约并未声明的形状,和把 `'007'` 读成 `7` 是同一个猜测
  (Prime Directive #12:epoch-ms 窗口要么在生产者、要么在 spec 里声明,不在这里猜)。

  `{stage: null}` / `{$eq: null}` / `{$ne: null}` / `{$null:}` / `{$exists:}` 的空值
  谓词语义(#5332 / #5525)不变:真 `null` 比较数编译成 `notSet` / `set`,从不进入
  `values`。#5567 的 LIKE 转义契约不变。

- a7b854f: fix(service-analytics): the three SQL compilers compare LIKE values literally (#5567)

  `$contains` / `$notContains` / `$startsWith` / `$endsWith` build a `LIKE` pattern
  around the comparand the author wrote. All three of this package's SQL compilers
  concatenated that comparand straight into a wildcard position — no escaping, no
  `ESCAPE` clause — so `_` (LIKE's single-character wildcard) and `%` (its
  multi-character one) stopped being literals. Measured on real SQLite, over the
  rows `x_admin` / `xyadmin` / `off 50% now` / `off 5012 now`:

  | `where`                         | returned    | correct |
  | ------------------------------- | ----------- | ------- |
  | `{name: {$contains: '_admin'}}` | `['1','2']` | `['1']` |
  | `{name: {$contains: '50%'}}`    | `['3','4']` | `['3']` |
  | `{name: {$startsWith: 'x_'}}`   | `['1','2']` | `['1']` |
  | `{name: {$endsWith: '0% now'}}` | `['3','4']` | `['3']` |

  Every row is a **widening** — rows the author excluded came back — and
  `$notContains` is the mirror image, excluding rows the author kept. One of the
  three call sites is the ADR-0021 D-C read-scope (tenant + RLS) lowering, where a
  wider predicate is over-reach rather than a loose filter (the #5347 / #5324
  ruling on that same file). Prime Directive #3 forces machine names to
  `snake_case`, so essentially every machine-name comparand carries a `_` and hit
  this silently.

  All three compilers now escape the comparand and bind an explicit
  `ESCAPE` argument, matching what `driver-sql`'s `applyLike` has always done — so
  the same filter selects the same rows whichever strategy answers, and the
  `/analytics/sql` echo describes the statement that ran instead of a wider one.

  **No authoring change.** A comparand with no `_`, `%` or `\` binds exactly the
  pattern it bound before; only its meaning when it _does_ carry one changes, from
  wildcard to literal. If you were relying on a comparand acting as a wildcard,
  that was never a declared capability of these operators — the spec describes them
  as substring / prefix / suffix matches — and `driver-sql` already read it
  literally, so the reading you got depended on which strategy served the query.

- f56ebea: fix(service-analytics): a `null` comparand in an analytics `where` is a null predicate, not `= ''` (#5332)

  `{stage: null}` compiled to `stage IS NULL`, while `{stage: {$eq: null}}` — the
  same predicate — compiled to `stage = $1` binding the empty **string**. One
  meaning had two answers inside one file: the bare-`null` spelling took
  `fieldLeaves`' `raw === null` branch, the operator spelling fell through to the
  `MONGO_TO_CUBE_OP` map, and `stringifyForCube(null)` handed it `''`.

  Measured before the fix, on cube `deals` / column `stage`:

  | `where`                  | WHERE           | bindings |
  | ------------------------ | --------------- | -------- |
  | `{stage: null}`          | `stage IS NULL` | `[]`     |
  | `{stage: {$eq: null}}`   | `stage = $1`    | `['']`   |
  | `{stage: {$ne: null}}`   | `stage != $1`   | `['']`   |
  | `{stage: {$null: true}}` | `stage IS NULL` | `[]`     |

  The failure was **silent, not loud**: an "is empty" dashboard widget drew zero
  rows — never an error — because a real value can never equal a NULL column, and
  the author saw "no data" rather than anything to debug. On a text column the
  `$ne` direction was worse than empty: in SQLite / MySQL `''` is a value rows
  genuinely store, so "stage is not empty" compiled to `stage != ''` and excluded
  exactly the rows it was asked to keep, while "stage is empty" returned the one
  row that is emphatically not null.

  `$eq: null` and `$null: true` are not near-synonyms to be reconciled by taste —
  `driver-mongodb`'s translator **rewrites** the latter into the former, so they
  are one predicate in the contract, and `read-scope-sql.ts` (this package's other
  SQL compiler), `driver-sql`, `driver-memory` and `formula` all compile them
  alike. This module was the one dissenting half of one package; `fieldLeaves` now
  emits the same `notSet` / `set` leaves for all three spellings, so both
  strategies, the ObjectQL engine filter and the `/analytics/sql` display echo
  follow with no new cases.

  The #5146 NULL-safe `$not` guard table moved in the **same** commit, because it
  describes this file's emitter rather than a sibling's: while `$eq: null` was a
  value comparison the guard correctly classified it as one, and left alone it
  would have wrapped `stage IS NOT NULL AND stage IS NULL` — an always-false
  conjunction — and negated it to **every** row for a filter meaning "stage is not
  empty". `nullValueSatisfiesOperator` and `operatorIsNullTotal` now carry the
  `value === null` arms their `read-scope-sql` counterparts have, and
  `{$not: {stage: {$eq: null}}}` returns the rows the other three backends already
  return for it.

  Scoped deliberately to the two spellings `filter.zod.ts` gives a null _meaning_.
  `stringifyForCube`'s `v == null` arm is untouched: it still serves comparand
  positions no ruling covers (`$gt: null`, `$in: [null]`), where `''` is a
  placeholder rather than an answer. An empty-string comparand also stays a value
  comparison — `{stage: {$eq: ''}}` still binds `''` — since reading `''` as null
  would be the same defect with its sign flipped.

  Authoring is unchanged; only the compiled predicate is. A widget that worked
  around the old behaviour by filtering on the literal empty string (`{$eq: ''}`)
  keeps working and still means the empty string; one that wrote `{$eq: null}` and
  saw nothing now gets its rows.

- f522e95: fix(service-analytics): the dataset raw-SQL bridge routes by object, so datasets over non-default datasources stop reading `0` (#5033)

  `AnalyticsServicePlugin`'s `executeRawSql` auto-bridge received the object name
  and threw it away: `engine.execute(knexSql, { args: params })`. `ObjectQL.execute()`
  picks its driver in the order `options.object` → `getDriver(object)`, then
  `options.datasource`, then the default driver — so rule 1 could never fire and
  **every dataset raw-SQL read landed on the default datasource**. Any object routed
  elsewhere (the ADR-0057 §3.6 telemetry split for `lifecycle.class ∈ {audit,
telemetry, event}`, an explicit `object.datasource`, a `datasourceMapping` rule)
  raised `no such table`, which the widget-level graceful degradation then turned
  into an empty result — a confident `0` over live rows, on a green dashboard.
  Measured: `sys_audit_log` returned 49 records through the object-routed read and
  `{"rows":[]}` through the dataset raw-SQL read, on the same running kernel.

  The bridge now passes `{ args: params, object: objectName }`, matching the
  `executeAggregate` bridge beside it (`engine.aggregate(objectName, …)`), so both
  dataset execution paths give **one** answer to "which datasource is this object in".
  No configuration change is needed; misrouted dashboards start reading real data.

  **Behaviour change worth knowing about.** A dataset whose SQL `LEFT JOIN`s (what
  `NativeSQLStrategy` emits for a dotted dimension such as `account.industry`) across
  two datasources previously ran against the default datasource and silently read the
  wrong database. It now runs on the base object's own datasource, where the joined
  table genuinely is not — and **fails loudly** instead of degrading, because the base
  table resolved fine and reporting it as "unavailable" would keep the confident `0`
  alive under a new cause. The error names the actual cause and the remedy:

  ```
  [Analytics] dataset "audit_by_actor" cannot be executed as one statement:
  table "account" is not on datasource "telemetry", which is where its base object
  "sys_audit_log" lives — "account" is registered on the default datasource.
  A dataset JOIN cannot cross datasources. Fix it by binding both objects to the
  same datasource, or by dropping the cross-datasource relationship from the
  dataset's `include`/dimensions.
  ```

  Graceful degradation is unchanged for genuine absence: a dataset whose own backing
  object (or a joined object that this kernel never registered) has no table still
  renders as "no data" with the existing server-side `warn`, rather than failing the
  widget. `AnalyticsServiceConfig` gains one optional, diagnostics-only hook —
  `getObjectDatasource(objectName)` — used solely to name the datasources in that
  message; it never selects a driver.

- fb3d99b: fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
  lower used to answer `400 DATASET_INVALID` with the refusal message echoed
  verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
  (`"Internal server error"`); the full text goes to the server log. Monitoring that
  counted these as client errors will see a 4xx disappear and a 5xx appear, and a
  client retrying on 5xx will now retry a request that cannot succeed until an
  administrator fixes the policy. Both follow from the correction below and are
  stated rather than buried.

  ## What was wrong

  These ten fail-closed refusals were the last family `/analytics/dataset/query`
  classified by **prose** — the final entry of the hardcoded message-substring list
  #5352 introduced, which #5367's first PR had already shrunk from six entries to
  one. Two defects in one verdict:

  - **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
    `FilterCondition` the security service compiled from an **administrator's**
    sharing rule / permission set, and a join alias the **dataset compiler**
    generated. Neither is caller input — the caller's own predicate goes through
    `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
    what can arrive here is a broken policy, or drift between two of our own
    components (#5557's `$regex` was literally the second case). For this request's
    caller both are a **server** fault; `400` told them to fix a request that was
    never wrong and kept the real fault out of 5xx alerting.
  - **Disclosure.** A 400 echoed the message, so
    `unsafe field identifier "secret_policy_field"` and
    `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
    and comparands of the RLS policy governing them.

  The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
  was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
  path, a 4xx misreports a condition the client cannot fix, and 422 would have left
  the disclosure question to be re-decided message by message).

  ## What changed

  - `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
    `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
    module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
    `:104`'s alias-vs-field split (option C on the card) collapses under B: both
    branches answer the same verdict, pinned so the collapse is a recorded decision.
  - `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
    fully retired** — nothing in this catch reads prose any more, and #5367's
    Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
    on a schedule") is paid off.
  - The route's 5xx branch now withholds the message of any producer that
    **declares** a server fault (`status >= 500` with a `code`). This was needed
    rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
    over SQL/driver _phrasing_, and measured, every read-scope message returns
    `false` from it — so retiring the list alone would have moved the policy content
    from a 400 body into a 500 body instead of out of the response. Teaching that
    heuristic to recognise `[read-scope-sql]` would have been _more_ message
    sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
    errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
    query …") stays readable.
  - `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-analytics` (ADR-0112 D3) and typed as
    `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
    error. It is legible on the wire through the sibling `/analytics/query` exit,
    which puts a thrown `err.code` in `error.details.code` (#3842).

  **Which inputs are refused did not change.** No refusal condition moved: nothing
  that used to lower now throws, and nothing that used to throw now lowers. That is
  pinned input-by-input — refusals _and_ accepted read scopes with their compiled
  SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
  before and after; only the envelope assertions move.

  Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
  sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
  (rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
  asserting the 500, that the body contains no policy detail, and that the withheld
  text is present in the log — plus a positive control and both sides of the
  declared-vs-undeclared withhold.

- 628b028: fix(service-analytics): thirteen caller-shaped analytics refusals answer 4xx from their own envelope instead of `500` (#5716)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  Thirteen refusal conditions in `service-analytics` (twelve `throw` sites — the
  cross-object measure and filter share one) used to reach the caller as
  `500 {"code":"ANALYTICS_QUERY_FAILED"}` on `POST /analytics/dataset/query`, and as
  `500 {"code":"INTERNAL_ERROR"}` on `POST /analytics/query`. They now answer **400** —
  `DATASET_INVALID` for the seven that are a verdict about the dataset or the whole
  selection, `INVALID_FIELD` for the six that name one member of the request:

  | refusal                                                          | now                     |
  | ---------------------------------------------------------------- | ----------------------- |
  | dataset JOIN crosses datasources (#5115)                         | `DATASET_INVALID` / 400 |
  | `include` names a relationship the object does not have          | `DATASET_INVALID` / 400 |
  | `include` path past the 3-hop limit                              | `DATASET_INVALID` / 400 |
  | a `dateRange` bound that is not a date                           | `DATASET_INVALID` / 400 |
  | `compareTo` names a timeDimension with no `dateRange`            | `DATASET_INVALID` / 400 |
  | `compareTo` with no dated window to shift                        | `DATASET_INVALID` / 400 |
  | `compareTo` ambiguous between two dated windows                  | `DATASET_INVALID` / 400 |
  | cube declares no such measure (#4157)                            | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object time-dimension bucket                     | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object measure                                   | `INVALID_FIELD` / 400   |
  | ObjectQL: cross-object filter                                    | `INVALID_FIELD` / 400   |
  | ObjectQL: multi-hop cross-object dimension                       | `INVALID_FIELD` / 400   |
  | ObjectQL: non-recombinable measure over a cross-object dimension | `INVALID_FIELD` / 400   |

  Monitoring that counted these as server errors will see a 5xx disappear and a 4xx
  appear, and a client retrying on 5xx will stop retrying a request that cannot
  succeed until the request or the dataset changes. **No refusal condition moved and
  no message was reworded** — the same inputs are refused, in the same words; only
  the envelope is new. (The messages are load-bearing beyond readability: #5923's
  tests assert the `planCrossObject` wording, and #5717 tracks one compiler message
  for colliding with a downstream sniffer.)

  ## What was wrong

  #5352 gave the dataset route a list of message SUBSTRINGS so six refusal families
  could answer 400, and #5367 retired five of those entries by giving their
  producers an ADR-0112 envelope. Both rounds worked from that list — and the list
  was only ever the refusals someone had already hit. Reading every `throw` in the
  package afterwards found thirteen more of exactly the same kind, which had never
  been on it: a typo in `compareTo`, a `dateRange` the dashboard sent, a dataset
  whose `include` names a relationship that does not exist. Each answered "the
  platform is broken" for a mistake the caller or the author could fix, on both
  analytics faces.

  **Both faces move, measured.** `/analytics/dataset/query` reads the envelope in
  its catch (#5352); `/analytics/query` exits through
  `dispatcher-plugin.errorResponseBase`, which already adopts a thrown `status` and
  carries the `code` (#3867/#3842) — so the cross-object refusals go from
  `500 INTERNAL_ERROR` to `400 INVALID_FIELD` there as well, without touching that
  route. The open question #5811 tracks on that face is about _withholding the
  message of a declared 5xx_, which none of these are.

  ## Why two codes

  `dataset-refusal.ts` gains a second constructor, `invalidMemberError`
  (`INVALID_FIELD` / 400 + `member`/`param`/`cube`), beside `datasetInvalidError`.
  The split is by what the refusal is a verdict ABOUT: the dataset/selection as a
  whole, or one member the request named. The member family is `INVALID_FIELD`
  because the three shipped analytics gates already answer exactly that for the
  NEIGHBOURING member-level mistakes on the same request keys — `measures` (#4437),
  `dimensions`/`timeDimensions` (#5520), `where` (#5669) — so one class of mistake
  keeps one wire shape; and because these six fire on `/analytics/query` too, where
  there is no dataset for `DATASET_INVALID` to be about. No new code is registered:
  both are already in the ADR-0112 vocabulary.

  ## What deliberately did NOT change

  `native-sql-strategy`'s "measure … has unrecognised type" stays a bare `Error`
  (an undeclared 500) although #5716 listed it as author-shaped. Measured:
  `Metric.type` is the closed `AggregationMetricType` enum, `metric-type-coverage.test.ts`
  pins that the strategy handles every member of it, the dataset compiler writes
  only `SUPPORTED_AGGREGATES` into a cube, and `inferMeasure` mints six known types
  — so no spec-valid cube can reach it. An arrival is our own drift or a host
  registering an unparsed cube, and blaming the caller would hide a platform fault
  from 5xx alerting. The two "Cube not found" guards and the two operator-drift
  throws stay bare for the same reason.

  Coverage: `unlisted-refusal-envelope.test.ts` (service-analytics) drives all
  thirteen refusals through the real producers — one block pinning that the refusal
  SET and its wording are unchanged, one pinning the envelope, one pinning the
  verdicts that stay 500; `analytics-dataset-unlisted-refusal-envelope.test.ts`
  (rest) drives eleven of them end-to-end through the route with a real
  `AnalyticsService`, plus three positive controls and the two sites that route
  cannot reach (with the measurement that explains why).

- b857356: fix(service-analytics): a `where` written as a `FilterArray` is lowered instead of silently dropped (#5334)

  **Observable behaviour change.** An analytics query whose `where` arrived as an
  ARRAY had its filter **deleted**: `normalizeAnalyticsFilterTree` answered every
  array with `return null`, so no predicate was compiled, no error was raised, and
  the widget charted the **entire dataset**. The compiled SQL stayed perfectly
  valid — just broader than the author asked for — which is why it was invisible
  to every test that asserts a SQL string. The issue's own measurement:
  `generateSql({cube:'deals', measures:['total'], dimensions:['id'], where:
[['stage','=','won']]})` emitted `SELECT id AS "id", COUNT(*) AS "total" FROM
"deal" GROUP BY id` with an empty `params`. It now emits the bound `WHERE` and
  returns the two won deals.

  `FilterArray` (`['stage','=','won']`, `['and', […], […]]`, `[[…], […]]`) is
  INPUT-ONLY authoring sugar (#5285), and #5158's ruling C says every door into
  the runtime lowers it through the single `parseFilterAST` sink before anything
  downstream sees a filter. #5329 closed ObjectQL's six entry points that way and
  deleted the four drivers' private array dialects. Analytics is the **fifth
  door**: it compiles `where` itself — to SQL (`NativeSQLStrategy`) or to a
  `FilterCondition` for the engine (`ObjectQLStrategy`) — so nothing upstream
  lowers for it. It now gives the same three answers the engine door gives:

  - `[]` — "no filter", not a failed filter: no predicate, no error (unchanged).
  - A well-formed `FilterArray` — **lowered** through `parseFilterAST`, so both
    spellings of one filter select the same rows on both strategies.
  - Any other non-empty array — **refused** with `INVALID_FILTER` / 400
    (ADR-0112), the envelope the drivers' `filterArrayReachedDriverError` uses.
    This is where the undeclared INFIX form (`[condA, 'or', condB]`) lands, and
    where a list of `FilterCondition` objects (`[{stage:'won'}]`) lands — neither
    is a `FilterArray`, `parseFilterAST` has no lowering for either, and dropping
    them is what returned the unfiltered dataset.

  Lowering rather than refusing keeps one dashboard's metadata meaning one thing:
  the same `where` on a plain `find()` already lowers at the engine door, so
  refusing it here would have forked the product by which face read the metadata.

- fce4c73: fix(service-analytics): an analytics `where` over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5669)

  `ensureCube` carried two source-field gates — `assertMeasureFields` (#4437,
  `param: 'measures'`) and `assertDimensionFields` (#5520,
  `param: 'dimensions' | 'timeDimensions'`) — and none for the filter face, the
  request key most likely to carry a hand-typed field name. A `where` naming a
  field the object does not have compiled straight into the statement and came
  back as a driver error with no envelope:

  ```
  POST /analytics/query {"cube":"crm_account","measures":["count"],"where":{"bogus_col":"x"}}
  → SELECT COUNT(*) AS "count" FROM "crm_account" WHERE bogus_col = $1
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437 / #5520
  POST /analytics/query {"cube":"crm_account","measures":["count"],"dimensions":["bogus_dim"]}
  → 400 {"code":"INVALID_FIELD","message":"Dimension 'bogus_dim' … "}
  ```

  A driver error class as the caller's `error.code` for a caller-shaped mistake is
  the ADR-0112 fault #4437 was filed about; the `/data` route has answered the same
  typo with a field-naming 400 since #4315/#4254.

  **The gate.** `ensureCube` now runs `assertWhereFields` after the other two on
  every path, so a filter whose source column the backing object does not have is
  refused **before** any SQL is built, with the same envelope its two siblings
  use: `INVALID_FIELD` / 400 plus `field` / `object` / `param: 'where'`, and a
  message naming the field, the valid filter members and the object's known field
  list. `query`, `generateSql` and `queryDataset` (both `runtimeFilter` and a
  dataset's own declared `filter`) are covered, and a rejected query leaves
  nothing behind in the cube registry. `/analytics/dataset/query` needed no
  change: #5352's envelope branch already carries a coded 4xx through, which the
  new REST-face test pins end to end.

  **Field names come from the SQL producer's own reader.** The members are
  collected through `normalizeAnalyticsFilterTree` + `collectFilterLeaves` — the
  same pair both strategies call to build the predicate — rather than by walking
  the raw `where` object. So `$and`/`$or`/`$not` nesting, `$`-prefixed operator
  keys, `$between` lowering, the `{owner: {region: 'NA'}}` → `owner.region`
  flattening and the #5334 array spelling are all read exactly as they will be
  compiled, in one place, instead of in a second walker that could drift from it.

  **What deliberately did not change:**

  - Filtering on a REAL field the cube never declared (`where: {phone: '555'}`)
    still works — the gate asks "does the _object_ have this field", never "did the
    cube declare it".
  - A filter member resolves through `cube.dimensions` **and** `cube.measures`,
    which is what the strategies do: a cube declaring
    `measures.revenue = {sql: 'annual_revenue'}` still answers
    `where: {revenue: {$gt: 100}}` as `annual_revenue > ?`.
  - A declared member is followed to its real column, so a dimension `assessed`
    over column `assessed_at` is not judged by its own name.
  - `id` / `created_at` / `updated_at` stay admitted unconditionally, matching the
    data path's `resolveQueryFields`.
  - An expression `sql` (on the cube or on a member), a dotted relation traversal,
    and a host that wires no field-name probe are all stood down on, exactly as the
    measure and dimension gates stand down.
  - The `INVALID_FILTER` family is untouched. A `where` the normalizer refuses
    outright — an unknown operator, a zero-operator field constraint, an
    unlowerable filter array — is _not_ judged here: the gate stands down and the
    refusal stays where it already happens (#5352 / #5367's geography). A field
    gate that cannot read the tree has nothing to say about it, and pulling those
    refusals forward would also have newly refused them on the draft-preview path,
    whose matcher never consults the normalizer.

- f6385c7: fix(service-analytics): a `timeDimensions` entry used only as a date WINDOW no longer buckets the grid (#5688)

  **Observable behaviour change — read this if you render, page, or assert on
  dataset responses.** A selection that used a date dimension only as a window —
  `timeDimensions: [{ dimension, dateRange }]` with no `granularity`, and the
  dimension NOT listed in `selection.dimensions` — used to have the dataset
  dimension's declared `dateGranularity` filled in anyway. That made the entry a
  `GROUP BY` item, so the response grew a time column nobody selected and every
  row split per bucket. "Count by Owner" plus a dashboard date-range filter came
  back as "by Owner × month":

  ```
  before  fields  [owner, close_date, opp_count]
          rows    [{owner:'u1', close_date:'2026-01', opp_count:1},
                   {owner:'u1', close_date:'2026-02', opp_count:1},
                   {owner:'u2', close_date:'2026-01', opp_count:1}]

  after   fields  [owner, opp_count]
          rows    [{owner:'u1', opp_count:2},
                   {owner:'u2', opp_count:1}]
  ```

  Both the **row count and the column set** change for such a selection: the extra
  month column disappears and rows that were split per bucket collapse back into
  one row per selected dimension tuple. A KPI single-value card that was reading
  the first of several month rows now reads the only row. Consumers that pinned
  the previous shape (a snapshot of `fields`, a row count, a hard-coded column
  index) need updating; consumers that render the response's own `fields` do not.

  Three conditions had to hold together to be affected, so a selection outside
  them is byte-identical: the dataset dimension declares an explicit
  `dateGranularity`, the `timeDimensions` entry states no `granularity`, and
  `selection.dateGranularity` is unset.

  **What still buckets, unchanged.** An entry is bucketed when the request says
  that date is being bucketed: the dimension is one of the selection's own
  `dimensions`, the entry carries its own `granularity` (#4033 — still projected
  as a column even when not selected), or `selection.dateGranularity` is set. The
  granularity _precedence_ chain is untouched. A dataset dimension's
  `dateGranularity` says how that date renders **when** grouped — it is no longer
  read as a request to group by it.

  **`compareTo` alignment (#3588/#4870) holds by construction.** The comparison
  pass re-enters the same query builder with the same grid dimensions, differing
  only in the shifted `dateRange`, so both passes bucket an entry alike or not at
  all — never one of each, which was the state that left every `__compare` column
  empty. For a window-only anchor this **repairs** the comparison rather than
  preserving it: the merge has always keyed on `selection.dimensions` alone, so
  the backfilled bucket column sat outside the merge key, and with several
  month-split rows per group the comparison value landed on whichever row the
  index held last while the others read a confident `0`.

  Also fixed, same root cause: a time column that IS projected via
  `timeDimensions` (an entry carrying its own `granularity`, never listed under
  `dimensions`) now carries its dataset `label` in `fields` instead of a bare
  `type` — the label enrichment walked `selection.dimensions` only.

- 8dbd2a8: fix(service-analytics): dataset 响应的 `fields` 在「度量全部自带 filter」的路径上也描述维度列 (#5537)

  一个 dataset 查询,只要它的**基础度量全部带有自身的 `filter`**(或它选中的 derived
  度量的依赖全部如此),响应里的 `fields` 就只剩度量列,被选中的维度**完全没有描述符**。
  维度值一直都在 `rows` 里(它就是合并键),但读取列元数据的消费者拿不到维度列的
  `label` 与 `type`,只能退回去 humanize 原始行键。

  HotCRM「Sales Performance」上肉眼可见:同一个声明了 `label: 'Owner'` 的 `owner` 维度,
  "Open Pipeline by Owner"(度量无 filter)表头是 `Owner`,而 "Win / Loss by Rep"
  (`won_count`/`lost_count` 各带 filter、`win_rate` 是 ratio)表头是小写 `owner`。
  换成字符串维度 `lead_source` 看起来正常纯属巧合 —— humanize 后恰好等于真 label;
  两种维度的描述符其实都丢了。

  根因在网格装配处,不在渲染端:`DatasetExecutor.runMeasurePass` 只有在存在**无 filter**
  度量时才发那条主查询;当每个基础度量都自带 filter 时,它从 `{ rows: [], fields: [] }`
  起步,而随后每个补充子查询只追加一个**度量**描述符。现在这种情况下,维度描述符取自
  **第一个补充子查询自己的结果** —— 它 group by 的维度与整个网格完全一致 —— 因此两条路径
  的 `fields` 形状(维度在前、顺序、`type`)按构造收敛,而不是靠 executor 再抄一份
  「哪些维度被投影」的规则(该规则的单一事实源在各 strategy 的 `buildFieldMeta`,#4033)。

  `compareTo`、`totals` 与 derived 度量都经由同一条 pass,所以一并修好。

  已知的相邻缺口**不在**本次修复范围,单独立了 #5688:一个只带 `dateRange` 的
  `timeDimensions` 条目会被补上 dataset 的默认粒度,于是「窗口」变成第二层 GROUP BY,
  网格被按月拆分、并多出一个没人选过的时间列(该列在 `fields` 里也拿不到 `label`)。
  它在两条路径上表现一致(本次修复前后皆然),且修它会改变响应形状,故不搭车。

- 88a6bed: fix(service-analytics): an ad-hoc cube's dimensions no longer depend on how the `where` was spelled (#5353)

  `inferCubeFromQuery` mints a Cube for a free-form analytics query that names no
  registered cube, seeding `dimensions` from the fields the query mentions — its
  `measures`, `dimensions`, `timeDimensions`, and its `where`. The `where` arm was
  guarded by `!Array.isArray(query.where)`, written when an array `where` was not a
  filter. #5334 made it one, so from then on one filter minted two different cubes
  depending on its spelling:

  ```
  where: {stage: 'won'}          → dimensions: {stage}   ← seeded
  where: [['stage','=','won']]   → dimensions: {}        ← skipped
  ```

  The `where` is now LOWERED to its canonical `FilterCondition` before its keys are
  read, so the spelling stops mattering. The lowering is the same one the
  strategies already use (#5334's `parseFilterAST` call, extracted from
  `normalizeAnalyticsFilterTree` as `lowerAnalyticsWhere` so there is still exactly
  one of it), and the keys are read through `conjunctFieldKeys`, which descends
  `$and` — necessarily, because the lowering itself introduces `$and` where the
  object spelling has none: `[[a,…],[b,…]]` lowers to `{$and: [{a…},{b…}]}`. As a
  result an explicit `{$and: […]}` object `where` now also seeds its conjuncts'
  keys, which it never did.

  `$or` / `$not` are not descended, and contribute no key on either spelling, as
  before.

  **No compiled statement, bound value or gate verdict changes.** Both spellings
  already compiled a byte-identical predicate (which is why this shipped as an
  observation rather than a defect): `resolveFieldSql` falls back to the bare
  column name for an undeclared member, and `qualifyAndRegisterJoin` leaves bare
  columns bare on a cube with no `joins` — which an inferred cube never has. So the
  newly-declared dimensions move those members from the undeclared branch to the
  declared one and both yield the same column. What does change is the suggestion
  list in a rejection: `Valid filter members:` / `Valid dimensions:` now read the
  same for both spellings of one filter, and `getMeta` reports the same dimension
  vocabulary for both.

  **Still spelling-dependent: a DOTTED `where` key.** `{'owner.region': 'NA'}`
  seeds the stripped tail `region` as a base-table dimension; the array spelling
  `[['owner.region','=','NA']]` seeds nothing and compiles the relation traversal.
  Unifying them is #5739's call, not this change's — propagating the mint to the
  array spelling turns a working traversal into a base-column filter over different
  rows (and a `400 INVALID_FIELD` where the base table has no such column), while
  withdrawing it from the object spelling would split a verdict #5740 deliberately
  shares with the `dimensions` request key. Dotted keys therefore keep today's
  per-spelling answer, pinned by tests, until #5739 rules.

- a6b3ee7: fix(service-analytics): 即席推断的 Cube 把 `owner.region` 当成关系穿越,不再铸成基表列 `region` (#5739)

  `inferCubeFromQuery` 为「没有注册 Cube 的自由查询」即席合成一个 Cube,并从查询提
  到的字段里播种 `dimensions`。每个铸造点都先把成员过一遍 `stripPrefix` —— 一个把
  **任何**点号名的首段剥掉的判定。对 `<cube>.` 限定符(`crm_account.industry` →
  `industry`)这是对的;对**关系穿越**则不是:`owner.region` 被铸成
  `dimensions.region = { sql: 'region' }`,一个**基表列**。下游 `lookupMember` 的
  「plain second-segment」那一档随即命中它,**赶在**「synthetic relation traversal」
  那一档把点号路径交给 JOIN 机制之前就返回了 —— 关系穿越被基表列遮蔽。

  危害分两档,而更糟的是安静的那一档。当基表**恰好有同名列**时(`crm_account` 自己
  就有 `region`),四个组合全部静默通过、无任何拒收:

  ```
  ① ObjectQL,  where: {'owner.region':'NA'} → executeAggregate 收到 {"region":"NA"}
  ② NativeSQL, where: {'owner.region':'NA'} → … FROM "crm_account" WHERE region = $1
  ③ ObjectQL,  dimensions: ['owner.region'] → groupBy: ["region"]
  ④ NativeSQL, dimensions: ['owner.region'] → SELECT region AS "owner.region" … GROUP BY region
  ```

  行数与图表都是错的,而没有任何错误可读 —— ④ 尤甚:响应列名标着 `owner.region`,值
  却来自基表,读者无法从结果里看出来。基表**没有**同名列时则落到 `400 INVALID_FIELD`
  且点名 `region`,而调用方写的是 `owner.region`。

  维护者 2026-08-06 裁定(issue #5739):即席路径**支持**关系穿越。铸造改为**原样**
  (`dimensions['owner.region'] = { sql: 'owner.region' }`),真正的 `<cube>.` 限定
  前缀(首段 == cube 名)仍然剥。这同时收敛了一处早有的分叉:同一个过滤器写成数组
  (`[['owner.region','=','NA']]`)时铸不出 dimension,于是一直走 synthetic 档、一直
  编出正确的 JOIN —— 两种写法现在逐字生成同一条语句。

  **Observable behaviour change —— 若你按状态码告警/重试,或消费即席 cube 的元数据,
  请读这一段。**

  - **对象写法的点号 member 从「静默错列」/「`INVALID_FIELD` 指错名」变为 JOIN 穿越。**
    NativeSQL 上 `where: {'owner.region': 'NA'}` 与
    `dimensions: ['owner.region']` 现在编出
    `LEFT JOIN "owner" ON "crm_account"."owner" = "owner"."id"` 并按 `"owner"."region"`
    筛选/分组;此前它们筛/分组的是基表 `region`(有同名列时),或以
    `400 INVALID_FIELD "constrains field 'region'"` 被拒(无同名列时)。**同一个请求
    现在返回的行可能与此前不同 —— 此前那些行是错的。**
  - **ObjectQL 上同一个 member 改为响亮拒收或正确穿越,不再有第三种更安静的答案。**
    `where` 得到 `cannot evaluate a cross-object filter ("owner.region")` —— 与**已
    注册 cube** 上的既有答案逐字一致;`dimensions` 走 FK-expand 正确穿越,返回关联对象
    的值。带 `granularity` 的跨对象 `timeDimensions` 得到
    `cannot bucket a cross-object time dimension`。
  - **即席 cube 的 `dimensions` 词汇表里现在出现点号键**(`getMeta` 上是
    `crm_account.owner.region`)。此前该穿越要么以剥掉的尾段出现(`crm_account.region`),
    要么(数组写法)完全不出现。
  - **不变的部分**:真正的 `<cube>.` 限定符照旧剥除;裸列名照旧是基表列(基表自己的
    `region` 仍可作为 `region` 分组);#4437 / #5520 / #5669 三道源字段闸门的代码一行未
    动,它们对裸名拼错的 `400 INVALID_FIELD` 拒收原样保留;点号 **measure**(如
    `total.sum`)仍按 #4437 的 `400 INVALID_FIELD` 拒收 —— `lookupMember` 的 synthetic
    穿越档是 dimension-only,dotted measure 没有可收敛的穿越答案。

- ff39e63: fix(service-analytics): 维度合并键不再把「未分配」并进「空白」,并改为长度前缀消歧 (#4821)

  `mergeByDimensions` 是每一份多查询 dataset 结果的装配缝:主查询与每个带 `filter`
  的 measure 的补充子查询在这里对齐,`compareTo` 窗口自 #4870 起也按 measure 扇出后
  经由同一个缝合并回来。这里一次键碰撞不会报错 —— 一个分组静默吸走另一个分组的数字,
  网格仍然保持看起来合理的行数和列数。

  **#4821 报告的机制与实际的缺陷不完全一致,先把这一点说清楚。** 原键是
  `String(row[d] ?? '')` 以一个**直接写进源码的裸 U+0001 字节**相连。裸控制字符渲染
  为空,所以 issue 正文读到的是 `join('')`,其头号复现(`['ab','c']` 与 `['a','bc']`
  同键为 `"abc"`)其实并不成立 —— 分隔符一直在,只是看不见。真正咬人的是另外两条:

  - `?? ''` 让**真正为 null** 的维度与**空字符串**维度键成同一个值。于是「未分配」被
    并进「空白」:一行吞掉另一行的 measure,另一行的列则整个缺失 —— 而 #4708 的空组
    填充随后会给它填上一个理直气壮的 `0`。一个真实计数为 3 的分组因此显示为 0。
  - 单字符分隔符只在「没有任何维度**值**包含该字符」时才无歧义。维度值是用户数据
    (文本字段、导入记录),所以那是一个假设而非保证,且一旦不成立同样静默。

  **改法:长度前缀 + 显式空值哨兵。** 每段编码为 `<长度>:<值>`,`2:ab1:c` 与
  `1:a2:bc` 对任意输入都不同,不再保留任何字符、也不再有看不见的字节留给下一个读者
  误读(本 issue 正是这样被误读出来的)。null/undefined 单独走一个哨兵段,与消歧这件
  事解耦。

  **逐段的 `String()` 强制被刻意保留**,这与一文件之隔的 `cross-object-rebucket.ts`
  的 JSON 键不是同一笔交易:后者重新分桶的是**同一个查询**的行,一列只有一种类型,
  JSON 在那里免费且能换来真实的区分(空桶 `null` vs 字面量字符串 `"null"`)。本函数
  做的是相反的事 —— 跨**不同查询**对齐行,而驱动确实会对同一个分组返回不同的 JS 类型
  (本文件 `compareValues` 的注释即记着 "numeric strings, which is how some drivers
  return SUM results")。改用 `JSON.stringify` 会把 `1` 与 `"1"` 渲染成两个键,让今天
  能正确合并的行不再合并 —— 用一个新的静默缺陷换掉旧的,不算修好。该行为已有回归钉
  测试锁住。

  仅影响内部合并键,响应中的任何值都不改变。

- 2cca98b: fix(service-analytics): 分析查询的 RLS read scope 不再被 `{ $not: {} }` 整表放行,`$not` 改为 NULL-safe

  **这是一次安全相关的行为变更,涉及分析查询的可见行集合。请读完再升级。**

  ### 变更一(要害):`{ $not: {} }` 的 read scope 以前**完全不加 WHERE**,整表可见;现在是零行

  `read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的**唯一**通道(ADR-0021 D-C),
  被 `NativeSQLStrategy.applyReadScope` 与 `ObjectQLStrategy` 用来给分析查询加可见性约束。
  它以空字符串表示「无约束」(布尔常量 TRUE)。`compileNode({})` 返回空串,于是:

  ```
  compileNode({}) → ''  →  if (inner) 为假  →  $not 不产出任何子句
                        →  compileScopedFilterToSql 返回 ''
                        →  applyReadScope 的 `if (!sql) return;` 接手
                        →  生成的 SQL 里没有 WHERE
  ```

  一条语义为 `NOT TRUE ≡ FALSE`(**什么都不给看**)的 read scope,实际效果是**整张表都给看**。
  同一段循环里 `$and` / `$or` 的空数组一直是 fail-closed 抛错的,只漏了 `$not` 这一格。

  修复后 `{ $not: {} }` 编译为恒假子句 `1 = 0`,`applyReadScope` 照常拼进 WHERE,返回零行 ——
  与 driver-sql 在 #5134 / PR #5243 上的口径一致。

  **升级影响:** 如果你的 RLS 策略(或 `cel-to-filter.ts` 降解出的 CEL 规则)在某条路径上
  产出过 `{ $not: {} }`,该对象的分析查询此前是**无边界**的,现在会返回零行。行数从「全部」
  掉到「零」不是本次引入的收紧,而是那条策略本来就该有的答案 —— 请核对策略本身。

  同源、方向相反的一处一并修正:`$or` 的空析取项 `{}` 以前被 `.filter(s => s.length > 0)`
  丢掉,`{ $or: [{}, { a: 1 }] }` 收紧成 `a = 1`。`{}` 是 TRUE 析取项,TRUE 吸收整个析取,
  所以现在整条 `$or` 为 TRUE(无约束)。被丢弃分支的绑定值同时被丢弃 —— 否则 `params` 里
  会留下没有 `?` 消费的值,把后面每一个占位符都错位到别人的值上。

  ### 变更二:`$not` 改为 NULL-safe

  SQL 是三值逻辑,`WHERE` 只保留 TRUE,所以裸 `NOT ("t"."stage" = ?)` 会把 `stage IS NULL`
  的行整批丢掉;`driver-memory`、`formula` 以及 #5296 之后的 `driver-sql` 都**返回**这些行。
  同一条 read scope,普通查询与分析查询给出不同的可见集合。#5146 已由维护者判定以 JS 家族的
  答案为准,本次把这个编译器对齐过去 —— 它是仓内最后一个按三值逻辑回答 `$not` 的 SQL 家族实现。

  `$not` 的操作数在取反前先被改写成**全域(total)谓词**:

  ```sql
  -- 之前
  NOT ("t"."stage" = ?)
  -- 现在
  NOT (("t"."stage" IS NOT NULL AND "t"."stage" = ?))
  ```

  守卫**下推到每个叶子**而不是挂在 `NOT` 旁边:操作数一旦嵌套(`$not` 里套 `$or`),顶层的
  `OR col IS NULL` 会把 JS 家族排除的行重新放进来。守卫方向**逐算子**判定,不是一刀切 ——
  `{ $not: { a: { $ne: 5 } } }` 语义是「a 就是 5」,无条件加 `OR a IS NULL` 会把 scope 排除的
  行交回去,正是本次要避免的静默放松。所以 `$ne` / `$nin` / `$notContains` 用
  `col IS NULL OR (…)`,`$eq` / `$in` / `$gt` / `$between` / `$contains` 一族用
  `col IS NOT NULL AND (…)`,而 `$null` / `$exists` / `$eq: null` / `$ne: null` 本就是全域谓词,
  一个字节都不加。

  **升级影响:** 形如 `{ $not: { stage: 'won' } }` 的 read scope,以前**不返回** `stage` 为
  NULL 的行,现在**返回**它们 —— 分析查询的行数与图表数值会随之变化。这是把分析侧对齐到其余
  后端,不是新增的放宽。

  ### 不变的部分

  `$not` 路径以外一个字符都没动:普通比较仍然编译成原样的 SQL。fail-closed 的全部保证原封不动
  ——未知算子、嵌套关系值、裸数组、不安全标识符、非 filter 节点的 `$not` 操作数,以及
  `$and: []` / `$or: []` 的空组合子(那一格是 #5322 的独立裁定)统统照旧抛错。

- 07f1822: fix(service-analytics): read scope 的 `$ne` / `$nin` / `$notContains` 改为 NULL-safe,与写侧 `check` 对齐

  **这是一次安全相关的行为变更,涉及分析查询的可见行集合。**
  read scope 里的 `{ stage: { $ne: 'won' } }` 以前**不返回** `stage IS NULL` 的行,
  现在**返回**它们。`$nin` / `$notContains` 同理。

  `read-scope-sql.ts` 是 RLS / 租户 read scope 降解成 SQL 的唯一通道(ADR-0021 D-C)。
  它此前把这三个算子编译成裸的 `col <> ?` / `col NOT IN (…)` / `col NOT LIKE ?`,
  而 SQL 是三值逻辑:被比较列为 NULL 时谓词是 UNKNOWN,`WHERE` 只保留 TRUE,于是
  「该列没有值」的行被整批丢掉。

  **为什么必须与 `driver-sql` 同一个 PR 落地,而不是排到下一批。** 同一条 RLS 规则被
  写一次、在**两侧**求值:读路径由本文件降解成 SQL,写路径由 `formula` 的
  `matchesFilterCondition` 逐记录求值。`formula` 一直用两值 JS(`undefined !== 'won'`
  为真)返回这些行。只对齐其中一侧,得到的不是「更小的修复」,而正是那个缺陷本身 ——
  一条权限规则准入两个不同的行集,写侧允许的记录读侧看不见。

  ```sql
  -- 之前
  "t"."stage" <> ?
  "t"."stage" NOT IN (?)
  "t"."stage" NOT LIKE ? ESCAPE ?
  -- 现在
  ("t"."stage" IS NULL OR "t"."stage" <> ?)
  ("t"."stage" IS NULL OR "t"."stage" NOT IN (?))
  ("t"."stage" IS NULL OR "t"."stage" NOT LIKE ? ESCAPE ?)
  ```

  括号不是排版:`compileField` 用裸 `AND` 连接同一字段的多个算子,不加括号的
  `col IS NULL OR …` 会比那个 AND 结合得更松,从而**静默放宽整条 scope**。

  与 `driver-sql` 一样统一用 OR 展开而非方言等价物(`NOT LIKE` 没有对应形式;SQLite
  写法依赖本仓不锁定的引擎版本;实测执行计划相同)。正向比较逐字符不变,
  `$ne: null` 仍是 `IS NOT NULL`(空值谓词,不是比较)。

  `$not` 路径的逐叶守卫(#5146 / #5326)按原样保留,两条路径读同一张极性表。
  `filter-normalizer`(Cube 面)不在本次范围内,归本裁决第二批。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- 3c7bcc0: feat(spec)!: converge the 11 contracts-vs-domain dual-source type names (#4538)

  `packages/spec/src/contracts/` hand-wrote parameter/result interfaces whose
  names collided with same-named zod-derived types in the domains — the #4411
  trap, tracked as 11 rows of `dual-source-exports.baseline.json`. Each name was
  judged individually against a three-repo import-level scan (framework, cloud,
  objectui): which declaration actually flows at runtime decides the direction.
  All 11 rows are deleted from the baseline; no name below is exported twice
  anymore.

  **Converged — `./contracts` now re-exports the domain zod type (same
  declaration on both entries, imports keep compiling from either):**

  - `NotificationChannel` → `system/notification.zod`'s
    `z.infer<NotificationChannelSchema>` (member sets were identical).
  - `ValidationResult` → `kernel/plugin-validator.zod` (shapes were identical).
  - `HealthStatus` → `kernel/startup-orchestrator.zod` (`details` narrows
    `Record<string, any>` → `Record<string, unknown>`).
  - `PluginStartupResult` → `kernel/startup-orchestrator.zod`. FROM `plugin:
Plugin` (live object) and `error?: Error` TO the serializable projection
    (`plugin: { name, version? }`-passthrough, `error?: { name, message,
stack?, code? }`). Neither side had any consumer outside spec; the
    zod-validatable shape wins.
  - `StartupOptions` → `kernel/startup-orchestrator.zod` — the PARSED tier
    (defaults applied). `IStartupOrchestrator.orchestrateStartup` now takes
    `StartupOptionsInput` (the caller-authored all-optional tier, also
    re-exported from `./contracts`). Fix for callers typed to the old
    all-optional `StartupOptions`: rename to `StartupOptionsInput`.
  - `JobExecution` → `system/job.zod`. The system schema's `duration` field is
    RENAMED `durationMs` — that is what every job adapter produces and what the
    `sys_job_run.duration_ms` column round-trips; the schema described records
    nothing ever wrote. Fix: `duration` → `durationMs` when parsing
    `JobExecutionSchema` payloads.
  - `AnalyticsQuery` → `data/analytics.zod`. The domain schema aligned to the
    contract's semantics first: `timezone` LOST its `.default('UTC')` — absence
    is meaningful (the engine resolves org timezone, #1982/#2018; the
    `/analytics` entry always refused to apply that default). The schema is now
    transform-free, so `AnalyticsQuery` ≡ `AnalyticsQueryInput` (both kept
    exported). Fix for code that relied on `.parse()` injecting `timezone:
'UTC'`: pass the timezone explicitly or resolve it via the engine chain
    (`selection.timezone ?? context.timezone ?? 'UTC'`).

  **Renamed — two genuinely different concepts were sharing one name (both
  flow at runtime):**

  - `./contracts` `DriverCapabilities` → **`AnalyticsDriverCapabilities`**
    (`{ nativeSql, objectqlAggregate, inMemory }`, the analytics strategy-chain
    execution-path probe). The `DriverCapabilities` name now belongs solely to
    the data domain's driver feature-flag record (`DriverCapabilitiesSchema`,
    what `IDataDriver.supports` declares). Fix: importers of the trio from
    `@objectstack/spec/contracts` (or `@objectstack/service-analytics`, whose
    re-export is renamed in lockstep) rename the import; importers who meant
    the driver flags import `DriverCapabilities` from `@objectstack/spec/data`.

  **Removed — the domain-side declaration was dead (zero import-level consumers
  in framework/cloud/objectui; the #4411 family's last survivors):**

  - `system` `MetadataExportOptionsSchema` / `MetadataExportOptions` and
    `MetadataImportOptionsSchema` / `MetadataImportOptions` (the
    `output`/`source`-directory bags). The names now have ONE declaration each:
    the `IMetadataService.exportMetadata` / `importMetadata` parameter
    interfaces on `./contracts` (`types`/`namespaces`/`format` and
    `conflictResolution`/`validate`/`dryRun`), which `MetadataManager`
    implements. No tombstone/D2 conversion, deliberately — these are runtime
    option-bag types, not authorable metadata (same reasoning as #4458).
    `@objectstack/metadata` re-exports the two names from `./contracts` now
    (it previously re-exported the dead system-side shapes its own manager
    did not accept).
  - `system` `JobSchedule` (the `= Schedule` back-compat alias). The name's one
    declaration is the `IJobService.schedule` boundary shape on `./contracts`
    (plain-string cron `expression`); the authored metadata type keeps its real
    name `Schedule`. Fix: `import type { JobSchedule } from
'@objectstack/spec/system'` → `Schedule` (authoring tier) or the
    `./contracts` `JobSchedule` (service boundary), whichever you meant.

### Minor Changes

- fa94b2c: fix(service-analytics): a measure a query never reported reads 0 for a count/sum on every merge seam (#4708)

  A dataset measure carrying its own `filter` runs as a separate grouped
  sub-query and is merged back onto the selected dimensions. A `GROUP BY` over a
  filtered row set emits **no group at all** for a dimension value the filter
  excludes entirely, so the measure comes back **absent**, not `0` — and
  `computeDerived` treats an absent operand as unknowable, so every ratio over it
  goes null too. The cell then renders blank, which is visually identical to "no
  data for this row" and means the opposite.

  The bias runs the worst possible way: the rows that blank are the ones whose
  numerator matched nothing — the **worst-performing rows**. A `lead_source` that
  won nothing rendered as "no data" while one that won everything rendered fine.

  The empty-group value is now filled **by aggregate kind** into every measure
  column the assembled grid lists but no query reported:

  | aggregate                 | over an excluded group | why                                                                 |
  | :------------------------ | :--------------------- | :------------------------------------------------------------------ |
  | `count`, `count_distinct` | `0`                    | "how many rows matched" has an exact answer when the answer is none |
  | `sum`                     | `0`                    | the identity element of the empty set                               |
  | `avg`, `min`, `max`       | stays `null`           | genuinely undefined — there is nothing to average                   |

  Filling all five with `0` would trade this lie for its mirror image, reporting a
  measurement nobody made, so the kinds are judged separately (via
  `emptyGroupValueFor`, shared with the authoring-side coherence checks).

  **Only cells are filled, never rows.** A dimension value no query reported at
  all has genuinely no data and stays out of the grid.

  **What changes beyond the measure-scoped seam.** The fill previously ran before
  the `compareTo` merge, and that merge _appends_ a row for every bucket the
  PREVIOUS window had and this one does not. Every base measure on those rows —
  including unfiltered ones — was absent, so a lead source that sold last month
  and nothing this month rendered as "no data" instead of `0`: the same worst-row
  bias, one merge later. The fill now runs after every merge and covers all base
  measures plus their `<measure>__compare` columns.

  Widgets that worked around this with `?? 0` in the consumer or a `coalesce` in
  the measure can drop it; the coercion belongs in the executor, which is the only
  layer that knows which aggregate produced the gap.

  **New export.** `fillEmptyGroups(rows, columnAggregates)` is exported from the
  package root beside `mergeByDimensions`, so a host assembling a grid outside
  `DatasetExecutor` can apply the same aggregate-kind rule rather than
  reimplementing it — which is what makes this a `minor` rather than a `patch`.

- 328ccc5: fix(security,analytics): scope /analytics/query to the caller's readable records, and refuse a measure over a missing field (#4467, #4437)

  Two defects on the analytics query path, both found by the v17 verification run
  (#3909 / #4482), both reproduced against a live showcase server before the fix
  and re-verified with the same requests after.

  ## #4467 — `/analytics/query` applied no record-level scoping

  `ISecurityService.getReadFilter` documents itself as "the same filter the engine
  middleware AND-s into every find", and exists precisely for paths that bypass
  that middleware — its own doc comment names the analytics raw-SQL path. But the
  chain it mirrors is TWO sibling middlewares: plugin-security's RLS injection and
  plugin-sharing's owner/share visibility filter (`buildSharingMiddleware` AND-s
  `buildReadFilter` into `ast.where` for `find`/`findOne`/`count`/`aggregate`).
  Only the RLS half was ever computed here, and analytics has no other source of
  scope, so the OWD/share predicate simply never existed on that path.

  Live repro: `showcase_private_note` is `sharingModel: 'private'`; an admin owns
  5 notes, a member holds read shares on exactly 2 and no `viewAllRecords`.
  `GET /data/showcase_private_note` correctly returned 2 for the member, while
  `POST /analytics/query {measures:['count']}` returned 5 — and adding
  `dimensions:['title']` returned all five titles, i.e. the VALUES of a column
  that caller may not read, not merely a bad count. Any authenticated caller who
  could reach `/analytics` could enumerate the field values of every row of any
  object exposed as a cube, regardless of OWD, sharing rules, or RLS.

  `getReadFilter` now resolves plugin-sharing's `buildReadFilter` through the
  late-bound `sharing` service and AND-composes it with the RLS filter — the same
  composition the two middlewares reach by both writing into `ast.where`. It also
  computes the ADR-0057 D1 `__readScope` depth that the security middleware
  normally stashes on the context for plugin-sharing to widen its owner-match
  with, using the same `getEffectiveScope` call the middleware makes: no
  middleware runs on this path, and without it a caller granted `unit`/`org` read
  depth would be silently narrowed to `own`. The sharing predicate is resolved for
  every non-system caller AHEAD of the RLS stand-down branches, because those are
  the RLS middleware's own early exits and none of them is a reason to drop a
  sibling middleware's predicate; a sharing-resolution failure denies outright
  rather than falling through to half a scope.

  **Why `minor` rather than `patch`.** This is an observable behaviour change on a
  public read surface, in the narrowing direction: analytics results that a
  principal could previously read they now cannot. Counts drop, `dimensions`
  groupings lose rows, and any dashboard, report, or export built on
  `/analytics/query` over an owner-private object will show smaller numbers for
  non-superuser principals — correctly, but visibly. Deployments that had (however
  unknowingly) come to depend on the unscoped totals will see them change on
  upgrade, so this warrants more than a patch-level note even though it is a
  security fix. No API signature changed: `ISecurityService.getReadFilter`'s
  declaration is untouched — the implementation merely started honouring the
  contract it already documented.

  ## #4437 — a measure naming a missing field 500'd with SQLITE_ERROR

  `inferMeasure('ghost_sum')` maps a suffix convention onto a field name and has
  no way to know the field exists, so it built `SUM(ghost)`, the driver threw
  `no such column`, and the caller got
  `500 {"code":"SQLITE_ERROR","message":"Internal server error"}` — a driver error
  class as the `error.code` for what is a plain typo, which ADR-0112 forbids. A
  dotted spelling took the same path (`measures:['total.sum']` prefix-strips to
  `sum` → `SUM(sum)` → 500). The DATA route has refused the identical mistake with
  a `400 INVALID_FIELD` naming the field since #4315/#4254.

  `AnalyticsService.ensureCube` now validates each measure's resolved source field
  against the backing object's field names before any SQL is built, and rejects
  with the same envelope the data route produces (`400 INVALID_FIELD` carrying
  `field`, `object`, `param`, `measure`) so one mistake has one shape across
  `/data` and `/analytics`. The new `getObjectFieldNames` config hook reads the
  same schema registry `isRegisteredObject` already consults and the data path's
  own gate reads, so "which fields exist" has a single answer across both routes.

  The gate is tiered exactly like the #3867 cube-inference gate, deliberately
  narrow: it applies only when the cube's `sql` is a bare object name (an authored
  cube whose `sql` is a real SQL expression has no field list to check against),
  only when the probe answers (no data engine, or an external datasource whose
  columns are not mirrored locally, stands down), and only to measures whose
  source is a bare column — `count(*)` has no source field, and a dotted
  cross-object reference resolves through a join this layer cannot see, so both
  pass through untouched. `id`/`created_at`/`updated_at` are admitted
  unconditionally, matching the data path's `resolveQueryFields`: a gate stricter
  than the engine it guards would reject queries that used to work. Validation
  runs before the cube is registered, so a rejected query leaves no trace in the
  registry — otherwise a retry would find a "registered" cube carrying the bogus
  measure and sail straight into SQL.

  This half is `minor` for the same envelope reason: a request that used to return
  500 now returns 400 with a different `code`, which is a visible contract change
  for any caller branching on the response.

- 6117f7b: fix(spec,service-analytics): a percentage measure carries its SCALE, so a ratio of 1 is 100% (objectui#3136)

  A `%` format string says how to PRINT a number, not what scale that number is
  on — and the two readings collide at exactly `1`, which is both "100%" (a 0–1
  ratio at full compliance) and "1%" (a single percentage point). With nothing on
  the wire to tell them apart, renderers guessed from the value's magnitude and
  resolved the collision the wrong way: an SLA / pass-rate dashboard reporting
  `sla_rate = 1` displayed **"1.0%"** — "everything met the SLA" read as "1% met
  the SLA" — on both the KPI card and the dataset table.

  The scale was never actually unknowable; it just never left the server. A
  measure declaring `derived: { op: 'ratio' }` is a 0–1 fraction _by definition_,
  and a measure aggregating a `percent` field has whatever scale that field
  stores. Both facts sit in metadata the enrichment pass already reads for the
  ADR-0053 currency chain — which walks back to the source field, checks
  `type === 'currency'`, and rides the resolved code onto the result column.
  Percentages got no such treatment. They do now, through the same seam.

  **`percentScaleOf(field)` (`@objectstack/spec/data`)** is the one place the
  question is answered. A `percent` field stores a FRACTION unless it declares
  `max > 1` (e.g. `min: 0, max: 100`), which marks whole-percent storage — the
  same rule the percent edit widget already writes by, so a value round-trips.
  Non-`percent` fields get no opinion: a plain `number` an author formatted with
  a `%` keeps meaning exactly what their format string says.

  **`AnalyticsResult.fields[].percentScale`** carries the answer: `'fraction'`
  (`1` ⇒ "100%") or `'whole'` (`1` ⇒ "1%"), absent when the column is not a
  percentage. `queryDataset` sets it from the measure's `derived.op === 'ratio'`
  first, then the source field's scale. `currency` — emitted since ADR-0053 but
  only ever written through a cast — is now declared on the same interface.

  The config seam `measureCurrency` is renamed **`sourceFieldMeta`** and returns
  `max` alongside `type`/`defaultCurrency`. The old name had already outgrown
  itself: the date-bucketing path reads `type` through it to tell a `date`
  dimension from a `datetime` one, and the percent chain is its third consumer.

  Renderers that receive `percentScale` must scale by it rather than inferring
  from the value; one that does not receive it (an older server) keeps whatever
  fallback it has, so this is additive on the wire.

  **Same widget family, second fix: an empty filtered group is a measured zero.**
  A measure-scoped filter can exclude every row of a group the grid still lists,
  and the database reports that by omitting the group from the supplementary
  result — after the merge, indistinguishable from "not measured". For a COUNT or
  a SUM it _is_ measured: the answer is 0. `emptyGroupValueFor(aggregate)`
  (`spec/data/aggregation-policy`) states which aggregates have an identity over
  the empty set, and `queryDataset` fills it in once all supplementary merges are
  done (a later measure's merge can append rows no earlier query saw). So
  "0 of 12 paid" now reports `0` instead of blank, and a ratio built on it
  computes to `0` instead of going null — the difference between a dashboard
  saying "0% met the SLA" and saying nothing at all. `avg`/`min`/`max` keep their
  null: there is nothing to average over an empty group, and flattening that to
  zero would invent a measurement.

### Patch Changes

- 2f05139: fix(service-analytics): `compareTo` applies measure-scoped filters, so `<measure>__compare` is the same measure as the column beside it (#4820)

  A dataset measure declared with its own `filter` is scoped by running a
  supplementary grouped sub-query — `combineFilters(baseFilter, measureFilters[m])`
  — and merging it back by dimension key. The `compareTo` pass did not: it issued
  **one** shifted query over every base measure with only the base filter as its
  `where`, and never consulted `compiled.measureFilters` at all.

  For a dataset like

  ```ts
  measures: [
    { name: "revenue", aggregate: "sum", field: "amount" },
    { name: "won_count", aggregate: "count", filter: { stage: "closed_won" } },
  ];
  ```

  the current-period column was scoped and the comparison column was not — two
  different measures rendered side by side under one label:

  | #   | measures               | where                    |         |
  | :-- | :--------------------- | :----------------------- | :------ |
  | 1   | `revenue`              | —                        | current |
  | 2   | `won_count`            | `{"stage":"closed_won"}` | current |
  | 3   | `revenue`, `won_count` | **absent**               | shifted |

  `won_count__compare` was therefore a count of **every** opportunity in the
  previous window, inflated by exactly the rows the measure exists to exclude.
  The error runs one way: the comparison period always looks better, so a "won
  deals vs. last month" tile reads as a collapse when nothing went wrong. Only
  filter-scoped measures were affected — the unfiltered ones next to them compared
  correctly, which is what made it survive.

  The comparison window now runs the **same pass** as the current period —
  unfiltered measures in one shifted query plus one shifted sub-query per
  filter-scoped measure, merged by dimension key — through a single shared
  implementation, so the two paths cannot re-diverge at the next change. The
  dataset filter, the presentation's `runtimeFilter` and the measure's own filter
  compose identically in both windows; the only difference between them is the
  shifted `dateRange`.

  Numbers reported by existing dashboards change where a filtered measure was
  compared: with 3 won deals this month against 1 won of 5 opportunities last
  month, `won_count__compare` was `5` and is now `1`.

  Cost: one extra query per filter-scoped measure when `compareTo` is set.
  Selections whose measures carry no filter are untouched and still compare in a
  single shifted query.

  The empty-group fill (#4708) covers the new seam: a group the measure's filter
  empties in the _previous_ window now reports `0` for a `count`/`sum` compare
  column rather than blanking it, exactly as it already did for the current period.

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 99ffc04: fix(analytics)!: a measure emits what it declares, instead of `COUNT(*)` (#4157)

  `NativeSQLStrategy.resolveMeasureSql` answered `COUNT(*)` to three different
  questions it could not otherwise answer — each time aliased under the name the
  caller asked for, so the result looked like an answer:

  1. **A measure the cube does not declare.** `lookupMember`'s synthetic
     relation fallback is dimension-only, so any undeclared or mistyped measure
     name landed here. `measures: ['revenue']` against a cube without it returned
     `COUNT(*) AS "revenue"` — a row count presented as revenue.
  2. **A `number`/`string`/`boolean` metric.** `AggregationMetricType` documents
     these as _"Custom SQL expression returning a number / string / boolean"_: the
     measure's `sql` **is** the computation — a ratio, a `CASE`, a window
     function. The expression was discarded and replaced by a row count.
  3. **An unrecognised `type`.** Same silent substitution.

  Now: an undeclared measure and an unrecognised type **throw**, naming the
  declared measures and both accepted vocabularies respectively; a custom-
  expression type emits its expression unwrapped. The six aggregates are
  unchanged.

  **A dot no longer implies a relationship hop.** `qualifyAndRegisterJoin` split
  any dotted string into a join chain, so the expression `SUM(account.amount)`
  became `"SUM(account"."amount)"` _plus_ a `LEFT JOIN "SUM(account"` — invalid
  SQL naming a table that does not exist. Harmless only while the result was
  being thrown away for `COUNT(*)`; emitting the expression makes it matter. A
  dotted string is now treated as a path only when every segment is a bare
  identifier, so `account.amount` still lowers to a qualified column and a join,
  and an expression is emitted as written. That also fixes the same mangling for
  an _aggregate_ measure whose `sql` is an expression — `type: 'sum'` with
  `sql: 'SUM(account.amount)'` was producing the same garbage.

  **Breaking, narrowly.** Two inputs that used to produce SQL now raise: a query
  naming an undeclared measure, and a cube measure with a type outside
  `AggregationMetricType`. Both were returning a wrong number rather than data,
  so nothing correct can depend on them — but a caller that was silently getting
  row counts will now see an error, which is the point. This is the trade #3948
  settled for the drivers.

  Datasets are unaffected: `aggregateToMetricType` only ever emits an
  `AggregationFunction` member, so a compiled dataset never had a
  custom-expression measure or an unknown type. The reachable path is a
  hand-authored Cube.

  `metric-type-coverage.test.ts` asserts the aggregate and expression sets
  _partition_ `AggregationMetricType`, so a tenth metric type fails a test rather
  than reaching the throw. Both sets are named, not derived as each other's
  complement — deriving would classify a new _aggregate_ as an expression and emit
  a bare column, a different silent wrong answer.

  Verified: **460 tests across 35 files** green, including the four suites that
  assert `COUNT(*)` — all of them use a _declared_ `type: 'count'` metric, so none
  relied on a fallback. The 14 new tests were confirmed to fail against the old
  behaviour (6 of 10 in the behaviour suite) before the fix.

### Patch Changes

- b4be309: fix(analytics): a new spec aggregate can no longer silently return a row count

  Track C item 4 of objectstack-ai/objectui#2945 — _"`AggregationFunction`: three
  places in lockstep"_. They agreed only by coincidence, and the failure mode when
  they stopped agreeing was silent wrong numbers.

  The three:

  1. `AggregationFunction` (`@objectstack/spec/data`) — eight members, what an
     author may declare as a dataset measure's `aggregate`.
  2. `UNSUPPORTED_AGGREGATES` (`dataset-compiler.ts`) — `array_agg`/`string_agg`,
     rejected at compile time with a clear error.
  3. The aggregate `switch` in `native-sql-strategy.ts` — six cases, then
     `default: return 'COUNT(*)'`.

  8 − 2 = 6 = the six cases, today. Add a ninth member to the spec — `median`,
  `percentile`, anything — and it would:

  - pass the compiler's gate, since it is not in `UNSUPPORTED_AGGREGATES`;
  - be **advertised as supported** by that gate's error message, which listed
    `count, sum, avg, min, max, count_distinct` as hand-written prose — a third
    copy of the vocabulary;
  - reach the strategy's `switch`, match no case, and fall to
    `default: COUNT(*)`.

  The author asks for a median and gets a row count. No error, no log, wrong
  figures on a dashboard — the same silent-wrong-answer shape as the filter
  operators in #3948, in the analytics SQL builder.

  **The fix is derivation plus a guard, with no behaviour change.** The `switch`
  becomes `AGGREGATE_SQL`, a table whose coverage is assertable; the error
  message's prose list becomes `SUPPORTED_AGGREGATES`, derived as
  `AggregationFunction.options` minus `UNSUPPORTED_AGGREGATES`; and
  `aggregation-lockstep.test.ts` asserts the arithmetic — the lowered set equals
  the admitted set, every spec member is either lowered or explicitly rejected,
  nothing is both, and the rejection list names only aggregates the spec has.

  Verified by adding a hypothetical `median` to the spec, which now fails three
  assertions naming it, including _"these would fall through to the COUNT(_)
  fallback and return a row count"\*. Before this change the same edit was green.

  Nothing is narrowed and no SQL changes: the same six aggregates lower to the
  same six expressions, and the `COUNT(*)` fallback still catches everything else.

  **Reported, not fixed:** that fallback is also reached by a measure whose `type`
  is `number`/`string`/`boolean` — a custom SQL _expression_, per
  `AggregationMetricType` — whose expression is then replaced by a row count.
  Datasets cannot produce one (`aggregateToMetricType` only ever returns an
  `AggregationFunction` member), so it is reachable only from a hand-authored
  Cube. Emitting `col` instead is a behavioural change in an analytics SQL path
  and deserves its own change with its own tests; the strategy's doc comment now
  records it.

- 7a55913: fix(service-analytics): a `$between` analytics filter no longer vanishes from the query (ADR-0053 D-A3.1)

  A dashboard widget or dataset whose filter used `$between` was querying **every
  row**. `normalizeAnalyticsFilters` maps Mongo-style operators onto the internal
  pipeline form, `$between` was missing from that map, and an unmapped operator is
  skipped — so the predicate was silently dropped from the compiled WHERE clause.
  Both strategies read that normalizer, so both the raw-SQL and the ObjectQL
  aggregate paths were affected. The symptom is #3650's: a chart that draws the
  whole dataset instead of the requested window, with nothing in the SQL to
  suggest a filter was ever asked for.

  `$between [min, max]` now lowers to its two bounds (`gte` + `lte`) instead of
  gaining an operator of its own, so a range's max inherits the calendar-day
  whole-day rule (#3777) from each strategy's existing upper-bound handling —
  `NativeSQLStrategy` compiles a bare-day upper bound half-open itself, and the
  ObjectQL path gets the same rule from the driver — rather than needing a second
  implementation to keep in step. A malformed `$between` (not a two-element
  array) now throws instead of being dropped, matching the stance driver-memory
  took for the same shape in #3948: an unbounded read is exactly the failure this
  prevents, and it is indistinguishable from a legitimately wide query.

  Found by giving the temporal conformance matrix its missing sixth consumer
  (`native-sql-temporal-conformance.test.ts`), which executes the shared cases
  against a real SQLite engine and asserts row ids — a dropped predicate is
  invisible to the SQL-string assertions the strategy's other suites use.

- 7a55913: fix(service-analytics): every authorable filter operator now reaches the query (#4128)

  Closes the cause behind the `$between` defect rather than just that instance.
  `normalizeAnalyticsFilters` skipped any operator missing from its map, and a
  skipped predicate does not narrow a query — it **widens** it: the compiled SQL
  stays valid and returns rows the author excluded. Four operators from the
  spec's authorable vocabulary sat in that state, plus one that was mapped
  incorrectly.

  - **`$startsWith` / `$endsWith`** were dropped entirely. Both strategies now
    compile them — anchored `LIKE 'x%'` / `LIKE '%x'` on the raw-SQL path, and
    the canonical `$startsWith` / `$endsWith` operators (which every driver
    implements directly) on the ObjectQL path, so an anchored match does not
    depend on regex dialect.
  - **`$null`** was dropped. It is the shape the console emits for an "is empty"
    / "is not empty" filter, so such a widget was showing every row. Now compiles
    to `IS NULL` / `IS NOT NULL` per its boolean.
  - **`$exists`** was mapped value-_independently_ to `set`, so `{$exists: false}`
    compiled to `IS NOT NULL` — the exact inverse of what it asks for. It and
    `$null` are now resolved explicitly, because a key→name map cannot express an
    operator whose meaning flips with its value.
  - **`$notContains`** reached the ObjectQL strategy, which had no arm for it and
    fell through to a `default` returning a bare value — compiling "does not
    contain x" as "**equals** x".
  - **Unknown operators now throw** on both surfaces instead of being silently
    dropped (normalizer) or reinterpreted as an equality (ObjectQL strategy). An
    operator outside the vocabulary is a caller error, and a loud one beats a
    silently widened read — the call driver-memory made for the same shape in
    #3948.

  Still declared as a gap, but no longer a silent one: `$or` / `$not` are skipped,
  since expressing them needs a recursive WHERE builder rather than the flat
  array the strategies consume.

  Cover is `filter-operator-coverage.test.ts`, which runs the whole vocabulary
  against a real SQLite engine and asserts **row ids** — six of its cases fail
  without this change. A dropped predicate is invisible to the SQL-string
  assertions the strategies' other suites use, which is how these survived.

- f5ab1c7: fix(service-analytics): a `$or` / `$not` filter no longer vanishes from an analytics query (#4128 follow-up)

  The last of the silently-dropped filter family. `normalizeAnalyticsFilters`
  produced a flat **array**, which cannot carry a disjunction, so both strategies
  skipped `$or` and `$not` outright — a widget or dataset whose filter used
  either compiled a WHERE clause that simply did not contain it, and drew every
  row. That is #3650's symptom, and unlike a rejected query it looks like a
  working chart.

  The normalizer now produces a **tree** (`normalizeAnalyticsFilterTree`), and
  each strategy compiles it the way its own backend expresses a disjunction:

  - **`NativeSQLStrategy`** builds the WHERE recursively, routing every leaf
    through its existing clause emitter — so the storage-form coercion and the
    calendar-day upper-bound rule (#3777) apply at every depth, including inside
    an `$or`. Parentheses are explicit rather than relying on SQL precedence.
  - **`ObjectQLStrategy`** hands `$or` / `$not` to the engine, which speaks them
    natively. AND-ed leaves still merge per field exactly as before, so a query
    without combinators produces byte-identical engine input.
  - **`/analytics/sql`** renders the same tree, so the echoed statement keeps
    reproducing what executes rather than showing a conjunction where the engine
    runs a disjunction.
  - The **cross-object envelope check** now sees members nested inside an `$or`.
    It rejects cross-object filters, so a member it could not see was a filter it
    could not reject.

  Empty `$and` / `$or` arrays now throw instead of being ignored, matching the
  fail-closed stance of `read-scope-sql.ts` — the compiler in this same package
  that has always handled the full tree, and whose semantics the tree walker now
  mirrors deliberately.

  Cover is `native-sql-filter-logic-conformance.test.ts`, which runs the shared
  combinator table (`FILTER_LOGIC_CASES`, #3774) against a real SQLite engine and
  asserts row ids. The analytics raw-SQL path now stands beside `driver-sql`,
  `driver-memory`, `formula` and `read-scope-sql` under that one standard; 14 of
  its 17 cases fail without this change.

- 3abd233: fix(analytics): project a `timeDimensions` bucket into the result rows and fields (#4033)

  An analytics query that buckets by `timeDimensions` alone grouped correctly —
  the echoed SQL read `date_trunc('month', due_date) AS "due_date"` — but the row
  mapper and `buildFieldMeta` both enumerated `query.dimensions` only, so the
  bucket never reached the caller: rows carried just the measures and `fields`
  never mentioned the dimension. A trend chart got N values and no x-axis. The
  same query written with `dimensions: ['due_date']` was unaffected, which is why
  it went unnoticed.

  Grouping, row mapping and field metadata now derive the projected set from one
  `projectedDimensions()` helper — `dimensions` plus every _granular_
  `timeDimensions` entry not already among them. A `timeDimensions` entry without
  a granularity contributes only its `dateRange` predicate and stays out of the
  projection, so no phantom column is declared.

- 0af50a3: fix(driver-sql,service-analytics): a bare-day upper bound covers the whole day on `Field.datetime` (#3777)

  A bare `YYYY-MM-DD` comparand anchors to midnight UTC. That is right for a
  lower bound and was silently wrong for an upper one: the dashboard date-range
  filter compiles `{ $gte: from, $lte: to }` with bare-day bounds, so on a
  `datetime` column every row created after 00:00 of the `to` day vanished from
  the result — no error, the chart renders, the numbers are just smaller. The
  default configuration hit it: the filter's default field is `created_at`
  (a system-injected `Field.datetime`) and 7 of the 13 presets end "today".

  The translation is operator-sensitive and half-open, applied at every
  comparison emitter:

  - `SqlDriver` (and `SqliteWasmDriver` by inheritance): `$lte`/`<=` with a
    bare-day comparand on a `datetime` column compiles to `< next-day-midnight`
    in the column's storage form; `$between [min, max]` with a bare-day max
    decomposes to `>= min AND < next-day(max)`. Both the plain and the
    legacy-repair (mixed-storage) column paths, both `where` spellings.
  - `NativeSQLStrategy`: `dateRange` windows and `lte` filters bind `< next-day`
    instead of an inclusive `BETWEEN`/`<=` when the bound is a bare day.
  - The `/analytics/sql` rendering and the dataset preview evaluator apply the
    same rule, so the echoed SQL and drafted numbers reproduce execution.

  `@objectstack/core` gains the shared primitive `nextUtcCalendarDay(value)`:
  the next calendar day of a valid bare `YYYY-MM-DD` (else `null` — instants,
  `Date`s and impossible days are never widened).

  Unchanged on purpose, per the semantics table on #3777: `date`/`time` columns
  (`<= day` is already whole-day-correct there), full-ISO/`Date` comparands
  (instant semantics), and `$gte`/`$gt`/`$lt` (midnight anchoring is correct for
  those). No authored metadata changes: a dashboard's existing
  `{ $gte, $lte }` window now simply includes its final day.

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- c8124e5: fix(driver-sql): give `Field.datetime` one UTC storage form per dialect (#3912, #3942)

  Any window filter on a `Field.datetime` column returned an empty set on SQLite —
  a dashboard `dateRange: last_30_days` on `created_date` read 0 while 29 matching
  rows existed.

  There was never a storage _convention_, only a description of what better-sqlite3
  happened to do with a bound JS `Date`. Nothing enforced it — `formatInput`
  deliberately left `datetime` untouched — so the form was decided by whichever
  writer got there first: a JS `Date` landed as INTEGER epoch ms, while a REST/JSON
  write (JSON has no `Date` type), a `defaultValue: 'NOW()'` slot, and the
  platform's own `created_at` / `updated_at` all landed as ISO **TEXT**. One column
  held both forms while the read path coerced comparands to epoch ms purely from
  the _declared_ type. On SQLite's type ordering (`INTEGER < TEXT`) a two-sided
  window collapsed to zero rows, and a one-sided `>=` matched every TEXT row
  regardless of the bound.

  `Field.datetime` now has one canonical instant per dialect, produced by one
  function applied on write **and** to every filter comparand, so the two sides of
  a comparison cannot disagree about shape:

  - **SQLite** — `YYYY-MM-DDTHH:MM:SS.sssZ` text. Lexicographic order _is_
    chronological order, so range filters and `ORDER BY` read the column directly
    and can use an index; `strftime` parses it, so the date-bucket expression needs
    no CASE.
  - **Postgres** — `timestamptz`, unchanged. The fix here is on the write and
    comparand side: a zone-naive write was previously resolved against the
    _server's_ timezone (measured 8 hours off on `Asia/Shanghai`), and an
    un-anchored `YYYY-MM-DD` comparand meant the server's local midnight, so the
    identical query over the identical instant landed a row on a different calendar
    day than SQLite did.
  - **MySQL** — `DATETIME(3)` instead of `TIMESTAMP`, a connection pinned to UTC on
    both the mysql2 and the server layer, and a MySQL-spelled bind carrying the
    same UTC wall clock. MySQL accepts neither the `T` separator nor the `Z` suffix
    in a datetime literal, so datetime writes over REST had always failed outright;
    `TIMESTAMP` additionally truncated milliseconds and could not store an instant
    outside 1970..2038.

  Existing rows converge at schema sync. Both migrations are allowed to fail: they
  log, mark nothing, and the read paths keep a repair expression, so an un-migrated
  column still compares and buckets **correctly** — just unindexed. Neither can
  repair instants the old timezone-ambiguous write path recorded wrongly; they
  preserve what is on disk.

  Also closes #3928 (datetime `ORDER BY` mis-sorted on mixed storage) by
  construction. Rationale is recorded as ADR-0053 addendum D-B1..D-B4.

  The analytics change is additive: a `coerceTemporalFilterColumn` companion to the
  existing `coerceTemporalFilterValue` hook, so a raw-SQL strategy can normalise the
  column side too. Absent hook → byte-identical SQL.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- f752ee3: feat(analytics): order the time axis by default, and give reports a sort declaration (#3916)

  A matrix report with a date dimension across rendered its columns in arbitrary
  order — `2026-07-01, 2026-07-05, …, 2026-07-02`. Declaring `dateGranularity` on
  the dataset dimension made the bucket keys _sortable_ (`2026-07`, `2026-Q3`)
  without making anything _sort_ them, and the report author had no way to ask:
  `DatasetSelection.order` existed on the wire, but `ReportSchema` had no ordering
  field at all (dashboard widgets had their own `options.sortBy` channel; reports
  did not). Nothing in the chain supplied an order either — `resolveOrdering`
  returned `undefined` unless the selection carried one explicitly, the ObjectQL
  aggregate path has no ordering grammar so its buckets came back in Map-insertion
  order, and the pivot builds its column headers in row-arrival order.

  - **A selected time dimension is now chronological by default.** When a
    selection states no `order` (and no `limit`, whose own fallback already
    ordered by every dimension), each selected dimension the cube types as `time`
    defaults to ASCENDING, in selection order. Bucket keys are minted sort-stable
    precisely so this works — `2026-07` sorts after `2026-06`, `2026-Q3` after
    `2026-Q1`. This lands on both strategy paths: a real `ORDER BY` where native
    SQL serves the query, and the executor's post-pass where a date-bucketed query
    is handed to the ObjectQL path. Null / empty buckets stay last, as everywhere
    else. Deliberately narrow: only time dimensions get a default, so grids with
    nothing wrong with them are not reordered.
  - **Reports can declare an ordering.** `ReportSchema.order` (and
    `blocks[].order` for a `joined` report) is a list of `{ by, direction }` sort
    keys, most significant first — an array, not a `Record`, because key order is
    the contract and JSON object key order should not have to be. `by` must name a
    dimension the report groups by (`rows` / `columns`) or a measure it displays
    (`values`); anything else fails at authoring time rather than becoming an
    ordering that silently does nothing. Duplicate keys are rejected. A `joined`
    report orders per block — declaring `order` on the container is an error.
    `reportSelectionOrder()` lowers the list into the `DatasetSelection.order` a
    renderer posts, and returns `undefined` for an empty list so the runtime's own
    defaults still apply.

  An explicit `order` still wins outright — the chronological default is a
  default, not a policy, so "newest month first" is one declaration away.

  `report.order` ships as `planned` + `authorWarn` in the liveness ledger: the
  framework half is complete and live (schema, lowering helper, executor), but
  objectui's `DatasetReportRenderer` does not yet carry `report.order` into the
  selection it posts. The default time-axis ordering needs no renderer change and
  is live now.

- b3a3d83: feat(spec): a shared temporal conformance matrix, and the `$between` gap it found (ADR-0053 D-A3, #4081)

  `@objectstack/spec/data` gains `TEMPORAL_ROWS` and `TEMPORAL_CASES` — the
  single set of temporal filter cases every backend is checked against, the twin
  of the existing `FILTER_LOGIC_CASES`. Five backends consume it and assert **row
  results**: `driver-sql` (and, through the live-dialect CI job, real Postgres and
  MySQL), `driver-memory`, `driver-mongodb` (real MongoDB), the analytics preview
  evaluator, and `formula`'s RLS write-side `check`.

  This is the regression backstop ADR-0053 D-A3 has asked for since 2026-06 and
  the last of its decisions to be actioned. Four separate incidents — #3650,
  #3773, #3777, #4047 — were each found by a human by accident, and each left a
  suite proving only its own issue against its own fixture. Nothing held the
  backends to one standard, so the fifth divergence had nowhere to fail.

  **`service-analytics` — a real fix the matrix found on its first run.** The
  draft-preview evaluator had no `$between` case, so it fell through to its
  permissive `default` and matched **every** row: a drafted dashboard carrying a
  range filter charted the entire dataset, then changed its numbers at publish —
  the exact continuity the preview exists to provide. It now evaluates
  `$between`, sharing the upper-bound helper with `$lte` so the whole-day
  calendar-day rule (#3777) applies to a range's max as well.

  Also recorded (ADR-0053 D-A3.1): `$gt` with a bare-day comparand on a
  `datetime` column cannot agree between typed and type-blind backends, and the
  gap is irreducible without field types. It is asserted in the shared matrix on
  `date` only, with the `datetime` cell left to the typed drivers' own suites,
  rather than papered over.

- 35accbf: feat(spec): promote the temporal storage hooks onto the IDataDriver contract (ADR-0053 D-A2)

  `temporalFilterValue` and `temporalFilterColumnSql` — the pair that closed
  #3912's storage-form drift — were duck-typed: analytics probed
  `typeof driver.x === 'function'` against a locally-invented interface, and
  nothing at the type level said a driver must implement both or neither. The
  lesson of #3912 is precisely that coercing the comparand without normalising
  the column reintroduces half the bug, so a driver implementing one hook alone
  would silently regress.

  Both are now optional members of `IDataDriver`
  (`@objectstack/spec/contracts`), documented as a pair with "absent = identity"
  semantics for drivers whose storage form is the wire form (memory, mongo).
  `SqlDriver implements IDataDriver`, so its signatures are compile-checked from
  here on; analytics derives its driver seam by `Pick`-ing the contract instead
  of a local duck type. Runtime `typeof` guards remain — that is the correct way
  to consume an optional contract member — but the shape they guard now has one
  authoritative definition.

  No runtime behaviour change. ADR-0053 D-A2 is recorded as resolved.

- e4c2dc8: Order temporal operands correctly when one side is a JS `Date` on the two
  type-blind filter backends (ADR-0053 D-A3 / #4191).

  `utcInstantMs` joins `nextUtcCalendarDay` in `@objectstack/spec/data`
  (re-exported from `@objectstack/core`): it reads the UTC instant a temporal
  operand denotes, accepting only unambiguous spellings — a `Date`, epoch ms, a
  bare `YYYY-MM-DD`, and an ISO timestamp with or without an explicit zone (a
  zone-naive one being UTC, per D-B2) — and returning `null` for everything
  else, notably a bare wall clock, which denotes no instant.

  Both type-blind evaluators now use it to compare a `Date` against wire text,
  which JS relational operators cannot do: `<` and friends coerce with hint
  `number`, so the `Date` becomes its epoch and the string becomes `NaN`.

  - `formula`'s `matchesFilterCondition` (the RLS write-side `check`) dropped
    every `Date`-valued row in 10 of the 16 shared conformance cases. The
    post-image is the caller's raw write payload, so an SDK write of
    `new Date()` hit this directly, and fail-closed turned it into a **denied
    write**.
  - `service-analytics`' preview evaluator diverged on the same 10 cases in
    BOTH directions, because `String(new Date())` sorts after every `'2026-…'`
    comparand — a drafted chart both lost rows and gained ones, then changed
    its numbers at publish. Rows from a mongo-backed dataset arrive as BSON
    `Date`s, so this was reachable in normal use.

  Comparisons that did not involve a `Date` are unchanged.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 840ee4b: fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

  Two independent defects on the `/analytics` surface, found while verifying #3770
  against a real server. On an authenticated CRM dev server, before this change:

  ```
  POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
  → 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
         "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
  ```

  That is SQLite's internal schema table — never a registered object — read
  successfully through the analytics endpoint. Not merely "the name reaches the
  driver and errors": **any table the connection can see was readable.**

  **① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
  auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
  widget queries `crm_account` with no authored Cube — but it accepted _any_ string,
  so the endpoint could aggregate over an arbitrary physical table. The
  analytics-side twin of the data-path gap #3770 closed, and it was not covered by
  that fix: #3770 gated the protocol's `analyticsQuery`, which is the _degraded
  fallback_; a deployment with `@objectstack/service-analytics` installed runs the
  real engine instead (`ctx.replaceService`).

  Inference is now gated on the same schema registry the data path consults, via a
  new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
  from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
  untouched (its `sql` is whatever it declares); an unregistered name that IS an
  object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
  raised before any SQL exists, naming both ways to make the request valid. With no
  probe configured the gate stands down and warns once — the same tiering #3770
  took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

  **② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
  is the single error exit for _every_ route the dispatcher plugin mounts —
  `/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
  `/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
  driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
  driver error on any of those routes shipped its SQL to the client. Unlike ①, this
  half is unconditional — it does not depend on the cube being invalid.

  The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
  `looksLikeInternalErrorLeak` (both packages already depend on it) and is now
  applied at both boundaries — one predicate, one place to widen when a new
  dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
  dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
  business/validation answer and must reach the caller intact. Sanitising costs no
  diagnostics — the untouched error still reaches `errorReporter` through the
  existing `__obsRecordedError` side-channel.

  **Also fixed in the same function:** `errorResponseBase` read only
  `err.statusCode`, while domain errors across this codebase carry `status` (and
  `HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
  4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
  the analytics fallback path — was rendered as a **500**. It now reads `status`
  then `statusCode`.

  **Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
  `CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
  previously the name was passed to the driver. Dashboards and KPI widgets pointed
  at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
  whose message looks like a driver dump now reads `Internal server error` — check
  server logs or your error reporter for the original.

- 587fc91: feat(analytics): the executeAggregate bridge carries ExecutionContext — ADR-0021 D-C second belt

  The analytics→engine bridge now forwards the request's `ExecutionContext` to
  `engine.aggregate`, so the engine's own middleware chain scopes analytics reads
  independently of the analytics layer's `getReadScope`.

  **Why.** `BaseEngineOptions.context` has always been `.optional()`, so nothing
  forced the bridge to pass it — and it did not. An authenticated aggregate
  reached the engine with no principal, plugin-security's principal-less fall-open
  skipped its RLS injection, and the only thing left scoping the query was the
  strategy remembering to call `getReadScope`. #3597 was a strategy that did not,
  and both belts were off at once.

  `getReadScope` stays: the two resolve scope through different paths (engine
  middleware vs `security.getReadFilter`), and a deployment without
  plugin-security has only the analytics layer. This is depth, not a replacement.

  - `StrategyContext` gains `context?: ExecutionContext`, bound per call by
    `AnalyticsService` from `query()` / `generateSql()` / `queryDataset()`.
  - `StrategyContext.executeAggregate` and the `AnalyticsServicePlugin` /
    `AnalyticsService` `executeAggregate` config options gain `context?:
ExecutionContext`. **Custom bridges should forward it** to their engine; the
    built-in auto-bridge does. Purely additive — an existing bridge that ignores
    it keeps working exactly as before.
  - `DimensionLabelDeps.fetchRecordLabels` and `resolveDimensionLabels` each gain
    an optional trailing `context`, beside the `scope` / `resolveScope` that
    #3639 added — the same two-belt split as the aggregate path.
  - `BootOptions.analytics` (`@objectstack/verify`) overrides the
    AnalyticsServicePlugin instance, so a gate can boot with the analytics belt
    off and assert the engine-side belt alone still scopes.

  **Also fixed on the same seam:**

  - `fetchRecordLabels` — the dimension display-label lookup — is row-granular
    (one row per record, real display names). #3639 gave it the analytics-layer
    belt (the referenced object's own read scope); it now also carries the
    context, so the engine scopes the same read independently.
  - `ObjectQLStrategy.generateSql` emitted no `WHERE` at all, so the
    `/analytics/sql` preview read as an unscoped table scan while the real
    aggregate was scoped. It now renders the caller's filters and the read scope.
    The preview never executed, so this was misleading output rather than a leak.

- 763931e: feat(filters): evaluate `{filter-token}` placeholders server-side (#3582)

  Filter values travel as JSON, so a time- or user-scoped slice writes a
  placeholder instead of code:

  ```ts
  filter: { close_date: { $gte: '{current_year_start}' }, owner: '{current_user_id}' }
  ```

  The vocabulary has been in `@objectstack/spec` for a while (`date-macros.zod.ts`,
  `context-tokens.zod.ts`) and `objectstack build` rejects tokens outside it
  (#3574). What was missing is the half that _substitutes a value_: **nothing on
  the server ever did**. A placeholder reached the driver as the literal string
  `'{current_year_start}'`, compared as text, and matched nothing.

  That failure is invisible — an empty widget looks exactly like a metric that is
  legitimately zero — so apps worked around it by computing dates at module load,
  which freezes "this year" into the built artifact and quietly goes stale.

  **New: `resolveFilterTokens()` in `@objectstack/core`**, wired into the two
  server-side seams every filter passes through:

  - **ObjectQL read path** — `find` / `findOne` / `count` / `aggregate`, so REST
    queries, related lists, saved-view filters and flow `find_records` all resolve.
    It runs before the middleware chain, so only author-supplied filters are
    inspected; RLS/sharing filters are injected downstream from concrete values.
  - **Analytics dataset executor** — a dataset's intrinsic `filter`, a widget's
    `runtimeFilter`, measure-scoped filters, and time-dimension `dateRange`s.
    This path needs its own call: `NativeSQLStrategy` compiles raw SQL and binds
    comparands directly, so a dashboard widget never passes through `engine.find()`.

  Behavioural notes:

  - Date tokens resolve to ISO strings (`YYYY-MM-DD`, or a full timestamp for
    `{now}` / `{N_hours_ago}` / `{N_minutes_ago}`). Turning that into a column's
    on-disk form stays the driver's job (`SqlDriver.temporalFilterValue`), so
    there is still exactly one source of truth for the storage convention.
  - Calendar boundaries follow `ExecutionContext.timezone`; one instant is pinned
    per filter tree, so a `>= {current_month_start}` / `< {next_month_start}` pair
    can never straddle a boundary.
  - `{current_org_id}` reads `ExecutionContext.tenantId`; `{current_user_id}` reads
    `userId`. A request carrying neither now **throws** instead of resolving to
    `null` — a null comparand degrades to `IS NULL` on most drivers and would hand
    back the rows the filter was written to exclude.
  - An unrecognised placeholder **throws**, carrying the near-miss fix
    (`{current_user}` → `{current_user_id}`, `{this_quarter_start}` →
    `{current_quarter_start}`). This matches what `objectstack build` already
    enforces. Consequence, previously implicit and now load-bearing: a filter value
    that is _entirely_ `{...}` is always read as a placeholder, so a literal value
    of that shape is not expressible — rename the value.

  Also in this change: `notify` no longer sends the six-character string
  `"undefined"` as an audience member. `to: ['{record.owner.manager}']` walks
  `.manager` on a scalar foreign-key id, resolves to nothing, and `String(undefined)`
  turned that into a phantom recipient — the emit "succeeded", addressed nobody,
  and said nothing. Unresolved recipients are now dropped, and a node with no
  recipient left fails naming the offending template and pointing at the start
  node's `config.expand` (#3475), which does hydrate the relation.

- fc5f126: feat(analytics): serve in-envelope cross-object grouping on the ObjectQL path by FK-expand (#3654)

  `engine.aggregate()` cannot join, so the ObjectQL fallback path (date-granularity
  bucketing, in-memory driver, federated objects) previously REJECTED any
  cross-object grouping like `revenue by account.region` (#3664 stopgap — a loud
  error instead of the earlier silent `(null)` mis-bucket). It now SERVES the
  common case directly.

  For a single-hop cross-object DIMENSION with recombinable measures, the strategy:

  1. groups the base aggregate on the lookup FK column (`account`) — which the
     engine can do — scoped to the base object;
  2. resolves each FK id to the related attribute (`region`) with a read of the
     referenced object **scoped to that object's own RLS**; then
  3. re-buckets by the resolved attribute in memory, recombining the measures
     (sum/count add; min/max take the extremum).

  A base row whose referenced record the caller cannot read buckets under an
  explicit `(restricted)` group: its measure still counts (grand totals are
  preserved) but the hidden record's attribute never appears — no leak (ADR-0021
  D-C, the #3602 class). `/analytics/sql` renders the equivalent `LEFT JOIN`.

  Deliberately bounded — still REJECTED (loud, never silently wrong): cross-object
  references in a MEASURE or FILTER (need a real join to evaluate), multi-hop
  dimensions (`a.b.c`), and non-recombinable measures (`avg`, `count_distinct`)
  with a cross-object dimension. Cross-object queries on `NativeSQLStrategy` (the
  normal SQL path) are unchanged — it hand-compiles the joins.

### Patch Changes

- c7f4417: fix(driver-sql,analytics): stop `aggregate()` / `distinct()` leaking SQLite's raw epoch storage (#3797)

  Both returned `await builder` directly, without the `formatOutput` pass every
  `find()` row gets. On SQLite — the one dialect where a `Field.datetime` is
  stored as INTEGER epoch milliseconds rather than a native timestamp — that raw
  storage form went straight to the caller:

  | call                                   | before                       | after                            |
  | -------------------------------------- | ---------------------------- | -------------------------------- |
  | `find()`                               | `"2026-01-10T09:00:00.000Z"` | unchanged                        |
  | `distinct('closed_at')`                | `[1768035600000]`            | `["2026-01-10T09:00:00.000Z"]`   |
  | `aggregate()` `max(closed_at)`         | `1768035600000`              | `"2026-01-10T09:00:00.000Z"`     |
  | `aggregate()` `groupBy: ['closed_at']` | key `1768035600000`          | key `"2026-01-10T09:00:00.000Z"` |

  Same root cause as #3773, different exit. `Field.date` was never affected — it
  is ISO TEXT on every dialect, so its storage form already equals its
  presentation.

  The visible surfaces were a `_max`/`_min` measure over a datetime (a "last
  closed" KPI tile rendered `1768035600000`) and a `groupBy` on a raw datetime
  dimension, which also disagreed with the in-memory `applyInMemoryAggregation`
  fallback — that one consumes already-formatted `find()` rows, so the same
  dataset changed key type depending on which path served it.

  Which columns hold an instant is now recorded while the statement is built,
  because that is the only point where a column name and its meaning are both
  known: a `min()` lands under its alias and never under the field name, while a
  date-BUCKETED column lands under the field name but holds a label (`'2026-01'`)
  rather than an instant. Matching on names afterwards gets both backwards.

  `distinct()` additionally re-deduplicates after presenting: SQL `DISTINCT`
  compares STORED values, and one SQLite datetime column holds both INTEGER and
  TEXT forms, so two rows recording the same instant survived as two and then
  presented identically. It has no in-repo callers today; this keeps it honest
  rather than leaving a second convention in the driver.

  **`cross-object-rebucket` was fixed alongside it, because presenting min/max
  correctly is what exposed it.** `recombine()` coerced every operand with
  `Number()`, which silently depended on receiving an epoch: handed the ISO string
  the driver now returns it produced `NaN`, and on Postgres/MySQL (where knex
  returns a `Date`) it had always flattened the value back to an epoch integer one
  layer above the driver. `min`/`max` now order by the instant and return the
  winning value in the shape it arrived in; `sum`/`count` stay numeric.

- 7101ca2: fix(analytics): apply the EFFECTIVE date granularity to bucket labels and drill ranges (#3588 follow-up)

  `selection.dateGranularity` (shipped in #3652) reached the `GROUP BY` but not the
  post-processing: the bucket-label formatter and the drill-range inverter both
  kept reading the DATASET dimension's default. A query was grouped one way and
  described another. Found by driving a real dashboard query in a browser against
  a dataset whose dimension declares `dateGranularity: 'month'`:

  - selection `year` → the row came back labelled **`1970-01`** — a year bucket
    re-formatted with the dataset's month granularity, its `"2026"` key re-read as
    2026 _milliseconds_ past the epoch;
  - selection `day` → day buckets were re-labelled as months, so ten distinct days
    collapsed into two duplicated keys;
  - selection `quarter` / `year` / `day` / `week` → `drillRanges` came back empty,
    silently removing drill-through from every bucketed chart.

  Granularity precedence now lives in one exported function,
  `resolveDimensionGranularity`, called from all three sites that must agree — the
  query's `GROUP BY`, the label formatter, and the range inverter. The drift was
  possible only because each site resolved it independently.

  Two consequences beyond the override case:

  - A dataset dimension that declares **no** granularity but is bucketed by the
    widget now gets drill ranges too. Previously the range sidecar keyed off the
    dataset's own `dateGranularity`, so this case — the one #3588 is actually
    about — could never drill.
  - `formatDateBucket` no longer mistakes a bare year key for an epoch timestamp.
    A year bucket's canonical key IS `"2026"`, which is the only bucket key that
    collides with the pure-digit epoch heuristic (`"2026-Q2"`, `"2026-07"` and
    `"2026-07-15"` all fail it). Being idempotent over already-formatted keys is
    that function's stated contract; the year case just never held.

- 415254c: fix(analytics): scope the dimension-label lookup to the referenced object's RLS (#3602)

  When a dataset groups by a `lookup`/`master_detail` dimension, analytics resolves
  the grouped FK ids to the related record's display name via a per-record read
  (`group by id`) dressed as an aggregate. That read carried **no read scope**, so
  it revealed related-record display names whenever the referenced object's RLS is
  stricter than the base object whose rows carry the id — a user could see a name
  the referenced object's own RLS would hide. (Same-object and looser-referenced
  cases were already safe because the ids come from the post-#3597 scoped
  aggregate; this closes the stricter-referenced case.)

  The label lookup now applies the **referenced object's own** read scope — bound
  to the request via the same `getReadScope` provider the aggregate path uses,
  composed with `$and` (never key-merge) so it can't be displaced by the id
  predicate. Fail-closed: if that object's scope can't be resolved, the dimension's
  labels are skipped (the raw id renders) rather than fetched unscoped. No behaviour
  change when no read-scope provider is configured.

  Internal `DimensionLabelDeps.fetchRecordLabels` gains an optional `scope` argument
  and `resolveDimensionLabels` an optional `resolveScope` resolver; both are
  service-analytics-internal (no spec/contract change).

- 1f8390b: fix(analytics): ObjectQLStrategy now enforces the read scope (RLS + tenant) (#3597)

  `ObjectQLStrategy` never consumed `getReadScope`, so any analytics query served by
  that path ran with **no RLS or tenant predicate** — an authenticated caller
  received aggregates computed over every tenant's rows.

  Both belts were off at once. The strategy dropped the pre-resolved read scope, and
  the engine could not compensate: the `executeAggregate` bridge passes no
  `ExecutionContext`, so plugin-security's principal-less fall-open skipped its own
  RLS injection. Only `NativeSQLStrategy` was ever wired for ADR-0021 D-C.

  The exposure was **not** limited to exotic drivers. `NativeSQLStrategy` declines —
  handing the query to this path — on any date-bucketed query
  (`timeDimensions[].granularity`, the most common dashboard shape, on Postgres and
  SQLite too), on `RAW_SQL_UNSUPPORTED` (in-memory driver), and on federated objects.

  The scope is composed with `$and`, never by key merge, so a caller filter naming
  the same field (e.g. `organization_id`) cannot displace the security predicate.

  **Behaviour change to be aware of:** a query that references a **joined** object
  carrying its own read scope is now REJECTED on this path rather than run
  partially-scoped. `engine.aggregate`'s `where` addresses the base object, so a
  per-join predicate cannot be expressed there; failing closed matches the posture
  already taken by `resolveReadScopes` and `compileScopedFilterToSql`. Such a query
  previously returned results that omitted the joined object's tenant predicate.
  Run it on a native-SQL driver (`NativeSQLStrategy` scopes each join), or drop the
  cross-object dimension/measure.

  Deployments with no read-scope provider configured are unaffected — that path
  stays unscoped by documented contract.

- 3167e29: fix(analytics): sort dataset selections by the display label for select/lookup dimensions (#3680)

  `DatasetSelection.order` (what a widget's `options.sortBy` lowers to) sorted a
  `select` or `lookup`/`master_detail` dimension by its STORED value — the option
  value or the foreign-key id — while the response rows carry the resolved display
  label. A "sort by Account" therefore ordered by opaque ids and read as arbitrary;
  a localized select sorted by its ASCII value while showing a non-ASCII label.

  Order keys naming a label-bearing dimension now sort by the display label the
  user reads. The executor receives an injected sort-key hook (`OrderLabelResolver`,
  built by `queryDataset` over the same label-resolution capabilities and #3602
  read scoping as the display pass); only the COMPARISON substitutes the label —
  rows keep their raw values until the display pass, so drill metadata still
  snapshots stored values, and ordering + windowing stay one adjacent step (a
  "top 10 by account name" truncates the right ten).

  Cost model: sorting by a measure or a plain/date dimension is unchanged (SQL
  pushdown included). A label-ordered `select` resolves from field metadata (no
  query). A label-ordered `lookup` costs one batched id→name read over the
  pre-window grouped ids (chunked, and reused by the display pass via a
  per-request cache), and its window can no longer be pushed into SQL — the
  inherent price of ordering by a value the database doesn't store.

- 0a6fb1e: fix(analytics): the read-scope auto-bridge no longer depends on plugin order (#3618)

  `getReadScope` was only wired when the `security` service already existed at this
  plugin's `init()`. The closure itself resolved lazily, but the ASSIGNMENT was
  gated on an init-time probe — so a kernel that registers `AnalyticsServicePlugin`
  before the security plugin got **no read-scope provider at all**, and every
  analytics strategy ran unscoped with only a WARN to show for it.

  Both sibling bridges (`executeAggregate`, `executeRawSql`) are wired
  unconditionally and resolve at call time, and this one's own comment claimed the
  same. Now it actually does: the probe only decides the log wording.

  The CLI (`os serve`) registers security before analytics, so that path was
  already correct. The exposure was for embedders composing their own kernel — and
  for this repo's own `bootStack` harness, which registers analytics first, meaning
  the entire dogfood/verify suite had analytics RLS silently disabled and any RLS
  assertion written there passed vacuously.

  Also corrects the WARN text: with no provider, scoping is absent on ALL paths and
  ALL objects, not just "the raw-SQL path" and "joined objects" as it claimed.

  Adds `analytics-rls.dogfood.test.ts`: an owner-scoped RLS fixture driven over real
  HTTP as a real non-admin, asserting the rows a member's aggregate actually
  returns. Reverting either this fix or the #3597 strategy fix turns it red.

- 1986594: feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

  Three presentation options were accepted by the metadata layer and then dropped
  by the analytics query builder. They reached no SQL, produced no error, and the
  only way to notice was to read the `sql` a dataset response echoes — so a
  dashboard could declare `dateGranularity: 'month'` and quietly render one bar
  per record.

  - **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
    `dateGranularity`, applied to every selected `date` dimension. Precedence per
    dimension: an explicit `timeDimensions` granularity, then the selection's,
    then the dataset dimension's own default. A widget can bucket a trend by month
    without the dataset committing every other consumer to that granularity.
  - **`order` / `limit` / `offset` now apply on every path.** They are applied to
    the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
    columns attach, and after derived measures are computed — so a derived measure
    is a valid sort key and the ObjectQL aggregate path (which has no ordering
    grammar, and which native SQL hands every date-bucketed query to) orders
    identically to native SQL. A single-query selection still pushes the window
    down into the statement. An `order` key that names nothing the selection
    projects is now rejected (400) rather than silently ignored.
  - **`limit` is deterministic.** Without an `order`, a limit orders by the
    selected dimensions first, so it truncates a reproducible window instead of an
    arbitrary subset.
  - **Widget `options` is a contract again.** The four query-affecting keys
    (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
    declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
    an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
    `striped`, …) pass through untouched.

  Two latent bugs surfaced while fixing the above and are fixed here too:

  - `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
    supplementary query selects one measure, so an inherited `ORDER BY` named a
    column it never selected, and an inherited `LIMIT` truncated it before the
    merge — dropping rows from the assembled grid. Nothing hit this only because
    nothing passed `order`.
  - The `compareTo` pass built its query by hand and skipped granularity
    resolution, so a month-bucketed primary grid was merged against raw-timestamp
    comparison rows. No dimension key matched and every `<measure>__compare`
    column came back empty.

  `ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
  `WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
  Previously the `sql` field simply vanished from the response whenever a query
  was date-bucketed, leaving an author unable to tell "not implemented" from "this
  strategy doesn't report".

- a227ed7: fix(objectql)!: one key for the empty group bucket — real `null`, on both aggregation paths (#3839)

  A grouped row whose dimension value is empty now carries `null` for that
  dimension no matter which way the aggregate ran. Downstream code can test the
  empty bucket with a plain `value == null` again: charts render their own empty
  label, drill-through on that bucket builds `field = null` and returns the rows
  it should, and a dashboard no longer changes shape when the driver, the
  granularity or the reference timezone changes.

  ### What was wrong

  `engine.aggregate` has two implementations of one feature. It pushes the
  aggregate down as SQL when the driver advertises every requested granularity and
  the reference timezone is UTC; otherwise it fetches rows and buckets them in JS.
  The two disagreed about how to spell "empty":

  ```
  --- same dataset, same query, one row with a NULL value ---
    pushed-down SQL : [{ "key": null,     "type": "null",   "total": 2 }, …]
    in-memory       : [{ "key": "(null)", "type": "string", "total": 2 }, …]
  ```

  The measures were always right — only the key's type and literal differed —
  which is why this went unnoticed for so long: every total reconciled. But the
  engine picks a path per query, so the same data produced a different bucket key
  on SQLite-plus-UTC-plus-`month` than on `week` (which SQLite does not advertise),
  a non-UTC timezone, or `driver-rest` / `driver-memory` / a remote Turso, all of
  which bucket in memory unconditionally.

  It was never date-specific either. A plain `groupBy: ['stage']` over a NULL
  column diverged the same way.

  Consumers are written against `null` — they check `== null` and supply their own
  empty label ('—', '(empty)', a localized "Uncategorized"). The sentinel defeated
  every one of them: it rendered a raw English debug string in the UI, and a drill
  on the empty bucket compiled to `field = '(null)'` and matched nothing.

  The in-memory path's comment justified the string as staying "consistent with
  the client `useReportData` hook". That hook was removed with ADR-0021, and the
  literal never appeared in it.

  ### What changed

  - `applyInMemoryAggregation` and `bucketDateValue` (`@objectstack/objectql`) key
    the empty bucket as `null`. `bucketDateValue` now returns `string | null`. A
    null instant and an unparseable one still share one bucket, because SQL cannot
    tell them apart either (`strftime('%Y-%m', 'not-a-date')` is NULL).
  - The internal composite bucket id is JSON-encoded, so the empty bucket stays
    distinct from a row whose value is the literal string `"null"`.
  - `bucketKeyToCalendarRange` (`@objectstack/core`) accepts `string | null`. The
    empty bucket has no calendar span, so a drill on it opens the unscoped
    superset instead of an invented bound — unchanged behavior, honest signature.
  - The driver output contract in `@objectstack/spec` now states the rule: a row
    with no value keys as `null`, never a sentinel. Propagating NULL through the
    bucket expression is the whole of it; a driver only breaks it by adding a
    `COALESCE`.

  ### Gates

  `checkDateBucketParity` (`@objectstack/verify`) deliberately carried no null
  instant, because the divergence would have failed it for a reason it was not
  about. Its fixture now has one, so the convergence is held in place — including
  for out-of-tree drivers that run the check against themselves.

  Two fixes were needed to make that fixture meaningful:

  - The check folded bucket labels through `String(value)`, which turns SQL NULL
    into `'null'` — a label a TEXT column can genuinely hold. A driver spelling
    "empty" as a string could compare equal to one returning real NULL. The empty
    bucket is now keyed out of band.
  - Label sets were compared with `JSON.stringify`, which is sensitive to key
    insertion order. Row order is not part of this contract and the two paths
    naturally differ (SQL sorts its groups; the in-memory path emits first-seen
    order), so a driver with entirely correct buckets could be reported as
    disagreeing — with an empty diff message, since nothing actually differed.
    The comparison is now order-insensitive.

  A new dogfood check covers the non-date half against real drivers: same dataset,
  plain and date-bucketed `groupBy`, both paths, one key.

- adabaa8: fix(analytics): fail closed on cross-object aggregation the ObjectQL path cannot join (#3654)

  `engine.aggregate()` has no join — it never expands a lookup and the SQL driver's
  aggregate emits no `JOIN`. So a dotted dimension/measure like `account.region`
  reaching `ObjectQLStrategy` (the fallback NativeSQL declines: date-granularity
  bucketing, in-memory driver, federated objects) failed SILENTLY: the in-memory
  path bucketed every row under one `(null)` group and summed the whole table into
  it (a plausible number that is actually a mislabelled full-table total), and the
  native path errored on the unresolved column.

  `ObjectQLStrategy` now rejects any cross-object reference outright, with a clear
  message, before the query reaches the engine. This generalizes the #3597 guard
  (which only rejected when the joined object carried a read scope, and skipped the
  check entirely when no read-scope provider was configured — so the silent
  `(null)` bucket still shipped on unsecured/in-memory setups) into an
  unconditional one, and subsumes it: a rejected query never loads the joined
  object, so there is nothing left unscoped.

  Cross-object datasets are unaffected on `NativeSQLStrategy`, which hand-compiles
  the LEFT JOINs (and scopes each). This only changes the fallback path, turning a
  silent wrong answer into a loud, actionable error. Full lookup-traversal support
  in the aggregate path is left as follow-up (see #3654).

- 605c23f: fix(analytics): ObjectQLStrategy applies `timeDimensions[].dateRange` — the predicate every date-bucketed chart was missing (#3650)

  `ObjectQLStrategy.execute()` built its engine filter purely from
  `normalizeAnalyticsFilters(query)`, which reads only `query.where`. But
  `dateRange` is a **sibling** of `where`, never folded into it — so the window
  was dropped on the floor. No error, no warning: the chart rendered, and the
  numbers were for all of history.

  This was not a "some drivers only" corner. `NativeSQLStrategy.canHandle`
  declines any query carrying a `granularity`, so a **date-bucketed trend lands on
  the ObjectQL path on every driver**, Postgres and SQLite included — and a
  bucketed trend is precisely the shape that also carries a range ("last 12
  months", "this quarter"). The other two paths always applied it
  (`NativeSQLStrategy` as `BETWEEN`, `preview-evaluator` row-wise); only this one
  did not.

  **Two visible symptoms:**

  - A trend chart with a time filter plotted **every row ever recorded** instead
    of the selected window.
  - `compareTo` (period-over-period) was **structurally dead**. `runCompare`
    builds the comparison pass by shifting `dateRange` and changing nothing else,
    so with the window ignored both passes issued a byte-identical aggregate:
    every `<measure>__compare` column equalled its primary and the delta was a
    flat 0%. And since `compareTo` requires a time dimension, it always took this
    path.

  The window now lowers to an inclusive `{$gte, $lte}` on the resolved field — the
  same shape `NativeSQLStrategy` binds as `BETWEEN` and the memory driver builds
  as a `$match` — so one dashboard reads the same on every driver. No storage
  coercion is applied here on purpose: unlike the raw-SQL path (which had to learn
  about SQLite's INTEGER epoch in #2034), this path goes through
  `engine.aggregate()`, where the driver's own CRUD filter coercion already
  handles a `where` bound on that same column.

  **Same-field composition was fixed alongside it**, because the window makes it
  routine. Operands merged into one field entry by spreading, which silently kept
  whichever came last: a `where` bound and a window bound on `close_date` would
  have had one erase the other, and a `where` that names one field twice through
  `$and` (`{$and: [{stage: 'won'}, {stage: {$ne: 'lost'}}]}`) already lost its
  first operand today. Operands that name **different** operators still share one
  entry; colliding ones become their own `$and` conjunct, so the engine
  intersects them instead of the strategy picking a winner.

  `generateSql()` renders the window as a parameterised `BETWEEN` to match — its
  comment previously explained why a `BETWEEN` was deliberately absent, which was
  correct only while `execute()` dropped the window. Bounds bind as `$n`
  placeholders, never inlined: the echoed statement travels to the browser.

  A window on a **cross-object** time dimension is still rejected, and is now
  reported as the bucketing error it is rather than as the "cross-object filter"
  its lowered predicate would otherwise resemble. `execute()` and
  `/analytics/sql` continue to accept and reject the same set.

  Relative-phrase ranges ("Last 7 days") are still not resolved on this path, and
  a bare-string `dateRange` degenerates to a single point — both matching
  `NativeSQLStrategy` exactly, rather than inventing a second interpretation for
  the driver-independent path.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Minor Changes

- a9459e6: Analytics drill metadata now snapshots raw grouped values for totals/subtotal rows too (#3214). The ADR-0021 D2 drill sidecar (`drillRawRows`, #2080) only covered `result.rows`, but the totals rows added in #1753 carry dimension values and go through the same label resolution — which overwrote their stored value (select option value, lookup/master_detail FK id) with the display label, leaving a subtotal drill nothing to exact-match on.

  `queryDataset` now also emits `drillRawTotals`, aligned to `result.totals` by index (`drillRawTotals[i][j]` ↔ `result.totals[i].rows[j]`), captured in the same pre-label-resolution pass. Each map is restricted to the drillable dimensions the grouping actually groups by, so the grand-total grouping (`[]`) contributes an empty map per row. Purely additive result props (same as #2080) — no spec-contract change.

- dd9f223: feat(analytics): scope a datetime date-bucket drill to the reference-tz midnight instants (#1752 follow-up)

  Closes the one gap left by the initial #1752 change: a `datetime` date dimension
  bucketed under a **non-UTC reference timezone** previously fell back to a superset
  drill (its bucket boundary is that tz's midnight _instant_, which `YYYY-MM-DD`
  calendar bounds can't express).

  - **`@objectstack/core`** adds `zonedDateStartToUtcMs(ymd, tz)` — the UTC instant
    at which a calendar day begins in a reference timezone (the inverse of
    `calendarPartsInTz`). DST-safe: the offset is read from the platform tz
    database via `Intl`, with a two-pass resolution for the rare offset-boundary
    case; an unset/`'UTC'`/invalid zone returns plain UTC midnight.
  - **`@objectstack/service-analytics`** now emits `drillRanges` bounds per the
    field's temporal type (ADR-0053): a `datetime` field → ISO **instant** bounds
    at the reference tz's midnight (works under any tz, incl. DST); a `date` field
    → `YYYY-MM-DD` calendar bounds (tz-naive, exact under any tz). An unknown field
    type is still emitted only under UTC and omitted (superset) under a non-UTC tz.

  No objectui change is needed — the client already forwards whatever bound values
  the server sends into the drill filter and the `filter[field][gte|lt]` URL.

- 290e2f0: feat(analytics): emit a half-open date-range drill scope for granularity-bucketed date dimensions (#1752)

  A report/dashboard cell grouped by a `dateGranularity` date dimension ("2026-Q2")
  covers a SPAN of records, so drilling it needs a range (`>= start AND < nextStart`),
  which the equality drill contract (`drillRawRows`) can't express — date dims were
  therefore excluded from drill metadata and a drill landed on an unscoped superset.

  - **`@objectstack/core`** adds `bucketKeyToCalendarRange(key, granularity)`, the
    inverse of `bucketDateValue`: it turns a canonical bucket key into its half-open
    `[start, end)` calendar span (`YYYY-MM-DD`, `end` exclusive). Pure, timezone-naive
    calendar arithmetic; returns `null` for unbucketable / out-of-range keys so the
    caller falls back to an unscoped (superset) drill rather than emit a wrong bound.
  - **`@objectstack/service-analytics`** emits a `drillRanges` sidecar (aligned to
    `rows` by index — the range companion to `drillRawRows`) for `date` +
    `dateGranularity` dimensions, computed from the canonical bucket key in the
    pre-label-resolution snapshot pass. A `datetime` field under a non-UTC reference
    timezone is omitted (host drills a superset) until instant-boundary support
    lands; a tz-naive `date` field is exact under any timezone (ADR-0053).

  Consumed by objectui's report drill-through to scope the drilled record list to the
  clicked time bucket.

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- a9459e6: Analytics drill metadata now snapshots raw grouped values for totals/subtotal rows too (#3214). The ADR-0021 D2 drill sidecar (`drillRawRows`, #2080) only covered `result.rows`, but the totals rows added in #1753 carry dimension values and go through the same label resolution — which overwrote their stored value (select option value, lookup/master_detail FK id) with the display label, leaving a subtotal drill nothing to exact-match on.

  `queryDataset` now also emits `drillRawTotals`, aligned to `result.totals` by index (`drillRawTotals[i][j]` ↔ `result.totals[i].rows[j]`), captured in the same pre-label-resolution pass. Each map is restricted to the drillable dimensions the grouping actually groups by, so the grand-total grouping (`[]`) contributes an empty map per row. Purely additive result props (same as #2080) — no spec-contract change.

- dd9f223: feat(analytics): scope a datetime date-bucket drill to the reference-tz midnight instants (#1752 follow-up)

  Closes the one gap left by the initial #1752 change: a `datetime` date dimension
  bucketed under a **non-UTC reference timezone** previously fell back to a superset
  drill (its bucket boundary is that tz's midnight _instant_, which `YYYY-MM-DD`
  calendar bounds can't express).

  - **`@objectstack/core`** adds `zonedDateStartToUtcMs(ymd, tz)` — the UTC instant
    at which a calendar day begins in a reference timezone (the inverse of
    `calendarPartsInTz`). DST-safe: the offset is read from the platform tz
    database via `Intl`, with a two-pass resolution for the rare offset-boundary
    case; an unset/`'UTC'`/invalid zone returns plain UTC midnight.
  - **`@objectstack/service-analytics`** now emits `drillRanges` bounds per the
    field's temporal type (ADR-0053): a `datetime` field → ISO **instant** bounds
    at the reference tz's midnight (works under any tz, incl. DST); a `date` field
    → `YYYY-MM-DD` calendar bounds (tz-naive, exact under any tz). An unknown field
    type is still emitted only under UTC and omitted (superset) under a non-UTC tz.

  No objectui change is needed — the client already forwards whatever bound values
  the server sends into the drill filter and the `filter[field][gte|lt]` URL.

- 290e2f0: feat(analytics): emit a half-open date-range drill scope for granularity-bucketed date dimensions (#1752)

  A report/dashboard cell grouped by a `dateGranularity` date dimension ("2026-Q2")
  covers a SPAN of records, so drilling it needs a range (`>= start AND < nextStart`),
  which the equality drill contract (`drillRawRows`) can't express — date dims were
  therefore excluded from drill metadata and a drill landed on an unscoped superset.

  - **`@objectstack/core`** adds `bucketKeyToCalendarRange(key, granularity)`, the
    inverse of `bucketDateValue`: it turns a canonical bucket key into its half-open
    `[start, end)` calendar span (`YYYY-MM-DD`, `end` exclusive). Pure, timezone-naive
    calendar arithmetic; returns `null` for unbucketable / out-of-range keys so the
    caller falls back to an unscoped (superset) drill rather than emit a wrong bound.
  - **`@objectstack/service-analytics`** emits a `drillRanges` sidecar (aligned to
    `rows` by index — the range companion to `drillRawRows`) for `date` +
    `dateGranularity` dimensions, computed from the canonical bucket key in the
    pre-label-resolution snapshot pass. A `datetime` field under a non-UTC reference
    timezone is omitted (host drills a superset) until instant-boundary support
    lands; a tz-naive `date` field is exact under any timezone (ADR-0053).

  Consumed by objectui's report drill-through to scope the drilled record list to the
  clicked time bucket.

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- 5eef4cf: feat(analytics): multi-hop relationship joins for datasets (ADR-0071)

  A dataset's `include` and dimension/measure `field` paths may now traverse up to
  3 to-one relationship hops (`account.owner.region`), not just one. The compiler
  expands each declared path into the ordered join chain (one `cube.join` per path
  prefix, aliased dot-free as `account__owner` so it stays a single valid SQL
  identifier), and the NativeSQLStrategy emits the chained `LEFT JOIN`s. Per-hop
  tenant/RLS read-scope is enforced for EVERY object in the chain — the
  alias-driven scope loop already generalizes, so no security path is rewritten.

  Restricted to **to-one** (lookup / master_detail) relationships, which never fan
  out — aggregates stay correct with no symmetric-aggregate machinery; to-many
  traversal is out of scope. Single-hop datasets are byte-for-byte unchanged (the
  dot-free alias is a no-op for a single segment). Undeclared paths are still
  rejected (ADR-0021 D-C); paths beyond 3 hops are rejected at both parse and
  compile time.

### Patch Changes

- 910a8f0: fix(analytics): compare boolean filters/group-by against the real boolean, not stringified '1'

  The analytics filter normalizer stringified boolean `true` → `'1'`, which the
  ObjectQL strategy then coerced back to the number `1` before calling
  `engine.aggregate`. Boolean fields hold a real `true`/`false`, so `1 !== true`
  never matched: a metric widget filtered on a boolean field (e.g.
  `{ is_critical: true }`) always returned 0, and pie/donut/bar charts grouped by
  a boolean dimension failed to bucket. `stringifyForCube` now serializes booleans
  as the tokens `'true'`/`'false'`, and a new `coerceFilterValueForObjectQL`
  recovers a real boolean for the ObjectQL engine while the SQL path keeps binding
  `1`/`0` (better-sqlite3 cannot bind a JS boolean).

- 715d667: fix(analytics): qualify base-object columns in joined dataset queries

  A dataset that joins a related object (`include` + a `relationship.field`
  dimension/measure) emitted BARE base-table columns in SELECT/GROUP BY while the
  joined columns were alias-qualified. When the base and joined tables share a
  column name (e.g. both have `status`), the query failed at runtime with
  "ambiguous column name". `NativeSQLStrategy` now qualifies plain base-column
  identifiers with the base table when the cube has joins; single-object cubes
  are unchanged (byte-for-byte identical SQL).

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- f73d40a: fix(analytics): log scalar auto-inferred cubes at debug, not warn

  Scalar metric queries (measures only, no `dimensions`/`timeDimensions`) over an
  unregistered cube — the first-class `object-metric` "metric over an object" path
  — auto-infer a trivial count/sum cube by design. That auto-infer now logs at
  `debug` instead of `warn`, so boot/render no longer spams
  `No cube registered for "..."` for a non-problem. Grouped queries (explicit
  dimension / time bucket) over an unregistered cube keep the `warn`, where a
  forgotten cube registration is a real mistake.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Minor Changes

- 49da36e: feat(analytics): correct analytics over federated objects (ADR-0062 Phase 3, D6)

  Analytics over an external (federated) object now aggregates against the
  **correct** remote table instead of silently querying the wrong one. The
  `NativeSQLStrategy` hand-compiles `FROM "<object>"` and bare column references,
  which bypass the driver's physical-table resolution (`external.remoteName` /
  `remoteSchema` / `columnMap`). It now **declines** any query whose base or joined
  object is federated, routing it to the `ObjectQLStrategy` — whose
  `engine.aggregate()` goes through the driver's `getBuilder` and already honours
  `remoteName`/`remoteSchema` (#2138/#2149). This "reuses the driver's resolution"
  (D6) rather than re-implementing it.

  Adds an optional `StrategyContext.isExternalObject(objectName)` hook (reported by
  the analytics plugin from the object's `external` block). Purely additive — with
  no hook, behavior is unchanged for managed objects.

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Minor Changes

- 70609af: Resolve a monetary measure's display currency via the field→tenant chain.

  A dataset measure-currency now resolves through: explicit measure `currency` →
  source-field `currencyConfig.defaultCurrency` → tenant default (`ctx.currency`).
  A measure is monetary iff it declares a currency or aggregates a `currency`-type
  field, so count/avg-of-number measures never receive a code. Wires a
  `measureCurrency` field-metadata resolver from the data engine's object schema.

- 3187952: Dataset analytics enrich **dimension** result fields with their display label (so report/dashboard table headers read "Status" instead of the raw field name) and expose drill-through metadata on the dataset query result: the base `object`, a drillable dimension→field map, and a parallel `drillRawRows` array of each row's raw grouped values (captured before label resolution). This lets a host drill a grouped bucket back to its underlying records with an exact-match filter built from the stored value, not the display label. Date dimensions are excluded (a humanized bucket can't be exact-matched).
- a581385: Propagate a dataset measure's declared currency to the analytics result field.

  Adds an optional `DatasetMeasure.currency` (ISO 4217) on the semantic layer and
  carries it onto each measure result field alongside `label`/`format`, so a
  currency-aware client (Intl symbol) can render `¥1,234` / `$616,000` from a real
  currency code instead of a plain number or a `$` baked into `format`. Additive
  and optional — existing datasets are unaffected.

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- db02bd5: Fix dashboard time-series charts / "last N months" KPIs that filter or group by a `Field.datetime` column silently returning "No rows".

  The analytics `NativeSQLStrategy` compiles dashboard relative-date tokens (`{12_months_ago}`, `{today}`, …) to ISO date strings and binds them directly into raw SQL, bypassing the driver's own filter coercion. Under better-sqlite3 a `Field.datetime` column is stored as an INTEGER epoch (ms), so `assessed_at >= '2025-06-18'` became a TEXT-vs-INTEGER affinity compare that is always false — an empty result even though the rows exist. `Field.date` columns store ISO TEXT and were unaffected.

  The strategy now coerces a temporal comparand to the column's on-disk storage form via a new optional `StrategyContext.coerceTemporalFilterValue` hook, wired to the driver's public `SqlDriver.temporalFilterValue` (the single source of truth for the storage convention). Coercion is dialect-correct: SQLite `Field.datetime` → epoch ms; `Field.date` text and native-timestamp dialects (Postgres/MySQL) are left unchanged, so Postgres is never handed an epoch integer. Applied to `gte`/`lte`/`gt`/`lt`/`equals`, `in`/`notIn`, and the `dateRange`/timeDimension `BETWEEN` path.

- fd07027: fix(analytics): make organization timezone actually drive date-dimension bucketing (ADR-0053 Phase 2, #1982)

  Date-bucketed analytics silently ignored the reference timezone end-to-end. Three independent seams were broken:

  - **service-analytics** — `NativeSQLStrategy` (priority 10) won every cube/dataset query on a SQL driver, but it groups by the raw column (no `date_trunc`) and ignores `timezone`, so a date dimension never bucketed (one row per raw timestamp) and a non-UTC zone was dropped. It now declines queries that carry a `timeDimensions[].granularity`, handing them to `ObjectQLStrategy` → `engine.aggregate` (native bucketing when UTC-safe, uniform in-memory bucketing when non-UTC).
  - **objectql** — the in-memory `count` aggregation treated the `*` count-all sentinel (the Cube `count` measure / a fieldless dataset `count`, both compiled to `sql: '*'`) as a column name, counting non-null of a non-existent property → `0` for every bucket. The driver's `COUNT(*)` masked it; the in-memory path (non-UTC date buckets, `driver-rest`/`driver-memory`) returned zeros. `*` is now counted as all rows.
  - **rest** — `resolveExecCtx` never resolved the localization timezone/locale, so `/analytics/dataset/query` always ran with `timezone: 'UTC'`. It now resolves them through the `settings` service (honouring the 4-tier cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override), mirroring the dispatcher path.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Minor Changes

- 9afeb2d: feat(settings): `localization` settings — platform default timezone, language & formats (ADR-0053 Phase 2)

  Adds a `localization` SettingsManifest, the missing keystone that makes the Phase 2 reference-timezone actually configurable end-to-end. One declaration gives the full settings stack for free: platform built-in default → `global` → `tenant` cascade, a permission-gated settings page, and i18n.

  **Keys** (organization-level; per-user overrides intentionally out of scope for v1): `timezone` (UTC), `locale` (en-US), `default_country`, `date_format`, `time_format`, `number_format`, `first_day_of_week`, `currency` (USD), `fiscal_year_start`. Benchmarked against Salesforce/Workday "Company Information + Locale".

  **Resolver 收编** — `resolveExecutionContext` now resolves `timezone` **and** `locale` from the `localization` settings via the `settings` service (canonical 4-tier cascade), falling back to a direct tenant-scoped `sys_setting` read, then `UTC` / `en-US`. This replaces the hand-rolled `sys_user_preference` + tenant-only `sys_setting` path from #1978 (which bypassed the settings abstraction and is dropped along with the per-user tier). New `ExecutionContext.locale`.

  **Consumer wiring** — analytics date bucketing now picks up the resolved org timezone: `DatasetExecutor` threads `ExecutionContext.timezone` into the query (precedence: explicit selection tz → request tz → UTC), so #1982's tz-aware buckets fire for a configured org without callers passing a zone. Formula `today()`/`datetime` were already wired (#1979/#1980).

  Email `datetime` rendering (`SendTemplateInput.timezone`, shipped in #1981) is intentionally **not** wired here: the only current `sendTemplate` callers are pre-session auth emails with no org context; business-notification callers can pass the zone when they appear.

- 601cc11: feat(analytics): timezone-aware date bucketing (ADR-0053 Phase 2)

  Analytics day/week/month/quarter/year buckets now resolve on a **reference timezone's** calendar days, so a row near a tz day-boundary lands in the bucket a user in that zone would expect — identically on SQLite and Postgres.

  Per ADR-0053 decision **D2**, bucketing is done **in-memory, uniformly** for non-UTC zones rather than emitting dialect-specific `date_trunc … AT TIME ZONE` (SQLite has no tz database and MySQL needs tz tables loaded, so splitting by dialect would shift bucket boundaries for the same data). `engine.aggregate({ timezone })` therefore forces the in-memory aggregation path when a non-UTC reference tz is set — the date-range `where` still goes to the driver, so only matching rows are fetched. **UTC / unset keeps the native driver fast path unchanged.**

  - New shared `calendarPartsInTz` / `calendarPartsInTzOrUtc` util in `@objectstack/core` (DST-safe via `Intl.DateTimeFormat`, never hand-rolled offset math; falls back to UTC for an unset/`'UTC'`/invalid zone).
  - `EngineAggregateOptions` and the analytics `executeAggregate` bridge / `ObjectQLStrategy` thread the reference timezone (sourced from the dataset selection / `ExecutionContext`) through to `applyInMemoryAggregation` → `bucketDateValue`, and the draft-preview evaluator's `bucketDate`.
  - `formatDateBucket` (dimension labels) stays UTC-only by design: it re-labels values that were _already_ bucketed upstream, so re-applying a timezone there would shift a correct bucket by a day.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Minor Changes

- b4765be: Server-side totals for matrix reports (#1753). `queryDataset` selections accept `totals: { groupings: string[][] }` — each grouping a subset of `selection.dimensions` to additionally aggregate by (`[]` = grand total); the marginal rows come back on `AnalyticsResult.totals` in request order. Each subtotal/grand total re-runs the full executor pipeline (measure-scoped filters, derived measures, compareTo) grouped only by that subset, so totals use each measure's true aggregate over the underlying rows — an `avg` total is the average of all rows, never an average of bucket averages (the ADR-0021 line that forbids client-side re-aggregation). Dimension display labels resolve on totals rows the same as the primary grid. A matrix report renderer asks for `{ groupings: [rowDims, columnDims, []] }` and renders the supplied totals row/column.

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Minor Changes

- 4a0736b: Analytics now renders date dimensions as human bucket labels instead of raw
  epoch millis, and buckets them by their declared granularity.

  - A date dimension with an explicit `dateGranularity` is now grouped by that
    bucket (the executor promotes it to a time dimension), so a "monthly" trend
    chart shows one point per month rather than one per raw timestamp.
  - Grouped date values are formatted to a sort-stable label per granularity
    (`year` → `2026`, `quarter` → `2026-Q2`, `month` → `2026-04`, `day`/`week`
    → `2026-04-15`), so charts no longer show `1777632968596`.

  Pairs with the dimension display-label resolution (select option labels / lookup
  names) shipped previously.

- 2c6864f: Analytics dimensions now render human display labels instead of raw stored
  values. A `select` dimension shows its option `label` (e.g. `Backlog` rather than
  `backlog`), and a `lookup`/`master_detail` dimension shows the related record's
  display name (e.g. an account's name rather than its FK id). `queryDataset`
  resolves these server-side, so every dashboard/report chart benefits with no
  frontend change. Date/number/string dimensions are unaffected, and unresolved
  values are left as-is.
- 0bf39f1: `queryDataset` now carries each measure's display `label` and `format` on the
  result `fields`, so presentations can show "Tasks" / "$616,000" instead of the
  raw measure name "task_count" / "616000".

  - `AnalyticsResult.fields[]` gains optional `label?` and `format?`.
  - The dataset executor enriches measure columns from the dataset's measure
    definitions (matching `<name>` and `<name>__compare`).

  The format can't be baked into the numeric row value (charts need the raw
  number), so the renderer applies it at display time.

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.2.10

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

All notable changes to this package will be documented in this file.

## [3.2.9] — 2026-03-22

### Added

- Initial implementation of `@objectstack/service-analytics`
- `AnalyticsService` orchestrator implementing `IAnalyticsService`
- Strategy pattern with priority chain:
  - **P1 — NativeSQLStrategy**: Pushes queries as native SQL to SQL-capable drivers (Postgres, MySQL, etc.)
  - **P2 — ObjectQLStrategy**: Translates analytics queries into ObjectQL `engine.aggregate()` calls
  - **P3 — InMemoryStrategy**: Delegates to any registered `IAnalyticsService` (e.g., `MemoryAnalyticsService`)
- `CubeRegistry` for auto-discovery and registration of cubes from manifest definitions and object schema inference
- `AnalyticsServicePlugin` for kernel plugin lifecycle integration
- `queryCapabilities()` driver capability probing for strategy selection
- `generateSql()` dry-run SQL generation across all strategies
- Unit tests covering all strategy branches
