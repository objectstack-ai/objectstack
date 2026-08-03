# Changelog — @objectstack/service-analytics

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
