# @objectstack/driver-memory

## 17.0.0

### Major Changes

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

- 262e40d: refactor(drivers)!: memory / mongodb 的 `aggregate` / `distinct` 也收进 `DriverQuery`，契约没覆盖的方法不再要求把对象名写两遍 (#6212 批 C)

  #6210 的 changeset 结尾专门留了一句：`aggregate` / `distinct` **不在**那次范围内，因为它们不是 `IDataDriver` 收窄的那六个方法。#6212 记下了这笔账，本次结清 memory 与 mongodb 这两个包的部分。

  这批方法的第一个实参**已经是对象名**，query 里却仍旧要求再写一遍：

  | 位置                                        | 收窄前                              | 收窄后                                 |
  | :------------------------------------------ | :---------------------------------- | :------------------------------------- |
  | `MongoDBDriver.aggregate`                   | `query: QueryAST`                   | `query: DriverQuery`                   |
  | `InMemoryDriver.distinct`                   | `query?: QueryInput`                | `query?: DriverQuery`                  |
  | `InMemoryDriver.aggregate`                  | `Record<string, any>[] \| QueryAST` | `Record<string, any>[] \| DriverQuery` |
  | `InMemoryDriver.performAggregation`（私有） | `Omit<QueryInput, 'object'>`        | `DriverQuery`                          |

  因为 `QueryAST` / `QueryInput` 都把 `object` 声明成**必填**，一个手上只有 `where` 的调用方根本叫不出这个类型的名字，于是伸手去拿 `as any` —— 连 `where` / `orderBy` / `limit` 的检查一起关掉。这正是 #5181 记过账的那笔代价（cloud#1053 实测 20 处，cloud#1030 的 `$like` 就是从这个口子活到运行时的）。收窄之后调用方可以直接写字面量：

  ```ts
  // 收窄前：object 是必填，这句编译不过，于是 ... as any
  // 收窄后：直接过，且 where / orderBy / aggregations 逐个受检
  await driver.aggregate("order", {
    groupBy: ["region"],
    aggregations: [{ function: "sum", field: "amount", alias: "total" }],
  });
  ```

  同一次改动收回了 4 处已经多余的 `as any`（memory 2、mongodb 2），`check:query-options-erasure` 的测试面因此从 267 降到 263，baseline 已按门禁要求同 PR `--update`。

  **`InMemoryDriver.aggregate` 的联合刻意保留。** 两条分支都有活体生产者：mongo 管线数组那支由 `memory-analytics.ts` 喂，AST 那支由 objectql 引擎与 `@objectstack/verify` 的日期分桶探针喂。退役任何一支都会打断其中一条。

  **顺带把 `#6212` 正文的一处归因证伪了**：正文说 `performAggregation` 当初选 `Omit<QueryInput, 'object'>` 是被 `groupBy` 的元素类型差异逼的。实测 `QueryInput` 与 `QueryAST` 在 `groupBy` 上**逐字相同**，差异只在 `search` / `orderBy` / `expand`；直接换 `DriverQuery` 零报错。所以那不是被迫的选择，契约优先取 `DriverQuery`，不再引入第二个查询类型家族。

  **零运行时改动。** 非测试改动 100% 是类型注解，无逻辑、无行为、无 emit 差异（`as` 断言在编译期即被抹除）。测试全绿：memory 532、mongodb 206（另 137 条需真实 mongod，按既有 opt-in 规则跳过）。这也是 #5499 冻结面上被允许的处置口径 —— 与 #6210 在同一批驱动上走的是同一条。

  **迁移面：删掉调用字面量里的 `object:` 键**，与 #5181 / #6210 同一句话，现在覆盖到 `aggregate` / `distinct`。编译器会逐处指出来：

  ```
  error TS2353: Object literal may only specify known properties,
                and 'object' does not exist in type 'DriverQuery'.
  ```

  本仓实测只有一处需要改（`memory-driver.test.ts` 的 `distinct` 用例），且它写的值与第一实参逐字相等，纯冗余。

  标 major 的依据与 #5181 / #6210 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

- 7309c81: fix(driver-memory,spec): persistence is opt-in again — `new InMemoryDriver()` is pure in-memory (#4065)

  `InMemoryDriverConfig.persistence` defaulted to `'auto'`, and in Node.js `'auto'`
  means **file**. So a bare `new InMemoryDriver()` — the shape every caller in this
  repo used — silently wrote `.objectstack/data/memory-driver.json` into the process
  CWD and reloaded it on the next boot. The default is now `false`.

  **This restores the accepted design rather than replacing it.** #815, the issue
  that introduced the persistence capability, specified it as opt-in in requirement
  \#1 — "默认情况下不启用持久化（纯内存，行为不变）" — and listed
  `new InMemoryDriver()` under "纯内存" in its own config examples. The `'auto'`
  default was a drift from that spec.

  What let the drift survive is worth naming, because it is not "there was no
  test". `MemoryConfigSchema` _did_ pin the default, and asserted `'auto'`; the
  driver honoured `'auto'`; so spec and implementation agreed, and the pair looked
  verified. What nothing checked was whether the value they agreed on was the one
  #815 accepted. The driver's own `persistence.test.ts` could not have caught it
  either — every case there passes `persistence` explicitly, so the omitted-value
  path was untested on the implementation side. Both sides are now covered: three
  behavioural tests in `persistence.test.ts` (no CWD write, no cross-instance row
  carry-over, opt-in still persists) and the flipped schema assertion.

  **The symptom this fixes.** `packages/runtime/src/datasource-autoconnect.test.ts`
  seeds two rows with fixed ids and asserts the exact set. Run 1 passed and wrote
  the rows to disk; run 2 loaded them back, appended two more, and failed with four
  rows; run N had 2N. CI never saw it — every job is a fresh clone, so every CI run
  is run 1 — but `pnpm test` twice in one working tree could only ever go green
  once. The persisted file's `created_at` values, one pair per run, were the proof.

  (#4083 fixed that particular suite from the factory side, and its regression
  test is kept as-is. The blast radius was wider than one suite, though: **every**
  bare `new InMemoryDriver()` inherited the default, so any code path constructing
  one directly wrote to its working directory. Unit tests should not have write
  side effects on the CWD at all.)

  **Migrating.** Callers that want durability now ask for it:

  ```ts
  new InMemoryDriver(); // pure in-memory (new default)
  new InMemoryDriver({ persistence: "file" }); // Node.js, durable across restarts
  new InMemoryDriver({ persistence: "local" }); // browser, durable across reloads
  new InMemoryDriver({ persistence: "auto" }); // previous default behaviour
  ```

  The `'auto'` / `'file'` / `'local'` / custom-adapter paths are unchanged; only
  the value used when `persistence` is omitted moved.

  **Relationship to #4083.** That issue fixed the same hazard one consumer at a
  time, and landed first: `createDefaultDatasourceDriverFactory` now passes
  `persistence: false` for a declared `{ driver: 'memory' }` datasource and scopes
  an opted-in destination _per datasource_, and the dev sqlite step-down's
  last-resort rung passes `false` too. Both are kept exactly as #4083 wrote them.
  This change closes the half they deliberately left open — a directly-constructed
  `new InMemoryDriver()` — which is the path that still wrote into the working
  directory of whatever process happened to build one.

  The two are complementary, not redundant. #4083's per-datasource scoping is
  still the only thing that expands `'auto'`/`'file'`/`'local'` into a destination
  carrying the datasource name, so two pools that DO opt in never alias one file;
  its explicit `false` becomes belt-and-braces, which is the right posture for a
  path that must never persist.

  `DevPlugin`'s driver is now explicitly `persistence: false`, matching the cache,
  queue, job, i18n, storage and search stubs it ships beside — it was the one piece
  of that stack that quietly outlived the process.

  **One claim trimmed, no behaviour attached.** The class docstring called this a
  "production-ready implementation of the ObjectStack Driver Protocol". It stores
  no constraints at all — `create()` is a `table.push()` and `syncSchema()` only
  allocates an array — so there is no primary key, uniqueness, `NOT NULL`, foreign
  key or column typing, and `bulkCreate` lands duplicate ids where a SQL driver
  raises a violation (the second finding in #4065). The docstring now says so, and
  points test authors at in-memory SQLite. Per Prime Directive #10 the fix for
  `declared ≠ enforced` is to implement it, trim the claim, or file it; with this
  driver moving to maintenance-only the claim is what goes.

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- f7df82c: fix(driver-memory): the analytics (cube) face stops round-tripping filter comparands through `string[]`, which was losing booleans, `null` and numeric-looking strings (#5373)

  **This is an observable behaviour change on a shipped surface: widgets whose
  `where` carries a boolean, a `null`, or a numeric-looking string comparand will
  show different — correct — numbers.** Some of them go from zero rows to a real
  answer; others go from the whole table down to the rows actually asked for.

  ## What was happening

  `MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a cube-style
  `{member, operator, values}` list whose `values` was typed `string[]`, because
  the cube WIRE format serialises filter values as strings. So every comparand
  made a JS value → string → JS value round trip on its way to the pipeline, and
  that round trip is lossy for anything that is not already a string:

  | `where`                       | stringified | recovered as         | compared against      | rows                |
  | ----------------------------- | ----------- | -------------------- | --------------------- | ------------------- |
  | `{is_active: true}`           | `'1'`       | the number `1`       | stored `true`         | **0**               |
  | `{is_active: false}`          | `'0'`       | the number `0`       | stored `false`        | **0**               |
  | `{closed_at: null}`           | —           | _(dropped entirely)_ | —                     | **the whole table** |
  | `{closed_at: {$ne: null}}`    | `''`        | `''`                 | stored `null`         | **the whole table** |
  | `{code: '100'}` (TEXT column) | `'100'`     | the number `100`     | stored `'100'`        | **0**               |
  | `{is_active: {$ne: true}}`    | `'1'`       | the number `1`       | stored `true`/`false` | **the whole table** |

  mingo compares across JS types the way MongoDB compares across BSON types —
  never equal — so none of these is an error. Each is a wrong row set, silently.

  The two directions fail differently, and the widening one is worse. A boolean
  filter that returns nothing renders an empty chart, which someone notices. A
  `null` filter that returns everything renders a _normal-looking_ chart: a
  "closed_at is empty" widget quietly counted the closed records too. That is the
  direction #3948 outlawed, and on an RLS read scope it is an unauthorized read
  rather than a wrong number.

  `{is_active: true, stage: {$nin: ['lost']}}` is `AnalyticsQuerySchema.where`'s
  own docstring example. It returned zero rows on this face.

  ## Why the encoding could not simply be fixed

  `stringifyForCube` encoded booleans as `'1'`/`'0'` "so that downstream consumers
  expecting SQLite-style numeric booleans match correctly". That justification is
  sound for the SQL-generating exit and false for the in-memory one — and both
  exits shared the single encoding. There is no string spelling of `true` that is
  right for `WHERE is_active = ?` and for a mingo `$eq` against a stored boolean at
  the same time, so making the round trip lossless would have meant tagging values
  in a format the two exits then have to agree to decode.

  So the round trip is **gone** instead. `values` is `unknown[]`; the comparand
  stays whatever the author wrote, and each exit converts at its own boundary
  where it knows what it needs. This is affordable because the triple is a purely
  internal intermediate: `AnalyticsQuery.where` is a `FilterCondition` and nothing
  else (#5375 removed the leg that also accepted a cube-style array as input), and
  the API layer actively rejects a `{member, operator, values}` array on the wire.
  No caller, no spec schema and no serialized form observes its shape — this
  change touches zero spec bytes.

  ## What changes for you

  Filters are evaluated against the values you wrote:

  - `{is_active: true}` selects the true rows instead of none.
  - `{closed_at: null}` selects the null rows instead of every row, and
    `{closed_at: {$ne: null}}` selects the complement instead of every row.
  - `{code: '100'}` on a TEXT column matches the string `'100'` instead of nothing.
  - `{qty: 100}` on a numeric column is unchanged — it was already right.

  `generateSql()` is corrected on the same cases, because a fix that satisfied
  mingo while emitting SQL meaning something else would only have moved the bug:

  - a numeric-looking string is now quoted (`code = '100'`, previously `code = 100`)
    while a real number still is not (`qty = 100`);
  - a null comparand becomes a nullness test (`closed_at IS NULL` /
    `closed_at IS NOT NULL`) rather than the `= NULL` that is never true in SQL,
    or — as before this fix — no clause at all;
  - booleans keep the SQLite-style `1`/`0` spelling, which was always right for
    this half.

  Temporal comparands still convert, and now do so through the driver's own
  storage-form rule (`filterComparandStorageForm`, keyed on the declared field
  kind, #4047) rather than an ad-hoc `toISOString()`. A `Date` against a declared
  `datetime` column therefore keeps meeting the canonical UTC ISO text the driver
  wrote — a second derivation of that rule inside the analytics face is exactly
  the in-package divergence #5240 ruled against.

  Nothing else moves: operator vocabulary, the #5345 refusals, `$and` folding,
  nested-relation flattening, time dimensions and the empty filter are unchanged.

  ## Coverage

  The cases live in the shared conformance file beside the #5324/#5345 shape
  table, not in a suite of their own. `FILTER_LOGIC_CASES` varies the filter's
  SHAPE over an all-string fixture — deliberately, so nothing in it is about
  coercion — which is why every one of its cases stayed green through this defect.
  The new block varies the comparand's TYPE over the fixture measured in the
  issue, and holds the same invariant: the analytics face must return the same ids
  as `find()`, or refuse. Reverting only the source change fails 11 of the new
  assertions, across both exits.

- d085670: fix(driver-memory): the analytics (cube) face REFUSES a filter it cannot compile instead of silently dropping it (#5345)

  **This is an observable behaviour change on a shipped surface, and it will turn
  some working-looking dashboards red.** That is the point: the widgets it breaks
  were returning inflated aggregates, and some of them were returning rows the
  caller had no permission to read.

  ## What was happening

  `MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a flat, cube-style
  `{member, operator, values}` list. Anything that did not fit was answered with
  `continue` — in two places, and with a comment presenting it as a feature
  ("ignore so a partial query still runs rather than failing entirely"):

  | dropped                     | why it did not fit                                   |
  | --------------------------- | ---------------------------------------------------- |
  | `$or` (whole branch)        | no expression in a flat AND-list                     |
  | `$not` (whole branch)       | same                                                 |
  | `$between`                  | no row in the mongo→cube operator table              |
  | `$startsWith` / `$endsWith` | same                                                 |
  | `$null`                     | same                                                 |
  | `$regex`                    | same — and `plugin-auth`'s ObjectQL adapter emits it |

  Dropping a predicate does not narrow a query, it **widens** it: fewer
  constraints means more rows. A widget filtered to two stages with
  `{$or: [{stage: 'won'}, {stage: 'lost'}]}` aggregated the **entire table** and
  rendered as a perfectly normal chart. Measured on the shared
  `FILTER_LOGIC_CASES` fixture, **15 of its 17 cases** returned a wider row set
  than the standard specifies — usually every row. Of the two that did agree, one
  (`a $or nested under a top-level $and`) agreed by _coincidence_: its dropped
  `$or` happened to be redundant against a surviving sibling key, which is the
  best illustration available of why "the number looked right" was never evidence.

  `$not` makes it more than a wrong number. `cel-to-filter.ts` compiles a CEL
  `!expr` RLS read scope into `{$not: {…}}`, so the dropped branch was the read
  scope itself — the aggregate included records the caller is not allowed to see.

  ## What changes for you

  A `where` carrying any of the shapes above now raises **`INVALID_FILTER` / 400**
  (the ADR-0112 envelope every sibling filter refusal in this driver already
  speaks, reaching REST callers as a 400 since #5366) naming the offending
  operator or combinator and its position, e.g.:

  > Filter operator `"$between"` on field `"amount"` at `where.amount` is declared
  > by the Filter Protocol but cannot be compiled by driver-memory's analytics
  > (cube) face. Supported operators on this surface: `$eq, $ne, $gt, $gte, $lt,
$lte, $in, $nin, $contains, $notContains, $exists`.

  Both entry points refuse identically — `query()` and `generateSql()`.

  **The fix, per shape:**

  - `$between` on a range → the two bounds, which this face has always compiled:
    `{ closed_at: { $gte: '2026-01-01', $lte: '2026-01-31' } }`, or a
    `timeDimensions[].dateRange`, which is unaffected.
  - `$startsWith` / `$endsWith` / `$regex` → `$contains`, or move the query to
    `find()`.
  - `$null` → `{ field: { $exists: false } }` for the absent case.
  - `$or` / `$not` → restate as the implicit AND of field keys where the intent
    allows it; where it does not, the cube pipeline genuinely cannot express it,
    and the query belongs on `find()`.

  Nothing that was **compiled** changes. All eleven supported operators, `$and`,
  implicit equality, nested-relation flattening, time dimensions and the empty
  filter produce byte-identical pipelines.

  ## Why refuse rather than teach the cube pipeline `$or`

  This is the call ADR-0078 / #4286 made for `objectql`'s `having` — an ignored
  operator there "silently returns UNFILTERED aggregates", so it throws — and the
  posture #3948 established for every filter backend: a filter that cannot be
  compiled is refused loudly, never skipped. It is also where the two neighbouring
  faces landed (#5366, #5368).

  Mechanically, the refusal is not a new check bolted onto this face. It reuses
  the package's single filter gate, `assertFilterConditionShape`, which now takes
  the calling face's declared capabilities; and the analytics face derives those
  capabilities from its own mongo→cube operator table, so widening what it accepts
  and teaching it to compile the operator are now the same edit. The shared
  `FILTER_LOGIC_CASES` conformance table covers this third face for the first time
  (it watched only two of the driver's three), holding it to: agree with
  `find()`, or refuse — never a third, quieter answer.

- 01c0bae: fix(driver-memory): the analytics (cube) face compiles `$notContains` to a predicate that actually excludes rows, instead of a bare mingo `{$not: 'x'}` that constrains nothing (#5374)

  **This is an observable behaviour change on a shipped surface: widgets whose
  `where` carries `$notContains`, `$contains`, or an empty `$in` will show
  different — correct — numbers.** Every one of them moves in the same direction,
  from a wider row set to the rows actually asked for, because each of these
  defects made a predicate mean less than it says.

  ## What was happening

  `MemoryAnalyticsService` mapped each cube operator to the NAME of a mingo
  operator, and the call site filled that name in as
  `matchStage[field] = {[name]: comparand}`. That shape can express "compare this
  field to this value" and nothing else, so the two operators that need to WRAP
  their comparand were pushed through it anyway:

  | `where`                        | compiled `$match`           | analytics | `find()` |
  | ------------------------------ | --------------------------- | --------- | -------- |
  | `{name: {$notContains: 'et'}}` | `{name: {$not: 'et'}}`      | **3**     | 2        |
  | `{name: {$notContains: 'a'}}`  | `{name: {$not: 'a'}}`       | **3**     | 0        |
  | `{name: {$contains: 'a.p'}}`   | `{name: {$regex: 'a.p'}}`   | **1**     | 0        |
  | `{name: {$contains: 'ALPHA'}}` | `{name: {$regex: 'ALPHA'}}` | **0**     | 1        |
  | `{code: {$in: []}}`            | _(no predicate emitted)_    | **3**     | 0        |

  - **`notContains` → `'$not'`.** mingo's `$not` takes a regex or an operator
    expression; handed a bare scalar it constrains nothing. The predicate was
    emitted, appeared in the pipeline, and passed the whole table. A predicate
    that is emitted and inert is indistinguishable from a working one at the
    author's end — the same amplifying direction as #3948, reached a third way.
  - **`contains` → `'$regex'`** was the right operator with the comparand handed
    in raw, so it was neither escaped (a `.` matched any character) nor
    case-folded, while the live query path escapes and matches `/…/i`. One
    `where`, two meanings, depending on which face read it (#5240).
  - **an empty `$in`** hit the call site's `values.length > 0` guard and emitted
    no predicate at all, so the query widened to the whole table where `find()`
    returned nothing.
  - **an operand that is not a comparand** — a `$contains` pattern, a `$exists`
    flag — went through the field's storage-form conversion anyway, so on a
    declared `datetime` column the PATTERN itself was rewritten into canonical
    form and then matched rows `find()` does not match (#4047).

  ## What changed

  The operator table now holds a **predicate builder** per operator rather than an
  operator name, so `notContains` can say `{$not: {$regex: …}}` and the class of
  "this operator needs a structure and the table can only hold a name" is gone
  rather than this one instance of it. `$in` / `$nin` / `$lte` / `$exists`, which
  the call site had grown an `if` chain for, are ordinary rows in that table now.

  The substring rule itself is **borrowed from the driver** (new narrow
  `InMemoryDriver.filterSubstringPattern`, alongside `filterComparandStorageForm`)
  instead of re-derived, so `contains` on the analytics face escapes and case-folds
  exactly as `find()` does and the two cannot drift apart again.

  The `opMap[operator] || '$eq'` fallback — under which a misspelled or unmapped
  operator silently became an EQUALITY comparison — is gone. It was already
  unreachable after #5345 gated the vocabulary upstream, but only until someone
  widened that vocabulary, which #5345 deliberately made a one-line edit. The
  predicate table is keyed by the operator union derived from that same table, so
  the widening edit now **fails to compile** until the predicate exists.

  Two dead entries were deleted with it: `'notSet': '$exists'` (unreachable, and
  inverted if it ever had been reached) and `'inDateRange': '$gte'` (unreachable,
  and a one-ended `>=` answer to a two-ended range — its own comment conceded
  "Will need special handling" and nothing implemented it).

  ## Not changed

  The `generateSql()` exit is untouched. Its operator-layer defects are #5433,
  filed and deliberately not bundled.

- 0f17114: fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

  `{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
  而同一个 filter 在同仓四条路径上有三个答案:

  | 路径                                | 改前                                                                                            | 改后                          |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
  | `driver-sql`,顶层 plain map         | 抛 `INVALID_FILTER`(#5041 的比较数闸门)                                                         | 抛 `INVALID_FILTER`(专用消息) |
  | `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)**                                            | 抛 `INVALID_FILTER`           |
  | `driver-memory`                     | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER`           |
  | `@objectstack/formula`              | `keys.length === 0` 显式 fail-closed → FALSE                                                    | 抛 `INVALID_FILTER`           |

  于是 `{ $or: [ { a: {} }, { b: 2 } ] }` 在 SQL 上编译成 `(b = 2)` —— 既不是「零约束即 TRUE」
  该给的全表,也不是两个 JS 后端给的 FALSE,而是**子句被 knex 连同空分组一起丢掉**的结果;
  而 `driver-sql` 自己内部就不自洽:同一个 `{ a: {} }` 写在顶层被响亮拒收,包进一层 `$or`
  就变成静默的 TRUE。

  维护者拍板取**拒收**(不取 TRUE、不取 FALSE):这个形状几乎必然是编写期事故 ——
  筛选器记下了字段却没记下操作符,或生成的元数据把操作符弄丢了 —— 让它在编写期就炸,
  好过在某个后端上安静地多返回或少返回几行。与 #5041 已在 driver-sql 顶层建立的先例一致,
  本次只是把同一道闸门补进组合子内部。四个后端(第四个是继承 `SqlDriver` 的
  `driver-sqlite-wasm`)现在给出同一个 `INVALID_FILTER` / 400,消息里指名出事的位置
  (如 `filter.$or[0].stage`)。

  **⚠️ 可观察的行为变更 —— RLS `check` 求值路径。** `@objectstack/formula` 的
  `matchesFilterCondition` 是 `plugin-security` 对 insert/update **后像**执行行级 `check`
  的那条路径(没有查询可下推,这个求值器就是执行本身)。它改为抛出后,落在 #4775
  「求不出值 = 该次操作失败」的既定姿态上。这不只是「拒绝得更响」——有一类结果直接翻转:

  | `check` 策略                                    | 改前                                  | 改后                     |
  | ----------------------------------------------- | ------------------------------------- | ------------------------ |
  | `{ a: {} }`                                     | FALSE → 写入被拒(403)                 | 抛出 → 该次写入失败(400) |
  | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败      |
  | `{ $not: { a: {} } }`                           | `!false` → 写入**放行**               | 抛出 → 该次写入失败      |

  后两行是**原本能成功、现在会失败**的写入。这是拍板的目的而非副作用:一条含
  `{ field: {} }` 的权限规则,是一条作者弄丢了操作符的规则,它的含义不该取决于四个后端里
  哪一个在求值。升级后请检查 `check`/`using` 策略里是否存在零操作符的字段约束——
  错误消息会指名位置。

  同一条改动也让 `@objectstack/driver-memory` 的两个过滤面(经 mingo 的实时查询路径,
  与跨后端一致性套件所用的 `memory-matcher` 参考匹配器)第一次对这个形状给出同一个答案。

  非空形状**逐字符不变**:普通比较、`$in`、`$or`/`$and` 组合、`$not` 的 #5146 NULL-safe 改写,
  编译出的 SQL 文本与匹配结果都与改前相同;`{}`(零个键的**节点**,#5134 的布尔单位元)
  与 `{ field: {} }` 是两个不同形状,前者的语义不受本次影响。

  注:本次收紧的是**实现**。`packages/spec` 的 `FilterConditionSchema` 仍然声明这个形状合法
  (非递归半边是 `z.record(z.string(), z.unknown())`),即实现现在比已声明的契约更严;
  契约收窄与 `FILTER_LOGIC_CASES` 补条归 spec 车道另行处理。

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

- 6f98c2d: fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

  A filter the driver could not compile was **skipped**, not rejected. No predicate
  was emitted and the query returned every row — the caller asked to filter and
  silently received the unfiltered set.

  The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
  arrives at a driver only when `isFilterAST()` refused it — its operator is outside
  `VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
  was assigned to `where`. `driver-sql`'s loop then saw three _strings_, matched
  neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
  it cast every string to a logic keyword, opening three empty groups and returning
  `{}` — a filter matching every record.

  This is reachable from ordinary authoring, not just malformed input: `before` and
  `after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
  does not accept. Eight of the nineteen canonical view operators are in that
  position, including `equals`; the others were masked only because ObjectUI's
  adapter alias table happened to cover them.

  **Behaviour change.** Both drivers now throw on a filter element that is neither a
  logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
  an operator it cannot express rather than dropping the condition. The nested and
  `$`-object paths already threw on the same input, so this makes the three paths
  agree. A caller that was relying on the old silence was receiving wrong results;
  the error names the operator and the offending filter.

  **`driver-memory` also gains seven operators it silently ignored:** `not_in`,
  `is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
  members of `VALID_AST_OPERATORS`, all previously falling through to
  `default: return null`. `is_null` narrowed nothing instead of matching null rows.
  Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
  the two backends accept one vocabulary.

  Migration: none for well-formed filters. If a query now throws, the filter was
  never being applied — fix the operator (the message names it), or lower it to an
  AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.

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

- d063a96: fix(spec,drivers,formula,client): `like`/`ilike` stop being folded onto `$contains` at the wire (#7536)

  A `like` predicate that arrived over HTTP was rewritten into a substring search
  before any driver saw it, because `AST_OPERATOR_MAP` (`data/filter.zod.ts`)
  carried `'like': '$contains'`. `$contains` LIKE-escapes its comparand and wraps
  it in `%…%`, which breaks a `like` in **both** directions at once. Measured in
  QA run #7463 against showcase on SQLite:

  | filter                          | before                                                                              | now                               |
  | ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- |
  | `["name","like","%Industries"]` | `200`, **0 rows** — the `%` bound as a literal percent sign                         | the rows ENDING WITH `Industries` |
  | `["name","like","Industries"]`  | a substring match, **byte-identical to the `$contains` control**                    | an EXACT match                    |
  | `["name","ilike","…"]`          | `400` — `ilike` had no lowering at all, so `isFilterAST()` refused the whole filter | the case-insensitive twin         |

  The second row is the tell: `like` and `$contains` producing the same bytes
  means `like` was not reaching the driver as a pattern at all.

  The file already documented the contract being violated. `canonicalAstOperator`,
  thirty lines below the map entry, carried a hand-written exemption for
  `like`/`ilike` whose comment read: _"they are NOT substring matches at the
  driver: driver-sql passes them to SQL verbatim, so the caller binds the
  wildcards. Folding them onto `contains` would silently wrap the value in `%…%`
  and change what the query means."_ That exemption only ever shaped its own
  output; the lowering the wire path takes had none. A consequence worth naming:
  driver-sql's `like`/`ilike` handling has been unreachable from the wire since
  #5158.

  ## What changed

  **New operators `$like` / `$ilike`** on `StringOperatorSchema` and
  `FieldOperatorsSchema`. The comparand IS the pattern: `%` matches any sequence,
  `_` matches exactly one character, a backslash escapes either, and the pattern
  must cover the WHOLE value — so a pattern with no wildcards is an exact
  comparison, not a substring search. `$like` is case-SENSITIVE (the #4706 Q2 = A
  contract its `$contains` sibling answers); `$ilike` folds ASCII case and nothing
  else (Q1 = A), so `café` does not match `CAFÉ`.

  `AST_OPERATOR_MAP` now lowers `like` → `$like` and `ilike` → `$ilike`. `ilike`
  enters the AST vocabulary for the first time — it previously had no entry, so
  `isFilterAST()` refused it. `canonicalAstOperator`'s hand-written exemption is
  retired: the generic round-trip answers `like`/`ilike` by construction now, so
  the special case is gone along with the reason it existed.

  The pattern language is defined **once**, in the spec, and shared by every face
  that needs it — `hasDanglingLikeEscape`, `likePatternToRegexSource`,
  `matchesLikePattern` and `likePatternToGlobPattern`. Six faces implementing one
  pattern language separately is the `#3948` shape reached through translation
  instead of vocabulary.

  **Which backends answer, and which refuse.** `$like`/`$ilike` are deliberately
  NOT in `FILTER_OPERATORS`, the runtime allowlist several packages derive
  acceptance from — adding a name there before every face has an arm turns a loud
  refusal into a silently DROPPED predicate, which is the widening measured in
  #5701 and ruled on in #3948.

  | face                                                                 | `$like` / `$ilike`                                                                                  |
  | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
  | `driver-sql` (and `driver-sqlite-wasm`, which inherits its compiler) | **answers** — `LIKE` on Postgres/MySQL, `GLOB` on SQLite                                            |
  | `driver-turso`, both transports                                      | **answers** — the remote transport compiles independently, holds to the local one by a parity suite |
  | `driver-memory`, both faces                                          | **answers** — the in-memory double must not 400 for a filter that works in production               |
  | `@objectstack/formula` (`matchesFilterCondition`)                    | **answers** — so a write-side RLS `check` agrees with the read-side SQL                             |
  | `driver-mongodb`, objectql `having`, `service-analytics`             | **refuse**, loudly, in the ADR-0112 `INVALID_FILTER` envelope                                       |

  The refusals are the point rather than a gap: #7536 exists because a `like` was
  silently given `$contains`' meaning, and a face that quietly answers a different
  question is worse than one that refuses. Clearing the remainder means arms on
  those faces in one PR — the #6520 direction.

  **Why SQLite gets `GLOB`.** `$like` is case-exact and SQLite's `LIKE` folds
  ASCII unconditionally, which cannot be switched off per statement
  (`PRAGMA case_sensitive_like` is connection-global). That is #6518's finding,
  and the operator it landed on. Because GLOB speaks a different pattern language
  (`*`/`?`, and `%`/`_` are ordinary characters), the pattern is TRANSLATED rather
  than escaped — including GLOB's own metacharacters, which are ordinary to LIKE:
  an unescaped `*` in a GLOB pattern is the same filter bypass an unescaped `%` is
  under LIKE (#5567).

  **Refused rather than given a meaning:** a pattern ending in a lone unpaired
  backslash. No reading survives every backend — Postgres rejects such a pattern
  outright, GLOB has no escape character at all — so it is refused at the door on
  every face, by one shared test.

  ## ⚠️ Behaviour changes

  1. **`like` now means `LIKE`.** If you were relying on `like` behaving as a
     substring search — the defect — write `contains` instead. A wildcard-free
     `like` is now an exact match.
  2. **`like`/`ilike` on `driver-mongodb`, objectql `having` and analytics now
     return `400 INVALID_FILTER`** where a (wrong) substring answer came back
     before. Write `$contains`/`$icontains` on those backends. `driver-memory` is
     deliberately NOT in that list — it implements the operators, because an
     application whose tests run on the in-memory double and whose production runs
     SQL must not meet a 400 in test for a filter that works in production.
  3. **`@objectstack/client`'s `.contains()`, `.startsWith()` and `.endsWith()`
     emit different operators.** They used to build a `like` tuple by gluing
     wildcards onto the caller's value (`[field, 'like', '%' + value + '%']`),
     which was wrong twice over: the wire folded `like` onto `$contains`, which
     escaped the glued `%` back into a literal, so `.contains('name','Corp')`
     searched for the text `%Corp%` and matched only rows containing percent
     signs. And once `like` reaches the driver as a real pattern, the glue becomes
     the _other_ bug — a `%` or `_` inside the caller's own value would silently
     become a wildcard. They now emit `contains` / `starts_with` / `ends_with`,
     whose comparand is text. `.like()` is unchanged and finally works; `.ilike()`
     is new.

     Note the case semantics this corrects on paper too: `.contains()`'s docblock
     claimed "case-insensitive", but the `$contains` family is case-SENSITIVE by
     contract (#4706 Q2 = A). Use `.ilike()` for a case-insensitive pattern.

- 45d5bd2: feat(driver-memory)!: declare the driver single-tenant and refuse to boot multi-tenant (#6915)

  `InMemoryDriver` implements **no row-level tenant isolation** — it never reads
  `DriverOptions.tenantId`, so reads carry no tenant predicate and writes are not
  stamped with a tenant column. The layer the SQL family has (`resolveTenantField`

  - `applyTenantScope`) does not exist here at all, which is why
    `scripts/check-tenant-chokepoint.mjs` scans `driver-sql` / `driver-sqlite-wasm` /
    `driver-turso` and not this package — and `distinct(object, field, query?)` does
    not even accept a `DriverOptions`, so a caller has nowhere to pass a tenant even
    deliberately.

  Everything above the driver assumes tenant isolation is a _platform_ guarantee
  (object metadata's `tenancy` block, `applySystemFields` injecting
  `organization_id`, the engine threading `tenantId` into every driver call). So a
  multi-tenant deployment backed by this driver did not fail — it served
  cross-tenant reads, updates and deletes **silently**, the "declared ≠ enforced"
  shape Prime Directive #10 forbids.

  It now refuses to run there, at startup, on two signals:

  - **Deployment posture** — `assertSingleTenantPosture()` reads the shared
    `resolveTenancyPosture()` resolver (ADR-0105 D1), the canonical knob which also
    subsumes the legacy `OS_MULTI_ORG_ENABLED` boolean, so the driver, auth, the
    registry and the CLI can never disagree about the mode. Both walled postures
    (`group` and `isolated`) need an organization wall this driver cannot draw, so
    both are refused; only `single` passes. Called from the **constructor** and
    re-checked in `connect()`. Both seams are load-bearing: `connect()` is what
    `ObjectQLEngine.init()` turns into a boot-aborting `DriverConnectError`
    (framework#3741), while the constructor is the seam no escape hatch reaches —
    `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` downgrades a connect rejection to a warning
    and would boot the deployment unisolated again.
  - **Object metadata** — `assertObjectsNotTenantScoped()` refuses to sync an
    object declaring `tenancy.enabled: true`, naming every offender in one message
    so an operator fixes the whole set in one pass. Called from `syncSchema()`,
    before the table is allocated.

  Both throw `MemoryMultiTenantUnsupportedError` with
  `code === 'MEMORY_MULTI_TENANT_UNSUPPORTED'`, a message that names the detected
  signal, the knobs that produced it, and `@objectstack/driver-sql` (including
  `connection: { filename: ':memory:' }` as the closest in-process drop-in) as the
  multi-tenant option.

  There is deliberately **no override env var**: an escape hatch would restore
  exactly the silent non-isolation this guard removes. Single-tenant deployments —
  the dev stack, the example apps, `@objectstack/verify`, and every in-process
  embedding, none of which set a tenancy posture — are unaffected.

  This is option B of #6915, mirroring the guard #3724 landed on
  `@objectstack/driver-mongodb`. Implementing real row-level isolation (option A)
  stays behind the #5499 investment freeze; a startup refusal is not an investment
  in this driver's capabilities, it is the removal of a silent failure mode
  (maintainer ruling, 2026-08-12).

  Graded `minor` rather than `patch` for the same reason the sibling guard was: a
  deployment that boots today can stop booting. It is a refusal that was always
  owed, but it is still a behavior change, and the release notes must be able to
  say so.

  <!-- adr-0087: not-required (no-migration-prescription) This change retires NO authorable surface. It removes no spec property, no metadata key, no `apiMethods` entry and no field type; `packages/spec` is untouched by this diff, which is confined to `packages/drivers/driver-memory` (a new guard module, one dependency, three call sites) plus the lockfile line that dependency implies. Every object schema that parses today still parses. In particular `tenancy.enabled: true` remains valid, honoured, authorable metadata everywhere it was before — `driver-sql` / `driver-sqlite-wasm` / `driver-turso` enforce it through `applyTenantScope()`, and `scripts/check-tenant-chokepoint.mjs` re-derives that from the AST on every run. So there is nothing for `objectstack migrate meta` to rewrite, and rewriting would be actively WRONG: stripping the `tenancy` block on upgrade would silently disarm a real isolation declaration on the deployments that actually enforce it. Nor is there a FROM/TO rule a ledger entry could state. What this guard refuses is a DEPLOYMENT pairing — this driver together with a walled `OS_TENANCY_POSTURE` — and the correct repair depends on which half is the mistake: a genuinely multi-tenant deployment moves to `@objectstack/driver-sql` (`connection: { filename: ':memory:' }` is the in-process drop-in), while a deployment that never meant to be multi-tenant sets `OS_TENANCY_POSTURE=single`. That is an operator decision about the deployment, not a mechanical transform of any authored metadata, and the ledger has no way to express "pick one of two, based on a fact only you hold". The channel that does reach an affected reader is the refusal itself, which names the detected posture, both env knobs that can produce it, and the driver-sql alternative — shipped with this change and printed at the moment of failure — plus this changeset's own CHANGELOG text. Checked for precedent rather than assumed: #3724 landed the identical guard on `@objectstack/driver-mongodb` and registered nothing (its `17.0.0-rc.0` entry carries no marker — it predates this gate), and neither ADR-0087 registry holds any entry for a driver-level tenancy refusal, so there is no convention here to match or to break. -->

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

  <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

### Patch Changes

- b313fde: fix(driver-memory): the analytics pipeline dump shows its RegExp pattern instead of `{}` (#7853)

  `MemoryAnalyticsService.query()` returns `AnalyticsResult.sql` — a stage-by-stage
  dump of the mingo pipeline it actually executed, and the only thing an author
  debugging an in-memory chart is given. It dumped each stage with a bare
  `JSON.stringify`, and a `RegExp` has **no own enumerable properties**, so every
  pattern operand rendered as `{}`:

  ```
  -- MongoDB Aggregation Pipeline on table: deal
  /* Stage 1: $match */ {"name":{"$regex":{}}}
  ```

  The `$match` stage was reported as constraining `name` by an empty object. The
  one field the reader came for is the one the dump dropped. Measured across the
  twelve operators this face declares, exactly three carry a pattern and all three
  were affected: `$contains`, `$icontains`, and `$notContains` (nested inside
  `$not`). The same three now render:

  ```
  /* Stage 1: $match */ {"name":{"$regex":"/et/"}}
  /* Stage 1: $match */ {"name":{"$regex":"/[Bb][Ee][Tt]/"}}
  /* Stage 1: $match */ {"name":{"$not":{"$regex":"/et/"}}}
  ```

  **No executed behaviour changes.** This dump is explicitly not SQL — its own
  header says `-- MongoDB Aggregation Pipeline on table: …` — so it is a
  transparency surface, not a runnable one, and the rows `query()` returns and the
  SQL `generateSql()` emits are byte-identical before and after. The other nine
  operators' dumps are unchanged.

  **Why the pattern's own literal syntax** (`/source/flags`) and not the
  mongo-shaped `{"$regex":"…","$options":"…"}` the rest of the dump speaks: the
  `RegExp` sits AT the `$regex` key, so a value replacer producing the mongo pair
  renders the doubled `{"$regex":{"$regex":"et","$options":""}}` — a shape no mongo
  query has. Flattening it to the real spelling would mean rewriting the parent
  object, making the dump disagree with the pipeline it claims to dump, since what
  mingo executes at that key is a JS `RegExp`. The literal form is also the only
  one-token rendering that keeps the FLAGS, which matter here: `$icontains`' fold
  lives in the pattern source (#6520) while `$contains` is case-exact (#7723).

- b3a2318: fix(driver-memory,driver-mongodb): a bare-day upper bound covers the whole day (#4042)

  The non-SQL half of #3777's calendar-day rule. Both drivers compiled a bare
  `YYYY-MM-DD` `$lte` (and a `between` max) as-is, so on timestamp values the
  window cut off at the final day's midnight — the dashboard date-range filter's
  default configuration (`created_at`, 7 of 13 presets ending "today") lost the
  current day, exactly as it did on SQL before #3777 was fixed.

  Both drivers now compile a bare-day upper bound half-open, sharing
  `nextUtcCalendarDay` from `@objectstack/core`:

  - `driver-memory`: the Mongo-style and array `where` spellings in the mingo
    lowering (`$lte`/`<=` → `$lt` next day; `$between`/`between` max the same),
    the analytics cube-filter `lte`, and the analytics `dateRange` window — which
    now also matches BOTH stored forms of a timestamp (ISO strings and `Date`
    objects) instead of only `Date`s, since mingo compares cross-type as
    never-equal.
  - `driver-mongodb`: the `translateFilter` lowering, all three spellings
    (`$lte`, `$between`, array `<=`/`lte`).

  Unchanged on purpose, matching the #3777 semantics table: full-ISO/`Date`
  comparands keep instant semantics, and `$gte`/`$gt`/`$lt` keep their midnight
  anchoring. Known remaining gap (tracked separately): values stored as BSON
  `Date` (mongodb) or JS `Date` (memory `find()`) never match _string_ comparands
  of any operator — a storage-form problem, not a bound-semantics one.

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

- 9e8f04d: fix(driver-memory,driver-mongodb): `Field.datetime` has one storage form per driver (#4047)

  The non-SQL counterpart of ADR-0053 D-B (#3912). Both drivers let the writer
  decide a datetime value's runtime type, and both compare across types by type
  bracket rather than by value — so a string comparand never matched a `Date`
  value, in either direction, for **every** operator including `$gte`.

  A datetime column genuinely held both forms: the drivers' own
  `created_at`/`updated_at` defaults bind a `Date` (mongo) or an ISO string
  (memory), while REST/JSON writes, relative-date tokens and `initialData`
  fixtures supply the other. A dashboard date window therefore answered with
  whichever half happened to match the comparand's type — on MongoDB, where
  `created_at` is a BSON `Date` and dashboard bounds are strings, that meant
  **no rows at all**, which is worse than the final-day loss #3777 fixed.

  Each driver now has one canonical form, applied on write and to every filter
  comparand:

  | Driver           | `datetime`                                                                                                           | `date`            |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
  | `driver-mongodb` | BSON `Date` — the dialect's native instant, its `timestamptz`                                                        | `YYYY-MM-DD` text |
  | `driver-memory`  | canonical UTC ISO text (sorts chronologically under the string comparison mingo performs; survives JSON persistence) | `YYYY-MM-DD` text |

  Both learn their temporal fields from `syncSchema`, so an object that was never
  declared is left exactly as written — the drivers do not guess types from
  values. `driver-memory` additionally converges rows already in the table when
  the schema arrives, which catches `initialData` fixtures and anything a
  persistence adapter restored (the in-memory analogue of
  `backfillCanonicalDatetimes`, and idempotent like it).

  `Field.date` deliberately stays timezone-naive text on both — converting it to
  an instant would invent a midnight and re-couple it to a zone. The
  calendar-day bound semantics from #3777/#4042 are unchanged and now compose
  with the converged storage: the whole-day rewrite runs on the calendar string
  first, and only the resulting bound is converted to the storage form.

- 4384921: fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

  Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
  read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
  and most of what looked like sloppy test fixtures was the types being wrong.

  **`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
  long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
  to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
  own warning text tells callers to set it, `ObjectQLEngine` sets it for
  system-context calls, and `service-settings` / `service-datasource` pass it on
  every global-scope write. Because the schema never had it, the driver read it
  through `(options as any)` and no caller was type-checked. The declaration
  states the limit as well: it silences a diagnostic and MUST NOT change which
  rows a write touches — suppressing an audit warning is not a permission.

  The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
  all long since declared. Those reads now go through `DriverOptions`, so the next
  undeclared option fails the build instead of hiding behind an existing cast.

  **`SqlDriver.findOne(object, id)` is removed.** An undeclared
  `typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
  contract, nothing outside that package's own tests used it, and the other two
  drivers answered the identical call differently — `MemoryDriver` spreads the
  string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
  and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
  it skipped field selection, temporal coercion, unknown-column recovery and the
  `singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

  ```ts
  -(await driver.findOne("task", "t1"));
  +(await driver.findOne("task", { object: "task", where: { id: "t1" } }));
  ```

  **`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
  fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
  tenant column and to set or clear the sticky explicit-opt-out — but the
  parameter type listed only `{ name, fields }`, so a caller that spelled the key
  correctly was rejected while the driver read it anyway.
  `registerExternalObject` already had it.

  **`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
  `.default('UTC')`, so the parsed type requires it and an authored literal does
  not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
  the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
  `IDataDriver` return types; without them TS inferred the literal the method
  builds and every other column of the created row disappeared from the caller's
  view.

  One silent runtime bug fell out of the same pass: a driver test asked for
  `orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
  the sort never reached SQL. The tuple spelling appears nowhere else.

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 9bf4dd0: fix(driver-memory): the analytics echo renders the query it describes (#7117)

  `MemoryAnalyticsService` has two exits for one normalized filter tree, and they
  disagreed about what the LIKE family MEANS. `query()` builds a real containment
  pattern; `generateSql()` emitted the comparand as a bare literal with no
  wildcard anywhere, so `{name: {$contains: 'acme'}}` echoed

  ```sql
  WHERE name LIKE 'acme'
  ```

  — an **equality** — beside a chart drawn from every row _containing_ `acme`.
  The echo's only job is reproducing execution, so an author who ran it to debug
  the chart got a **narrower** row set and read the filter as broken.
  `$notContains` mirrored it through `NOT LIKE`.

  **What the echo emits now.** The `$contains` family renders `GLOB '*v*'` /
  `NOT GLOB`, and `$icontains` renders `lower(col) GLOB lower('*v*')`. `GLOB`
  rather than `LIKE` because this exit emits SQLite-shaped SQL and SQLite's `LIKE`
  folds ASCII case unconditionally: #4706 Q2 = A rules the `$contains` family
  case-**sensitive**, and #7723 put this package's execution faces on that answer,
  so a `LIKE` echo would have contradicted execution on a second axis the moment
  the missing wildcards were added. The two halves are one fix because `GLOB`
  speaks a different pattern language from `LIKE` — choosing the construct and
  rendering the wildcards are the same decision. The translation is the spec's
  shared `likePatternToGlobPattern`, and the comparand is escaped first, so an
  author's own `%` / `_` / `*` / `?` / `[` stay literal instead of becoming the
  match-every-row bypass (#5567).

  **The `|| '='` fallback is gone with it.** `operatorToSql` was a
  name→name map, which cannot hold a wildcard, a list, or a null-safe negation;
  it is now a builder table keyed by `CubeOperator`, the shape #5374 gave the
  mingo exit, so a widened vocabulary fails to compile until its SQL spelling
  exists. Three operators were reaching that fallback and are fixed with it —
  measured against `query()` on a six-row fixture:

  | `where`                   | `query()`      | echoed, before                  | echoed, now                         |
  | ------------------------- | -------------- | ------------------------------- | ----------------------------------- |
  | `{name: {$in: [a, b]}}`   | both rows      | `name = a` — one row            | `name IN (a, b)`                    |
  | `{name: {$nin: [a]}}`     | the other five | `name = a` — the **complement** | `(name IS NULL OR name NOT IN (a))` |
  | `{name: {$exists: true}}` | five rows      | `name = 1` — **no** rows        | `name IS NOT NULL`                  |

  Three smaller divergences on the same builder went with them: negations are
  null-safe (`$ne` / `$nin` / `$notContains` kept only rows whose column was not
  NULL, where the pipeline returns them — the #5146 / #5297 rule the rest of the
  repo already follows); an empty `$in` / `$nin` list now renders a predicate
  instead of no `WHERE` at all (an empty `$in` echoed the whole table while the
  pipeline returns nothing); and a bare-day `$lte` bound renders half-open, as the
  pipeline has read it since #4042.

  `$startsWith` and `$endsWith` never reached the fallback and are unchanged: this
  face does not lower them, so both exits refuse them with `INVALID_FILTER` / 400
  (#5345).

  Only the _displayed_ SQL changes — this exit produces the statement shown for
  transparency, never the query that runs, and `query()`'s rows are untouched.

- 69fde55: driver-memory: the `$contains` family is case-SENSITIVE, and `count_distinct` answers a number

  Two user-visible answers change on the in-memory driver. Both bring it onto the
  answer the SQL family, MongoDB and the protocol already give, so a filter or an
  aggregate now means the same thing whether your tests run on this double or your
  production runs a real database.

  **`$contains` / `$notContains` / `$startsWith` / `$endsWith` no longer fold
  case.** They matched with a case-insensitive regex on the query path and on the
  analytics face — over the whole Unicode range, wider even than the ASCII
  boundary `$icontains` is held to — so `{ name: { $contains: 'acme' } }` returned
  `ACME Corp` here and did not on any other backend. This driver's reference
  matcher (`match()`) was already case-exact, so the two folding faces have moved
  onto the answer the third one always gave. The comparand stays literal: `%`,
  `_` and `.` were never wildcards here and still are not.

  **This is a ROW-SET change.** If you relied on the fold, write `$icontains` —
  the operator that spells it, implemented on every backend since #6520 and
  folding ASCII case only.

  **`count_distinct` answers.** `MemoryDriver.computeAggregate` had no arm for it,
  so an aggregation the Query Protocol declares resolved with `{ alias: null }` —
  no error, no log, no refusal. It now counts distinct NON-NULL values, matching
  `COUNT(DISTINCT col)`. The analytics face was wrong in its own way and is fixed
  beside it: it collected the distinct values and never sized them, so a
  `count_distinct` measure came back as the raw array of values under a field its
  own response metadata types as `number`.

  Both are held to `@objectstack/spec/data`'s shared case-sets from now on
  (`FILTER_TEXT_CASES`, `AGGREGATION_CASES`), executed in process against every
  face of the package.

- 60a7a2d: fix(driver-memory): the live query path refuses the filters it cannot evaluate, and compiles the one it must (#5324, #5328)

  **This is an observable behaviour change.** Two filter shapes that used to be
  answered _silently_ now raise the catalogued `INVALID_FILTER` / 400 every other
  filter refusal in this driver and in `driver-sql` already speaks (ADR-0112):

  | filter                                                                                                                              | before                                                                                                                       | now                                                                     |
  | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | an operator outside the Filter Protocol — `{ name: { $sounds_like: 'x' } }`, `$elemMatch`, `$size`, `$where`, field-level `$not`, … | handed to mingo, which threw a `MingoError` carrying **no `code` and no `status`** — served as a 500-shaped `{ error }` body | `INVALID_FILTER` / 400, naming the operator, the field and its position |
  | a `$between` whose comparand is not `[min, max]` — `{ score: { $between: 5 } }`                                                     | the arm was skipped, the constraint **vanished**, and `find` returned `[]`                                                   | `INVALID_FILTER` / 400, wording aligned with `driver-sql`'s             |

  Two more shapes join them, same cause: an undeclared `$`-combinator in a node
  position (`{ $nor: … }`, `{ $where: … }` — `FilterConditionSchema` declares
  `$and`/`$or`/`$not` and nothing else), and a combinator operand that is not a
  filter condition (`{ $or: 'x' }`, `{ $or: [null] }`, `{ $not: 'x' }`).

  If a query of yours starts returning a 400, it was already broken — it was
  returning an empty result set or an uncoded 500 for the same input, and
  `driver-sql` was rejecting it. The message names the operator and the path
  (`filter.$or[1].$and[0].stage`).

  **`$not` is the opposite change: it now works.** `$not` is a declared combinator
  (`LOGICAL_OPERATORS`), `cel-to-filter` emits it for every CEL `!expr` in an RLS
  read scope, and `driver-sql` / `driver-mongodb` / this package's own reference
  matcher all implement it — but the live query path passed it to mingo, and
  MongoDB has no document-level `$not`, so **every query carrying a negated scope
  threw** `unknown top level operator: $not`. It is compiled to `$nor` with one
  operand, the same rewrite `driver-mongodb` performs, which is NULL-safe by
  construction and therefore lands on the answer #5146 ruled canonical.

  Both of this package's filter faces — the live mingo path and the reference
  matcher — now share ONE shape gate, so they cannot answer one filter
  differently again. They did: given a malformed `$between` the live path returned
  NO rows while the matcher returned EVERY row.

  The conformance gap that hid all of this is closed too. `FILTER_LOGIC_CASES`
  was run against this backend through the reference matcher only — the driver
  does not call it — so the table's `$not` case had been green for as long as it
  existed while the same filter through `InMemoryDriver.find` threw. The table now
  runs through the real driver, as it does for the other three backends.

  Accepted operators are the spec's `FILTER_OPERATORS`, plus `$regex` (produced by
  plugin-auth's ObjectQL adapter, compiled by `driver-sql`) and its `$options`
  companion. `$options` is a modifier, not a predicate: on its own, with no
  `$regex` beside it, it is refused like any other filter this driver cannot
  evaluate — it used to raise the same uncoded engine error on the live path and
  match every row in the matcher.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                                                                                                                                                   |
  | :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`                                                                                                                             |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                                                                                                                                                   |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | the same `expand`, keeping the FK in your own projection (`fields: ['title', 'owner_id']`) — **not** a dotted `fields` path, which no driver resolves and the ingress refuses (#7532) |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias`                                                                                                                      |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

- 6038de7: feat(spec,drivers): the temporal conformance matrix gains its `Field.time` axis — and `time` finally gets a storage form off SQL (ADR-0053 D-A3.2)

  `@objectstack/spec/data` gains `TEMPORAL_TIME_ROWS` / `TEMPORAL_TIME_CASES`,
  the wall-clock half of the shared matrix. A time gets its own table rather than
  a third `kind` on the existing one because it shares no comparand vocabulary
  with the other two: no relative token resolves to a wall clock, and the
  bare-day whole-day rule (#3777) must **not** reach it — which the table now
  asserts rather than assumes, since "the rule leaked into the wrong field type"
  is exactly what a conformance matrix is for. The fixture is a business day
  carrying the boundaries #3994 measured: both window edges, the pair straddling
  the millisecond-suffix width change, midnight and `23:59:59.999`.

  **The axis found a real gap on its first run.** ADR-0053 D-C gave `Field.time`
  a canonical form on every SQL dialect, but `driver-memory` and
  `driver-mongodb` were never extended — both declared
  `TemporalFieldKind = 'datetime' | 'date'`, so a `time` column was never
  classified and never coerced. It therefore held whatever each writer produced,
  and both stores compare across types by bracket: a text bound matched no
  `Date`-written row, in either direction, for every operator. Measured on
  `driver-memory`, **8 of the 9 shared cases** returned only the text-written
  half — a business-hours window answering `[d_mid, f_close]` instead of
  `[c_open, d_mid, e_mid_ms, f_close]`. This is #4047's failure one field type
  over, and it survived #4047 because that work extended `datetime` and `date`
  without revisiting `time`. On mongo it was also a documentation failure: that
  module's canon table has listed `time` as `HH:MM:SS[.fff]` text since #3994,
  and nothing implemented it.

  Both drivers now carry `storageTimeValue`, mirroring the SQL
  `canonicalTimeOfDay`: `HH:MM:SS`, `.fff` only when the milliseconds are
  non-zero, a `Date` / epoch / full-timestamp folding to its **UTC** time-of-day
  (never the host's), and totality — an out-of-range wall clock like `'25:00'`
  passes through rather than being silently rewritten. Text on both, mongo
  included: a wall clock is not an instant, so a BSON `Date` would invent a
  calendar day and a zone the author never wrote.

  If you have existing `time` data on either driver, values written as `Date`
  objects converge to canonical text on their next write; reads of un-migrated
  documents are unchanged. Filters were already unable to reach the mixed half,
  so no query that worked before stops working.

- 0166bd5: fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

  `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
  `ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
  `isFilterAST()`, which decides whether a filter is parsed into a query at all.
  They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
  `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

  An author could declare any of them, `ViewFilterRuleSchema` validated them,
  `defineStack` accepted them — and then `isFilterAST()` refused the filter, the
  protocol passed the array through unconverted, and the driver could not apply it.
  Six of the eight were reachable only in theory because ObjectUI's adapter alias
  table happened to translate them; the safety of the query path was resting on a
  hand-written table in another repository being complete, and for `before`/`after`
  it wasn't.

  **`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
  is derived from its keys rather than restated, so an operator can no longer be
  accepted by the gate without also having a lowering — the two were separate
  hand-written lists that happened to agree, with nothing enforcing it. The map
  gained the eight canonical view spellings plus the squashed/short forms stored
  metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

  **New export `canonicalAstOperator(op)`** folds every accepted spelling of one
  comparison onto a single infix form. Both drivers now call it instead of growing
  private alias lists, which is what let them accept different vocabularies.
  `like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
  to SQL verbatim, so folding would silently wrap the value in `%…%`.

  Widening only — no spelling was removed, so no stored filter stops validating.
  A filter that previously produced an error (after #4029) or was silently dropped
  (before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
  `VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
  lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
  next operator the view layer gains fails a test instead of a query.

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

### Major Changes

- 262e40d: refactor(drivers)!: memory / mongodb 的 `aggregate` / `distinct` 也收进 `DriverQuery`，契约没覆盖的方法不再要求把对象名写两遍 (#6212 批 C)

  #6210 的 changeset 结尾专门留了一句：`aggregate` / `distinct` **不在**那次范围内，因为它们不是 `IDataDriver` 收窄的那六个方法。#6212 记下了这笔账，本次结清 memory 与 mongodb 这两个包的部分。

  这批方法的第一个实参**已经是对象名**，query 里却仍旧要求再写一遍：

  | 位置                                        | 收窄前                              | 收窄后                                 |
  | :------------------------------------------ | :---------------------------------- | :------------------------------------- |
  | `MongoDBDriver.aggregate`                   | `query: QueryAST`                   | `query: DriverQuery`                   |
  | `InMemoryDriver.distinct`                   | `query?: QueryInput`                | `query?: DriverQuery`                  |
  | `InMemoryDriver.aggregate`                  | `Record<string, any>[] \| QueryAST` | `Record<string, any>[] \| DriverQuery` |
  | `InMemoryDriver.performAggregation`（私有） | `Omit<QueryInput, 'object'>`        | `DriverQuery`                          |

  因为 `QueryAST` / `QueryInput` 都把 `object` 声明成**必填**，一个手上只有 `where` 的调用方根本叫不出这个类型的名字，于是伸手去拿 `as any` —— 连 `where` / `orderBy` / `limit` 的检查一起关掉。这正是 #5181 记过账的那笔代价（cloud#1053 实测 20 处，cloud#1030 的 `$like` 就是从这个口子活到运行时的）。收窄之后调用方可以直接写字面量：

  ```ts
  // 收窄前：object 是必填，这句编译不过，于是 ... as any
  // 收窄后：直接过，且 where / orderBy / aggregations 逐个受检
  await driver.aggregate("order", {
    groupBy: ["region"],
    aggregations: [{ function: "sum", field: "amount", alias: "total" }],
  });
  ```

  同一次改动收回了 4 处已经多余的 `as any`（memory 2、mongodb 2），`check:query-options-erasure` 的测试面因此从 267 降到 263，baseline 已按门禁要求同 PR `--update`。

  **`InMemoryDriver.aggregate` 的联合刻意保留。** 两条分支都有活体生产者：mongo 管线数组那支由 `memory-analytics.ts` 喂，AST 那支由 objectql 引擎与 `@objectstack/verify` 的日期分桶探针喂。退役任何一支都会打断其中一条。

  **顺带把 `#6212` 正文的一处归因证伪了**：正文说 `performAggregation` 当初选 `Omit<QueryInput, 'object'>` 是被 `groupBy` 的元素类型差异逼的。实测 `QueryInput` 与 `QueryAST` 在 `groupBy` 上**逐字相同**，差异只在 `search` / `orderBy` / `expand`；直接换 `DriverQuery` 零报错。所以那不是被迫的选择，契约优先取 `DriverQuery`，不再引入第二个查询类型家族。

  **零运行时改动。** 非测试改动 100% 是类型注解，无逻辑、无行为、无 emit 差异（`as` 断言在编译期即被抹除）。测试全绿：memory 532、mongodb 206（另 137 条需真实 mongod，按既有 opt-in 规则跳过）。这也是 #5499 冻结面上被允许的处置口径 —— 与 #6210 在同一批驱动上走的是同一条。

  **迁移面：删掉调用字面量里的 `object:` 键**，与 #5181 / #6210 同一句话，现在覆盖到 `aggregate` / `distinct`。编译器会逐处指出来：

  ```
  error TS2353: Object literal may only specify known properties,
                and 'object' does not exist in type 'DriverQuery'.
  ```

  本仓实测只有一处需要改（`memory-driver.test.ts` 的 `distinct` 用例），且它写的值与第一实参逐字相等，纯冗余。

  标 major 的依据与 #5181 / #6210 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

- d367f03: refactor(drivers)!: 五个驱动的 query 参数跟进 `DriverQuery`，休眠的类型谎言就此没有藏身处 (#6075)

  #5181（PR #6076）把 `IDataDriver.find/findOne/count/updateMany/deleteMany/explain` 的 query 参数收窄为 `DriverQuery`（`Omit<QueryAST, 'object'>`），并在同一条 changeset 里写明：「把驱动签名一并迁到 `DriverQuery` 是后续的机械收尾」。这就是那次收尾。

  在此之前，五个驱动的实现仍旧声明 `query: QueryAST`（turso 侧是 `query: any`）。**它不红，也不会红** —— 方法参数按双变比较，实现声明得比契约宽照样满足契约。但调用方现在**有权**省略 `object`，于是这些实现的类型说 `query.object` 是 `string`，运行期却可能是 `undefined`：一句休眠的谎言，没有任何门拦得住下一个照着它写代码的人。

  收尾之后，「驱动读 `query.object`」直接变成编译错误：

  ```ts
  // 收窄前：编译通过，运行期可能是 undefined —— 谎言
  // 收窄后：error TS2339: Property 'object' does not exist on type 'DriverQuery'.
  const name = query.object;
  ```

  **零运行时改动。** 本次改的全部是类型注解：五个驱动的六个契约方法签名，以及为让类型自洽而必须跟进的少量私有辅助方法参数（mongodb 的 `buildFindOptions` / `buildSortSpec`，sql 的 `findRows` / `orderKeysFor`，turso 的 `toRemoteQuery` / `toRemoteReadQuery`，memory 的 `performAggregation`）—— 它们都只转发或读取 `where` / `orderBy` / `groupBy` 这些字段，本来就不读 `object`。turso 的几处 `query: any` 一并收紧，多拿回一批本已放弃的检查。emit 无差异，测试全绿（memory 524、mongodb 206、sql 906、sqlite-wasm 254、turso 788）。

  **迁移面：删掉驱动调用字面量里的 `object:` 键**，与 #5181 是同一句话，只是现在也覆盖了直接按具体驱动类（`SqlDriver` / `MemoryDriver` / …）而非按 `IDataDriver` 取类型的调用方。编译器会逐处指出来（TS2353 `'object' does not exist in type 'DriverQuery'`）。本仓下游 25 个包实测零处需要改动，改动只落在五个驱动自己的测试里。

  标 major 的依据与 #5181 一致：**源码级破坏性**（调用点内联字面量），运行时行为零变化。`check:api-surface` 只记录导出的存在与否、不记录签名，因此这条说明同样是该变更唯一的下游载体。

  `aggregate` / `distinct` / `syncSchemasBatch` 不在本次范围内 —— 它们不是 `IDataDriver` 收窄的那六个方法，其中 `syncSchemasBatch` 的条目里 `object` 是被真实读取的必填键，`expand` 条目里的 `object` 同理命名的是关联对象，都不是冗余。

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

- 82397b6: feat(drivers,objectql): `$regex` / `$options` are refused everywhere, and `$icontains` is implemented on the SQL family (#5702)

  The driver half of the #4706 ruling. #5701 landed the contract (the vocabulary,
  the `RETIRED_FILTER_OPERATORS` prescriptions, the shared text case-set) and
  #5710 flipped the last live producer — `plugin-auth`'s ObjectQL adapter, which
  emitted `$regex` on the authentication path — so the refusal can now land
  without breaking sign-in.

  **BREAKING for anyone writing `$regex` or `$options` in a filter.** Both are
  refused on every backend with `INVALID_FILTER` / 400 and a message that names
  the replacement. `$regex` was never a declared operator: `driver-sql` compiled
  it to a LIKE-escaped substring (so `a.b` matched only the literal `a.b`),
  `driver-memory` ran it as a real `RegExp` (so the same filter also matched
  `axb`, and an _invalid_ pattern was caught and answered `false` — zero rows, in
  silence), and `objectql`'s `having` did the same. Write `$icontains` for the
  case-insensitive substring search this was almost always used for, `$contains`
  for a case-sensitive one; a pattern that genuinely needs a regex has no
  filter-level replacement.

  **`$icontains` now runs on the SQL family** — `driver-sql`, `driver-sqlite-wasm`,
  and both of `driver-turso`'s transports (the remote one does not go through
  knex, so it needed its own). It compiles to `LOWER(col) LIKE LOWER(?) ESCAPE ?`
  through the same `applyLike` / `pushLike` that carries the `%` / `_` / `\`
  escaping, as a `fold` parameter rather than a second emitter — a copied emitter
  is where the escape class would have been dropped, and an unescaped `%` matches
  every row. An empty or non-string comparand is refused on the validating walk
  (an empty one matches every row, which widens rather than narrows). On SQLite
  `lower()` folds ASCII only, which IS the contract (#4706 Q1 = A): `$icontains:
'café'` does not match `CAFÉ`.

    <!-- adr-0087: registered filter-regex-options-retired -->

  `driver-mongodb`'s unknown-operator arm was throwing a bare `Error` with no
  `code` and no `status`, three lines from the helper in its own file that sets
  `INVALID_FILTER` / 400 — a 500-shaped body for a 400-class client mistake. It
  now speaks the same envelope as its three siblings.

  Two parts of the ruling are deliberately NOT in this change and stay tracked in
  `scripts/check-driver-conformance.mjs`'s ledger: the `$contains` family's
  case-sensitivity (#4706 Q2 = A) needs SQLite's `LIKE` replaced by a case-exact
  construct in the driver, the RLS lowering and the analytics lowering together,
  or one permission rule compiles to two row sets (#6518); and `$icontains` on the
  JS evaluation faces needs the spec vocabulary to take the operator, which cannot
  happen before `driver-memory` has an arm for it (#6520).

### Patch Changes

- 8825a06: drivers: `limit: 0` returns no records, on every driver and every read door

  `limit: 0` was ruled in #6485 to mean **return no records**. Three of the five shipped
  drivers did not honour it, in three different ways — and the ones that disagreed
  returned **more** data than was requested, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter. Reachable since #6578: the client now puts
  `top=0` on the wire, so the answer depended on which driver a deployment configured.

  **`driver-memory` — the slice was dropped.** `find()` sliced with `if (query.limit)`,
  truthiness, and `0` is falsy. Measured before the fix, three rows seeded:
  `{ limit: 0 }` returned **3 of 3**, and `{ limit: 0, offset: 1 }` returned 2 — the
  OFFSET applied and the LIMIT silently did not, which is why every paging suite stayed
  green over it. Two more sites of the same shape in `memory-analytics.ts` (the `$limit`
  pipeline stage and the SQL string builder) moved with it. Mingo honours `{ $limit: 0 }`
  as zero records (measured), so presence is sufficient there.

  **`driver-mongodb` — the value was forwarded faithfully, to a client that means
  something else by it.** `buildFindOptions` already tested presence, so `0` arrived
  exactly as written — but the MongoDB Node driver DEFINES `limit: 0` as _no limit_, so
  the answer was still the whole collection. Fixed with an explicit short-circuit that
  returns the empty result **before the client is consulted** (`[]` from `find`, `null`
  from `findOne`, which had the same hole). No round trip is made for a query whose
  answer is already known, and no future change in the upstream driver's reading of `0`
  can move this behaviour. Deliberately `=== 0`, not `<= 0`.

  **`driver-sql` — two doors disagreed with a third.** `findRows()`, the door `find()`
  goes through, has always compiled `limit` on presence. Two others compiled it on
  truthiness:

  - `findWithWindowFunctions()` — the live window-function read door (#4286). Returns
    rows, so this was user-visible wrong data: `{ limit: 0 }` returned the whole table.
  - `analyzeQuery()` / `explain()` — returns a plan. It compiled `select * from "orders"`
    where `find()` sent `... order by "id" asc limit ?`, so it explained a statement
    other than the one that would run.

  `offset` moved with `limit` at both doors for internal consistency only. That half is
  **measured to change nothing**: knex elides a zero offset on better-sqlite3, Postgres
  and MySQL alike. It is pinned as the no-op it is rather than reported as a fix.

  **`driver-turso` remote transport — an `OFFSET` with no `LIMIT` was a syntax error.**
  Surfaced by the new conformance control that reads with a bare offset. SQLite's grammar
  is `LIMIT expr [OFFSET expr]`, and this compiler emitted the two clauses independently,
  so `find(obj, { offset: N })` with no `limit` produced `near "OFFSET": syntax error` —
  for **every** `N`, and only on the remote transport (the local half goes through knex,
  which synthesises the `LIMIT -1` no-limit sentinel). Remote now builds the same
  statement knex does.

  Result sets only ever get **narrower**. A caller who wants every row should omit
  `limit` rather than pass `0`.

  `@objectstack/spec` gains `PAGINATION_ZERO_LIMIT_CASES`, the shared conformance
  case-set pinning this — with controls, so "return nothing, always" cannot pass it. All
  **five** drivers answer it, with **no DEBT rows**: future drift goes red at
  `check:driver-conformance` rather than being discovered in production.

- 3510e4a: refactor(spec,drivers,lint): one implementation of the filter identity reduction (#5659)

  `{ $and: [] }` matches every row, `{ $or: [] }` matches none, `{}` is a TRUE
  disjunct that absorbs its `$or`, `{ $not: {} }` is FALSE. That is a ruling
  (#5322/#5134) pinned for every backend by the four identity cases in
  `FILTER_LOGIC_CASES` — and it was implemented four times over: `reduceFilterNode`
  in `driver-sql`, the same function again in `driver-mongodb`, the
  `every`/`some`/truthiness algebra of `driver-memory`'s matcher, and nearly a
  fifth hand-written copy inside `@objectstack/lint`, which declined to write one
  and filed this issue instead.

  **New in `@objectstack/spec` (`@objectstack/spec/data`): `reduceFilterVerdict`**,
  beside the case table that proves it. It answers `'true' | 'false' | 'clause'`
  for a filter node and never throws on its own; each backend's own refusals — the
  undeclared `$`-combinator and the `undefined` comparand in `driver-sql`, the
  query-level keys and the `$null` comparand in `driver-mongodb` — are passed in as
  `FilterVerdictHooks` and are invoked from exactly the positions they were invoked
  from before. `reduceFilterKeyVerdict` answers the same question for one key, which
  is what both SQL and MongoDB emitters consult while walking a node.

  **No behaviour changes in the three drivers.** The move is mechanical: the shared
  algebra replaces each private copy, the refusals stay where they were, and the
  `FILTER_LOGIC_CASES` conformance suites are green on both sides of the change —
  including the SQL-inheriting `driver-sqlite-wasm` and `driver-turso`.

  **`@objectstack/lint` gains two warnings it was structurally blind to.** The
  `multi: true` unbounded-bulk-write rule (#5482) asked "does this filter have zero
  keys", so a `delete_record` bounded by `filter: { $and: [] }` or
  `filter: { $or: [{}] }` — a whole-object write by the ruling every driver executes
  — passed silently. It now asks the reduction, and it warns about both while
  staying quiet on `{ $or: [] }` and `{ $not: {} }`, which match nothing. The
  message names the shape it saw (`a filter that REDUCES TO TRUE ({"$and":[]})`)
  rather than calling a non-empty filter "empty".

  If you have a flow declaring a bulk write bounded by one of those two shapes, the
  lint will now tell you so — the write was already unbounded at run time; only the
  feedback is new.

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
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

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

### Minor Changes

- f7df82c: fix(driver-memory): the analytics (cube) face stops round-tripping filter comparands through `string[]`, which was losing booleans, `null` and numeric-looking strings (#5373)

  **This is an observable behaviour change on a shipped surface: widgets whose
  `where` carries a boolean, a `null`, or a numeric-looking string comparand will
  show different — correct — numbers.** Some of them go from zero rows to a real
  answer; others go from the whole table down to the rows actually asked for.

  ## What was happening

  `MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a cube-style
  `{member, operator, values}` list whose `values` was typed `string[]`, because
  the cube WIRE format serialises filter values as strings. So every comparand
  made a JS value → string → JS value round trip on its way to the pipeline, and
  that round trip is lossy for anything that is not already a string:

  | `where`                       | stringified | recovered as         | compared against      | rows                |
  | ----------------------------- | ----------- | -------------------- | --------------------- | ------------------- |
  | `{is_active: true}`           | `'1'`       | the number `1`       | stored `true`         | **0**               |
  | `{is_active: false}`          | `'0'`       | the number `0`       | stored `false`        | **0**               |
  | `{closed_at: null}`           | —           | _(dropped entirely)_ | —                     | **the whole table** |
  | `{closed_at: {$ne: null}}`    | `''`        | `''`                 | stored `null`         | **the whole table** |
  | `{code: '100'}` (TEXT column) | `'100'`     | the number `100`     | stored `'100'`        | **0**               |
  | `{is_active: {$ne: true}}`    | `'1'`       | the number `1`       | stored `true`/`false` | **the whole table** |

  mingo compares across JS types the way MongoDB compares across BSON types —
  never equal — so none of these is an error. Each is a wrong row set, silently.

  The two directions fail differently, and the widening one is worse. A boolean
  filter that returns nothing renders an empty chart, which someone notices. A
  `null` filter that returns everything renders a _normal-looking_ chart: a
  "closed_at is empty" widget quietly counted the closed records too. That is the
  direction #3948 outlawed, and on an RLS read scope it is an unauthorized read
  rather than a wrong number.

  `{is_active: true, stage: {$nin: ['lost']}}` is `AnalyticsQuerySchema.where`'s
  own docstring example. It returned zero rows on this face.

  ## Why the encoding could not simply be fixed

  `stringifyForCube` encoded booleans as `'1'`/`'0'` "so that downstream consumers
  expecting SQLite-style numeric booleans match correctly". That justification is
  sound for the SQL-generating exit and false for the in-memory one — and both
  exits shared the single encoding. There is no string spelling of `true` that is
  right for `WHERE is_active = ?` and for a mingo `$eq` against a stored boolean at
  the same time, so making the round trip lossless would have meant tagging values
  in a format the two exits then have to agree to decode.

  So the round trip is **gone** instead. `values` is `unknown[]`; the comparand
  stays whatever the author wrote, and each exit converts at its own boundary
  where it knows what it needs. This is affordable because the triple is a purely
  internal intermediate: `AnalyticsQuery.where` is a `FilterCondition` and nothing
  else (#5375 removed the leg that also accepted a cube-style array as input), and
  the API layer actively rejects a `{member, operator, values}` array on the wire.
  No caller, no spec schema and no serialized form observes its shape — this
  change touches zero spec bytes.

  ## What changes for you

  Filters are evaluated against the values you wrote:

  - `{is_active: true}` selects the true rows instead of none.
  - `{closed_at: null}` selects the null rows instead of every row, and
    `{closed_at: {$ne: null}}` selects the complement instead of every row.
  - `{code: '100'}` on a TEXT column matches the string `'100'` instead of nothing.
  - `{qty: 100}` on a numeric column is unchanged — it was already right.

  `generateSql()` is corrected on the same cases, because a fix that satisfied
  mingo while emitting SQL meaning something else would only have moved the bug:

  - a numeric-looking string is now quoted (`code = '100'`, previously `code = 100`)
    while a real number still is not (`qty = 100`);
  - a null comparand becomes a nullness test (`closed_at IS NULL` /
    `closed_at IS NOT NULL`) rather than the `= NULL` that is never true in SQL,
    or — as before this fix — no clause at all;
  - booleans keep the SQLite-style `1`/`0` spelling, which was always right for
    this half.

  Temporal comparands still convert, and now do so through the driver's own
  storage-form rule (`filterComparandStorageForm`, keyed on the declared field
  kind, #4047) rather than an ad-hoc `toISOString()`. A `Date` against a declared
  `datetime` column therefore keeps meeting the canonical UTC ISO text the driver
  wrote — a second derivation of that rule inside the analytics face is exactly
  the in-package divergence #5240 ruled against.

  Nothing else moves: operator vocabulary, the #5345 refusals, `$and` folding,
  nested-relation flattening, time dimensions and the empty filter are unchanged.

  ## Coverage

  The cases live in the shared conformance file beside the #5324/#5345 shape
  table, not in a suite of their own. `FILTER_LOGIC_CASES` varies the filter's
  SHAPE over an all-string fixture — deliberately, so nothing in it is about
  coercion — which is why every one of its cases stayed green through this defect.
  The new block varies the comparand's TYPE over the fixture measured in the
  issue, and holds the same invariant: the analytics face must return the same ids
  as `find()`, or refuse. Reverting only the source change fails 11 of the new
  assertions, across both exits.

- d085670: fix(driver-memory): the analytics (cube) face REFUSES a filter it cannot compile instead of silently dropping it (#5345)

  **This is an observable behaviour change on a shipped surface, and it will turn
  some working-looking dashboards red.** That is the point: the widgets it breaks
  were returning inflated aggregates, and some of them were returning rows the
  caller had no permission to read.

  ## What was happening

  `MemoryAnalyticsService` lowers `AnalyticsQuery.where` into a flat, cube-style
  `{member, operator, values}` list. Anything that did not fit was answered with
  `continue` — in two places, and with a comment presenting it as a feature
  ("ignore so a partial query still runs rather than failing entirely"):

  | dropped                     | why it did not fit                                   |
  | --------------------------- | ---------------------------------------------------- |
  | `$or` (whole branch)        | no expression in a flat AND-list                     |
  | `$not` (whole branch)       | same                                                 |
  | `$between`                  | no row in the mongo→cube operator table              |
  | `$startsWith` / `$endsWith` | same                                                 |
  | `$null`                     | same                                                 |
  | `$regex`                    | same — and `plugin-auth`'s ObjectQL adapter emits it |

  Dropping a predicate does not narrow a query, it **widens** it: fewer
  constraints means more rows. A widget filtered to two stages with
  `{$or: [{stage: 'won'}, {stage: 'lost'}]}` aggregated the **entire table** and
  rendered as a perfectly normal chart. Measured on the shared
  `FILTER_LOGIC_CASES` fixture, **15 of its 17 cases** returned a wider row set
  than the standard specifies — usually every row. Of the two that did agree, one
  (`a $or nested under a top-level $and`) agreed by _coincidence_: its dropped
  `$or` happened to be redundant against a surviving sibling key, which is the
  best illustration available of why "the number looked right" was never evidence.

  `$not` makes it more than a wrong number. `cel-to-filter.ts` compiles a CEL
  `!expr` RLS read scope into `{$not: {…}}`, so the dropped branch was the read
  scope itself — the aggregate included records the caller is not allowed to see.

  ## What changes for you

  A `where` carrying any of the shapes above now raises **`INVALID_FILTER` / 400**
  (the ADR-0112 envelope every sibling filter refusal in this driver already
  speaks, reaching REST callers as a 400 since #5366) naming the offending
  operator or combinator and its position, e.g.:

  > Filter operator `"$between"` on field `"amount"` at `where.amount` is declared
  > by the Filter Protocol but cannot be compiled by driver-memory's analytics
  > (cube) face. Supported operators on this surface: `$eq, $ne, $gt, $gte, $lt,
$lte, $in, $nin, $contains, $notContains, $exists`.

  Both entry points refuse identically — `query()` and `generateSql()`.

  **The fix, per shape:**

  - `$between` on a range → the two bounds, which this face has always compiled:
    `{ closed_at: { $gte: '2026-01-01', $lte: '2026-01-31' } }`, or a
    `timeDimensions[].dateRange`, which is unaffected.
  - `$startsWith` / `$endsWith` / `$regex` → `$contains`, or move the query to
    `find()`.
  - `$null` → `{ field: { $exists: false } }` for the absent case.
  - `$or` / `$not` → restate as the implicit AND of field keys where the intent
    allows it; where it does not, the cube pipeline genuinely cannot express it,
    and the query belongs on `find()`.

  Nothing that was **compiled** changes. All eleven supported operators, `$and`,
  implicit equality, nested-relation flattening, time dimensions and the empty
  filter produce byte-identical pipelines.

  ## Why refuse rather than teach the cube pipeline `$or`

  This is the call ADR-0078 / #4286 made for `objectql`'s `having` — an ignored
  operator there "silently returns UNFILTERED aggregates", so it throws — and the
  posture #3948 established for every filter backend: a filter that cannot be
  compiled is refused loudly, never skipped. It is also where the two neighbouring
  faces landed (#5366, #5368).

  Mechanically, the refusal is not a new check bolted onto this face. It reuses
  the package's single filter gate, `assertFilterConditionShape`, which now takes
  the calling face's declared capabilities; and the analytics face derives those
  capabilities from its own mongo→cube operator table, so widening what it accepts
  and teaching it to compile the operator are now the same edit. The shared
  `FILTER_LOGIC_CASES` conformance table covers this third face for the first time
  (it watched only two of the driver's three), holding it to: agree with
  `find()`, or refuse — never a third, quieter answer.

- 01c0bae: fix(driver-memory): the analytics (cube) face compiles `$notContains` to a predicate that actually excludes rows, instead of a bare mingo `{$not: 'x'}` that constrains nothing (#5374)

  **This is an observable behaviour change on a shipped surface: widgets whose
  `where` carries `$notContains`, `$contains`, or an empty `$in` will show
  different — correct — numbers.** Every one of them moves in the same direction,
  from a wider row set to the rows actually asked for, because each of these
  defects made a predicate mean less than it says.

  ## What was happening

  `MemoryAnalyticsService` mapped each cube operator to the NAME of a mingo
  operator, and the call site filled that name in as
  `matchStage[field] = {[name]: comparand}`. That shape can express "compare this
  field to this value" and nothing else, so the two operators that need to WRAP
  their comparand were pushed through it anyway:

  | `where`                        | compiled `$match`           | analytics | `find()` |
  | ------------------------------ | --------------------------- | --------- | -------- |
  | `{name: {$notContains: 'et'}}` | `{name: {$not: 'et'}}`      | **3**     | 2        |
  | `{name: {$notContains: 'a'}}`  | `{name: {$not: 'a'}}`       | **3**     | 0        |
  | `{name: {$contains: 'a.p'}}`   | `{name: {$regex: 'a.p'}}`   | **1**     | 0        |
  | `{name: {$contains: 'ALPHA'}}` | `{name: {$regex: 'ALPHA'}}` | **0**     | 1        |
  | `{code: {$in: []}}`            | _(no predicate emitted)_    | **3**     | 0        |

  - **`notContains` → `'$not'`.** mingo's `$not` takes a regex or an operator
    expression; handed a bare scalar it constrains nothing. The predicate was
    emitted, appeared in the pipeline, and passed the whole table. A predicate
    that is emitted and inert is indistinguishable from a working one at the
    author's end — the same amplifying direction as #3948, reached a third way.
  - **`contains` → `'$regex'`** was the right operator with the comparand handed
    in raw, so it was neither escaped (a `.` matched any character) nor
    case-folded, while the live query path escapes and matches `/…/i`. One
    `where`, two meanings, depending on which face read it (#5240).
  - **an empty `$in`** hit the call site's `values.length > 0` guard and emitted
    no predicate at all, so the query widened to the whole table where `find()`
    returned nothing.
  - **an operand that is not a comparand** — a `$contains` pattern, a `$exists`
    flag — went through the field's storage-form conversion anyway, so on a
    declared `datetime` column the PATTERN itself was rewritten into canonical
    form and then matched rows `find()` does not match (#4047).

  ## What changed

  The operator table now holds a **predicate builder** per operator rather than an
  operator name, so `notContains` can say `{$not: {$regex: …}}` and the class of
  "this operator needs a structure and the table can only hold a name" is gone
  rather than this one instance of it. `$in` / `$nin` / `$lte` / `$exists`, which
  the call site had grown an `if` chain for, are ordinary rows in that table now.

  The substring rule itself is **borrowed from the driver** (new narrow
  `InMemoryDriver.filterSubstringPattern`, alongside `filterComparandStorageForm`)
  instead of re-derived, so `contains` on the analytics face escapes and case-folds
  exactly as `find()` does and the two cannot drift apart again.

  The `opMap[operator] || '$eq'` fallback — under which a misspelled or unmapped
  operator silently became an EQUALITY comparison — is gone. It was already
  unreachable after #5345 gated the vocabulary upstream, but only until someone
  widened that vocabulary, which #5345 deliberately made a one-line edit. The
  predicate table is keyed by the operator union derived from that same table, so
  the widening edit now **fails to compile** until the predicate exists.

  Two dead entries were deleted with it: `'notSet': '$exists'` (unreachable, and
  inverted if it ever had been reached) and `'inDateRange': '$gte'` (unreachable,
  and a one-ended `>=` answer to a two-ended range — its own comment conceded
  "Will need special handling" and nothing implemented it).

  ## Not changed

  The `generateSql()` exit is untouched. Its operator-layer defects are #5433,
  filed and deliberately not bundled.

- 0f17114: fix(driver-sql,driver-memory,formula)!: `{ field: {} }` 一律拒收 —— 零个操作符的字段约束不再在四个后端有三个答案 (#5240)

  `{ a: {} }`(一个字段,后面跟零个操作符)是 `FilterConditionSchema` 今天**声明合法**的形状,
  而同一个 filter 在同仓四条路径上有三个答案:

  | 路径                                | 改前                                                                                            | 改后                          |
  | ----------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------- |
  | `driver-sql`,顶层 plain map         | 抛 `INVALID_FILTER`(#5041 的比较数闸门)                                                         | 抛 `INVALID_FILTER`(专用消息) |
  | `driver-sql`,`$and`/`$or`/`$not` 内 | 遍历零个操作符 → 不产出任何 SQL → **TRUE(匹配全表)**                                            | 抛 `INVALID_FILTER`           |
  | `driver-memory`                     | 实时路径经 mingo 变成「字段深等于空文档」;参考匹配器落到 `JSON.stringify` 结构相等 → 顺带 FALSE | 抛 `INVALID_FILTER`           |
  | `@objectstack/formula`              | `keys.length === 0` 显式 fail-closed → FALSE                                                    | 抛 `INVALID_FILTER`           |

  于是 `{ $or: [ { a: {} }, { b: 2 } ] }` 在 SQL 上编译成 `(b = 2)` —— 既不是「零约束即 TRUE」
  该给的全表,也不是两个 JS 后端给的 FALSE,而是**子句被 knex 连同空分组一起丢掉**的结果;
  而 `driver-sql` 自己内部就不自洽:同一个 `{ a: {} }` 写在顶层被响亮拒收,包进一层 `$or`
  就变成静默的 TRUE。

  维护者拍板取**拒收**(不取 TRUE、不取 FALSE):这个形状几乎必然是编写期事故 ——
  筛选器记下了字段却没记下操作符,或生成的元数据把操作符弄丢了 —— 让它在编写期就炸,
  好过在某个后端上安静地多返回或少返回几行。与 #5041 已在 driver-sql 顶层建立的先例一致,
  本次只是把同一道闸门补进组合子内部。四个后端(第四个是继承 `SqlDriver` 的
  `driver-sqlite-wasm`)现在给出同一个 `INVALID_FILTER` / 400,消息里指名出事的位置
  (如 `filter.$or[0].stage`)。

  **⚠️ 可观察的行为变更 —— RLS `check` 求值路径。** `@objectstack/formula` 的
  `matchesFilterCondition` 是 `plugin-security` 对 insert/update **后像**执行行级 `check`
  的那条路径(没有查询可下推,这个求值器就是执行本身)。它改为抛出后,落在 #4775
  「求不出值 = 该次操作失败」的既定姿态上。这不只是「拒绝得更响」——有一类结果直接翻转:

  | `check` 策略                                    | 改前                                  | 改后                     |
  | ----------------------------------------------- | ------------------------------------- | ------------------------ |
  | `{ a: {} }`                                     | FALSE → 写入被拒(403)                 | 抛出 → 该次写入失败(400) |
  | `{ $or: [ { a: {} }, { owner: '{userId}' } ] }` | FALSE 被另一析取项吸收 → 写入**放行** | 抛出 → 该次写入失败      |
  | `{ $not: { a: {} } }`                           | `!false` → 写入**放行**               | 抛出 → 该次写入失败      |

  后两行是**原本能成功、现在会失败**的写入。这是拍板的目的而非副作用:一条含
  `{ field: {} }` 的权限规则,是一条作者弄丢了操作符的规则,它的含义不该取决于四个后端里
  哪一个在求值。升级后请检查 `check`/`using` 策略里是否存在零操作符的字段约束——
  错误消息会指名位置。

  同一条改动也让 `@objectstack/driver-memory` 的两个过滤面(经 mingo 的实时查询路径,
  与跨后端一致性套件所用的 `memory-matcher` 参考匹配器)第一次对这个形状给出同一个答案。

  非空形状**逐字符不变**:普通比较、`$in`、`$or`/`$and` 组合、`$not` 的 #5146 NULL-safe 改写,
  编译出的 SQL 文本与匹配结果都与改前相同;`{}`(零个键的**节点**,#5134 的布尔单位元)
  与 `{ field: {} }` 是两个不同形状,前者的语义不受本次影响。

  注:本次收紧的是**实现**。`packages/spec` 的 `FilterConditionSchema` 仍然声明这个形状合法
  (非递归半边是 `z.record(z.string(), z.unknown())`),即实现现在比已声明的契约更严;
  契约收窄与 `FILTER_LOGIC_CASES` 补条归 spec 车道另行处理。

- c7406b0: fix(objectql,driver-sql,driver-memory,driver-mongodb)!: `FilterArray` 在 engine 门下沉,四驱动的数组方言删除 (#5158 拍板 C 第 2 步)

  `FilterArray` —— `['stage','=','won']`、`['and', […], […]]`、`[[…], […]]` —— 是**仅输入**的
  授权糖。#5285 已在 spec 里把这件事写明(`data/filter.zod.ts`,`filter-array-declaration.test.ts`
  钉住「被声明」且「`where` 不接受它」)。本次是拍板 C 的第 2 步:让**运行时**与那份声明一致。

  ## 改了什么

  进入运行时的门有两扇,过去只有一扇按契约读:

  | 门                                                                                                | 改前                                                                                                                               | 改后                                                                                            |
  | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
  | **Door 1** —— 协议/HTTP 面(`metadata-protocol`)                                                   | `isFilterAST` → `parseFilterAST`,不可下沉的数组答 `400 INVALID_FILTER`                                                             | 不变                                                                                            |
  | **Door 2** —— 进程内 engine 直调(`ObjectQL.find`/`findOne`/`count`/`aggregate`/`update`/`delete`) | 数组**原样**透传给驱动                                                                                                             | 走**同一条缝**:`isFilterAST` → `parseFilterAST` 下沉为 `FilterCondition`,不可下沉的数组响亮拒收 |
  | 四驱动(`driver-sql`、继承它的 `driver-sqlite-wasm`、`driver-memory`、`driver-mongodb`)            | 各自带**第二套过滤器编译器**,包括一种**中缀**方言(`[condA, 'or', condB]`)—— 没有任何 schema 声明过它,`parseFilterAST` 也表达不了它 | 数组方言删除;数组到达驱动即 `INVALID_FILTER` / 400                                              |

  一个查询两套编译器正是 ADR-0053 D-A1 禁止的分叉,而且它已经产生了真实的产品分叉:cloud 的
  `RemoteTransport.buildWhereSQL` 自 cloud#1075 起对**同一输入**响亮拒收,`driver-sql` 却编译它。
  删掉方言后两侧自然合流。

  ## 授权面:零变化

  `FilterBuilder`(`@objectstack/client`)产出的元组与 `['and', ...]` 组、React block 的
  `filters` prop、wire 的 `$filter` 面、showcase 的授权点 —— **全部原样工作**,因为下沉正是
  这些形状本来的用途。wire 契约逐字节不变(Door 1 的行为未改)。

  ## ⚠️ 可观察的行为变更

  1. **中缀连接不再被编译。** `where: [condA, 'or', condB]` 过去只有驱动认识,现在在 engine 门被拒收。
     声明的写法是前缀组:`['or', condA, condB]` —— 语义相同,`parseFilterAST` 有它的下沉。
  2. **`findOne({ where: [] })` 现在抛错。** `[]` 的含义**没有变**(仍是「无过滤」,`find`/`count`
     照旧返回/计数全部行)。变的是 `findOne` 终于**看得见**这一点:未下沉的 `[]` 过去被
     `requireFindOnePredicate` 当作「驱动自己去解释的表达式树」放行,于是 `limit: 1` 落在整张表上,
     返回**任意一行** —— 正是 #4419 要挡的缺陷,活在 #4419 自己的守卫里面。
  3. **不可下沉的数组在 engine 门拒收,不再由驱动拒收。** 形状与操作符词表相同(`isFilterAST` 同一套),
     变的是消息来自调用点、带上调用方自己的值,以及明说「过滤器没有被应用,否则会返回**未过滤**的结果集」。
  4. **驱动直调者(不经 engine)受影响。** `SqlDriver` / `InMemoryDriver` / `translateFilter` 是公开
     导出;把数组 `where` 直接喂给它们的调用方需要改为先 `parseFilterAST(...)` 再传,或改走 ObjectQL。
     注意 `QueryAST.where` 的 `FilterCondition` 是索引签名类型,数组对它是**可赋值**的 —— 类型层从未
     挡住这个输入,所以拒收必须在运行时。
  5. **`driver-mongodb` 的 `createdAt` → `created_at` 字段别名随方言一起消失。** 它只存在于数组路径
     (`mapFieldName`,仅被已删除的 `translateComparison` 调用),对象路径从未应用过它。消费端别名按
     AGENTS.md PD #12 是债务而非模式,故不再补回:请写声明的字段名 `created_at`。

  ## 删除的代码面

  - `SqlDriver.applyFilters` 的数组遍历分支,及其比较发射器 `protected applyAstComparison`(约 220 行)
  - `InMemoryDriver.convertToMongoQuery` 的 legacy array 分支(约 62 行)
  - `driver-mongodb` `mongodb-filter.ts` 的 `translateArrayFilter` / `translateComparison` / `mapFieldName`(约 140 行)
  - `driver-sqlite-wasm` 无自有实现,随 `SqlDriver` 继承变更

  `[]` 在每一层的读法**都不变**:engine 删键、`parseFilterAST([])` 为 `undefined`、三个驱动都提前返回。

### Patch Changes

- 06ba036: feat(drivers): `@objectstack/driver-turso` 迁回本仓并公开发布，五个 driver 统一收进 `packages/drivers/` (#4645)

  `TursoDriver` 一直以 `extends SqlDriver` 的方式**跨仓库继承**本仓的类，自己却住在闭源的
  `objectstack-ai/cloud`（`publishConfig: restricted`）。而本仓的 runtime 早就把 turso 当一等
  公民——`http-dispatcher.ts` 里环境 provisioning 的偏好顺序第一位就是它，`POST /cloud/environments`
  的 `driver` 参数示例是 `memory | turso`，`objectql/src/engine.ts` 还带着一段 turso 专属的瞬时
  `fetch failed` 重试。开源侧的代码路径引用着一个自己仓里既测不到也 grep 不到的 driver，闭源侧则
  在每次 pin bump 时追赶父类的重构。维护者裁定把核心迁回本仓、公开 Apache-2.0 发布。

  **新包 `@objectstack/driver-turso`（`packages/drivers/driver-turso`，Apache-2.0，`access: public`）**
  带着它在 cloud 的全部实现与测试落地：`TursoDriver`（local / replica / remote 三种传输模式）、
  `RemoteTransport`（纯 `@libsql/client` 走 HTTP/WebSocket，无原生依赖，可跑 serverless/edge）、
  驱动的 spec/Studio 元数据，以及 15 个测试文件 538 条断言——全部 hermetic，默认 CI 下不碰网络、
  不要凭据（remote 面走包内的 sqlite stub）。

  **留在 cloud（不随迁）**：按租户路由的 `multi-tenant.ts`（云产品差异化能力）及其 schema、
  `vector-poc.test.ts`。因此本包的 barrel **不再导出** `createMultiTenantRouter` /
  `MultiTenantConfig` / `MultiTenantRouter`，也不导出多租户 schema——它们从来不是这个 driver 的
  一部分，只是曾经同包而已。

  **目录重组**：五个 `IDataDriver` 实现（`driver-memory` / `driver-mongodb` / `driver-sql` /
  `driver-sqlite-wasm` + 迁入的 `driver-turso`）现在都住在 `packages/drivers/`，
  `knowledge-*` 与 `embedder-*` 留在 `packages/plugins/`。四个存量包**内容零改动**，只有
  `repository.directory` 随目录更新——包名、入口、导出面、行为全部不变，消费者无需改动任何 import。

  这也把 turso 交给了本仓的仓库级守卫：`check:driver-conformance` 从磁盘发现 driver 包，
  迁入即入矩阵（5 drivers × 5 case-sets）。它的 temporal 两格是真绿（local 与 remote 双面套件），
  filter 组合语义与两个分页 case-set 记为 measured DEBT——remote 传输自带一套 `buildWhereSQL` 与
  `LIMIT`/`OFFSET` 拼装，是独立实现，"继承所以没问题"正是这些共享套件存在来证伪的假设。
  补齐工作跟踪在 #5590。

- 60a7a2d: fix(driver-memory): the live query path refuses the filters it cannot evaluate, and compiles the one it must (#5324, #5328)

  **This is an observable behaviour change.** Two filter shapes that used to be
  answered _silently_ now raise the catalogued `INVALID_FILTER` / 400 every other
  filter refusal in this driver and in `driver-sql` already speaks (ADR-0112):

  | filter                                                                                                                              | before                                                                                                                       | now                                                                     |
  | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | an operator outside the Filter Protocol — `{ name: { $sounds_like: 'x' } }`, `$elemMatch`, `$size`, `$where`, field-level `$not`, … | handed to mingo, which threw a `MingoError` carrying **no `code` and no `status`** — served as a 500-shaped `{ error }` body | `INVALID_FILTER` / 400, naming the operator, the field and its position |
  | a `$between` whose comparand is not `[min, max]` — `{ score: { $between: 5 } }`                                                     | the arm was skipped, the constraint **vanished**, and `find` returned `[]`                                                   | `INVALID_FILTER` / 400, wording aligned with `driver-sql`'s             |

  Two more shapes join them, same cause: an undeclared `$`-combinator in a node
  position (`{ $nor: … }`, `{ $where: … }` — `FilterConditionSchema` declares
  `$and`/`$or`/`$not` and nothing else), and a combinator operand that is not a
  filter condition (`{ $or: 'x' }`, `{ $or: [null] }`, `{ $not: 'x' }`).

  If a query of yours starts returning a 400, it was already broken — it was
  returning an empty result set or an uncoded 500 for the same input, and
  `driver-sql` was rejecting it. The message names the operator and the path
  (`filter.$or[1].$and[0].stage`).

  **`$not` is the opposite change: it now works.** `$not` is a declared combinator
  (`LOGICAL_OPERATORS`), `cel-to-filter` emits it for every CEL `!expr` in an RLS
  read scope, and `driver-sql` / `driver-mongodb` / this package's own reference
  matcher all implement it — but the live query path passed it to mingo, and
  MongoDB has no document-level `$not`, so **every query carrying a negated scope
  threw** `unknown top level operator: $not`. It is compiled to `$nor` with one
  operand, the same rewrite `driver-mongodb` performs, which is NULL-safe by
  construction and therefore lands on the answer #5146 ruled canonical.

  Both of this package's filter faces — the live mingo path and the reference
  matcher — now share ONE shape gate, so they cannot answer one filter
  differently again. They did: given a malformed `$between` the live path returned
  NO rows while the matcher returned EVERY row.

  The conformance gap that hid all of this is closed too. `FILTER_LOGIC_CASES`
  was run against this backend through the reference matcher only — the driver
  does not call it — so the table's `$not` case had been green for as long as it
  existed while the same filter through `InMemoryDriver.find` threw. The table now
  runs through the real driver, as it does for the other three backends.

  Accepted operators are the spec's `FILTER_OPERATORS`, plus `$regex` (produced by
  plugin-auth's ObjectQL adapter, compiled by `driver-sql`) and its `$options`
  companion. `$options` is a modifier, not a predicate: on its own, with no
  `$regex` beside it, it is refused like any other filter this driver cannot
  evaluate — it used to raise the same uncoded engine error on the live path and
  match every row in the matcher.

- 9c5abf4: fix(driver-sql,driver-memory,driver-mongodb): refuse out-of-contract filter input at the door instead of answering it differently per backend (#5347, #5348)

  Two shapes the Filter Protocol never declared were reaching the drivers, and
  every driver ANSWERED them — with a different answer. Both are now refused with
  `INVALID_FILTER` / 400, in the ADR-0112 envelope every sibling filter refusal
  already speaks.

  ## `$null` with a non-boolean comparand — a behaviour change you can observe

  `FieldOperatorsSchema` declares `$null: z.boolean()`. A non-boolean was read by
  default branches hung on opposite sides, so one filter meant opposite things per
  backend. Measured against one row with `stage: 'won'` (id 1) and one with
  `stage: null` (id 2), on `{ stage: { $null: 'yes' } }`:

  | backend                                     | read as                           | rows        |
  | ------------------------------------------- | --------------------------------- | ----------- |
  | driver-sql, driver-sqlite-wasm, Turso local | IS NULL (anything but `false`)    | `["2"]`     |
  | driver-memory query path, driver-mongodb    | IS NOT NULL (anything but `true`) | `["1"]`     |
  | driver-memory reference matcher             | no constraint at all              | `["1","2"]` |

  **What changes for you:** a caller that today gets rows back for
  `{ field: { $null: <non-boolean> } }` now gets a `400 INVALID_FILTER` naming the
  operator, the field and the position. That includes calls working by truthy /
  falsy coincidence — and the sharpest case is the STRING `"false"`, which is
  truthy: it compiled to IS NULL on SQL and IS NOT NULL on the JS backends, i.e.
  the opposite of what its author wrote it to mean, on at least one of them
  whichever they meant. A JSON round-trip or generated metadata produces it
  readily.

  **The fix:** write the boolean. `{ field: { $null: true } }` for "has no value",
  `{ field: { $null: false } }` for "has a value". Both are unchanged, on all four
  backends, and so is every other operator. `$exists` is deliberately NOT tightened
  here — it diverges on its own axis (what "exists" means for a null-valued key)
  and is tracked separately.

  ## An undeclared `$op` in a document position — silent empty set becomes a 400

  `FilterConditionSchema` declares exactly three `$`-keys at a node
  (`$and` / `$or` / `$not`); every other key is a field name. `driver-sql`
  compiled the rest as COLUMNS, so `{ $where: '…' }`, `{ $nor: […] }`,
  `{ $expr: … }` produced a predicate that matched nothing and reported nothing —
  a caller could not tell "no rows matched" from "the filter never compiled". The
  FIELD position had refused the same class of input since v16, so one driver gave
  two answers depending on depth.

  **What changes for you:** those filters now raise `400 INVALID_FILTER` instead of
  returning `[]`. `driver-memory` already refused them; this brings `driver-sql`
  (and `driver-sqlite-wasm`, which inherits it) into line. The three declared
  combinators, their boolean identities (`$and: []` is TRUE, `$or: []` is FALSE)
  and every legal filter compile byte-identically.

  Both refusals are raised on the driver's validating walk rather than in its SQL
  emitter, so a malformed node is refused regardless of whether a sibling
  disjunct would have short-circuited the compile.

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

- c6d1cb4: refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

  `findStream` was a **required** method on the driver contract — every driver and
  every test double had to implement it — documented as the read

  > Optimized for large datasets to avoid memory overflow.

  Three things were true about it at once, and each is worse in the light of the
  others.

  **Nothing called it.** Not the query engine (there is no `stream` entry on it),
  not REST export, not import, not any bulk-read path. Repo-wide, outside the
  contract declaration and the three driver implementations, every single hit was
  a test double — and roughly twenty of those satisfied the required method like
  this:

  ```ts
  findStream() { throw new Error('not implemented'); }
  ```

  Twenty stubs that throw, across four packages, for years, and no test ever went
  red. That is not an anecdote about test hygiene; it is the proof of absence. A
  method whose every double throws is a method nothing reaches.

  **Two of the three implementations inverted its one guarantee.** `SqlDriver` and
  `InMemoryDriver` both did this:

  ```ts
  const results = await this.find(object, query, options); // ← the entire result set
  for (const row of results) yield row;
  ```

  The whole table is resident in memory before the first `yield`. A caller who
  believed the doc comment and reached for `findStream` precisely because a result
  set was too large would have hit the overflow it existed to prevent, at exactly
  the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
  admitting it.

  **The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
  did walk a cursor — but it was the only read in that driver never routed through
  `buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
  discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
  and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
  that divergence rather than fixing it — there is nothing left to fix it for.)

  Rather than manufacture a caller to justify three implementations, the method is
  retired. If a cursor-based read is wanted, it should arrive **with** the caller
  that needs it, so the contract can be shaped by a real requirement instead of
  being reverse-engineered from a doc comment nobody could test.

  **Migration.**

  | Wrote                                                      | Write instead                                              |
  | ---------------------------------------------------------- | ---------------------------------------------------------- |
  | `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
  | `findStream(…) { … }` on your own driver                   | delete the method (see below)                              |
  | `findStream() { throw new Error('ni'); }` in a test double | delete the line                                            |

  Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
  and memory it is strictly better (bounded pages instead of one full
  materialisation), and the paged read is the one with an **enforced** guarantee —
  `IDataDriver.find` requires a total order across the whole walk, checked by the
  shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
  `data/pagination-conformance.ts`. `findStream` never had a conformance case at
  all.

  **Driver authors: nothing breaks on you.** An implementation left in place still
  compiles — an extra method is not an error on a class or a widened object — it is
  simply never reached, so deleting it is cleanup you can do whenever. The break is
  on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
  were no callers.

  **No tombstone, deliberately.** The other v17 retirements tombstone their key so
  authoring it fails loudly with a prescription. That would be noise here.
  `DriverInterfaceSchema` describes a contract that code _implements_; nothing in
  either repository ever ran a driver object through `.parse()`, so a
  `retiredKey()` there would carry its prescription to no one. The channel that can
  carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
  The key is removed from the schema and from `IDataDriver`, and the retirement is
  registered as the `data-driver-find-stream-retired` semantic entry in the
  protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
  upgrade guide and the `spec_changes` MCP tool all carry it. There is no
  `os migrate meta` step: a driver is code, never stack metadata, so the chain has
  no source to rewrite.

  **Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
  whose only referent was this method. It has no readers either (and the values
  written into it were already wrong — `SqlDriver` declared `streaming: false`
  while implementing `findStream`, `InMemoryDriver` declared `true` for the
  copy-everything version), but removing a key from the capabilities literal breaks
  every driver that writes it, third-party included, and the same audit should
  cover the other ~30 flags in one pass rather than one at a time. Tracked as
  #4634.

- d9fa683: refactor(spec)!: retire the 31 inert `DriverCapabilities` bits — declared by every driver, read by nothing (#4634, ADR-0049)

  The #4484 findStream close-out left one loose end: `DriverCapabilities.streaming`
  described a contract method that no longer exists — and a full liveness audit of
  the record (#4634, across objectstack + cloud, objectui confirmed clean) found
  `streaming` was not the exception but the rule. Of 34 declared bits, **three**
  have a decision-making reader and **thirty-one** were written by every driver
  and consulted by no engine, planner, REST layer or renderer:

  - Their `.describe()` strings promised engine adaptation that was never built
    ("If false, ObjectQL will fetch all records and filter in memory" — no such
    fallback ever keyed off the bit).
  - Zero readers let values go WRONG unnoticed: `SqlDriver` declared
    `streaming: false` while implementing `findStream`; `InMemoryDriver` declared
    `streaming: true` over a full-table read — the exact inverse of the guarantee.
  - The real mechanism everywhere else is **method presence**: transactions gate
    on `driver.beginTransaction`, aggregate pushdown on
    `typeof driver.aggregate === 'function'`, schema sync on
    `typeof driver.syncSchema === 'function'`, and the REQUIRED CRUD/bulk methods
    are called unconditionally.

  Survivors (each with a named reader — the bits method presence cannot carry):

  | bit                    | reader                                                                                   |
  | ---------------------- | ---------------------------------------------------------------------------------------- |
  | `queryDateGranularity` | engine aggregate dispatch (`engine.ts`), `checkDateBucketParity` (`@objectstack/verify`) |
  | `autonumber`           | engine defers autonumber generation to the driver (`engine.ts`)                          |
  | `batchSchemaSync`      | engine ANDs it with `syncSchemasBatch` presence (`engine.ts` / `plugin.ts`)              |

  Migration (FROM → TO):

  - Any of the 31 bits (`create`/`read`/`update`/`delete`, `bulkCreate`/
    `bulkUpdate`/`bulkDelete`, `transactions`/`savepoints`/`isolationLevels`,
    `queryFilters`/`queryAggregations`/`querySorting`/`queryPagination`/
    `queryWindowFunctions`/`querySubqueries`/`queryCTE`/`joins`,
    `fullTextSearch`/`jsonQuery`/`geospatialQuery`/`streaming`/`jsonFields`/
    `arrayFields`/`vectorSearch`, `schemaSync`/`migrations`/`indexes`,
    `connectionPooling`/`preparedStatements`/`queryCache`) in a `supports`
    literal or a `DriverConfig.capabilities` object → **delete the key**. Each is
    tombstoned (`retiredKey()`), not silently stripped: authoring one is a `tsc`
    error against `IDataDriver.supports` and a parse error carrying the per-key
    prescription, which names the mechanism that actually decides the behaviour.
  - `batchSchemaSync` dropped its `.default(false)` for `.optional()` — absence
    already meant `false` at both readers, so `supports: {}` is now a valid,
    minimal advertisement. If you read `capabilities.batchSchemaSync` from a
    _parsed_ config and relied on the materialised `false`, treat absence as
    `false` (both engine readers always did).
  - Driver packages: `InMemoryDriver.supports` is now `{}`,
    `MongoDBDriver.supports` is `{ batchSchemaSync: true }`, `SqlDriver.supports`
    is `{ queryDateGranularity, autonumber: true, batchSchemaSync: false }`.
    Reading a removed bit off these literals no longer type-checks — and no code
    in any repository did.
  - A future capability (streaming reads, vector search, …) returns **with its
    caller and its reader in the same change** — the enforce route of ADR-0049 —
    never as a dangling boolean.

  The retirement kit: 31 `retiredKey()` tombstones on the non-strict schema
  (parse + `tsc` both audible; the schema IS parsed via
  `DriverConfigSchema.capabilities` and its SQL/NoSQL extensions); ADR-0087 D3
  semantic migration `driver-capabilities-inert-bits-removed` (a driver is CODE,
  never stack metadata — `supports` lives in driver classes and `DriverConfig`
  is plugin TS configuration, so there is no stored row or stack source for a D2
  conversion to rewrite; the stack-tree neighbour `datasource.capabilities` was
  retired separately in #4583); baselines (`authorable-surface.json` [RETIRED]
  lines, `json-schema.manifest.json`) regenerated deliberately; compiler-API pin
  asserting every retired bit is unwritable (`undefined`) and every live bit is
  not, sabotage-verified both ways (S1 schema resurrection, S2 driver literal
  resurrection).

  No runtime behaviour changes — that impossibility is the point: every removed
  bit had zero readers, and the three live bits keep theirs.

### Minor Changes

- ea90179: fix(data,runtime,drivers): four ADR-0112 envelope defects found in the v17 verification sweep (#4431, #4435, #4436, #4483)

  Four independent surfaces where the answer a caller received contradicted the
  contract the surface declares. All four were found driving a real showcase boot
  against `17.0.0-rc.1` and are catalogued in the #4482 rollup.

  - **#4431 — a sandbox capability denial answered 400.** A denial is the sandbox
    refusing to run untrusted code that asked for a capability it does not hold,
    which is the crash contract's case (#3951), not a deliberate rejection of a
    malformed request. It now answers 500, and the `SandboxError:` debug prefix
    no longer reaches the client.

  - **#4435 — PATCH/DELETE of a nonexistent record answered 200 success.** The
    write path returned `record: null` / `success: true` for an id that resolves
    to nothing, while GET on the same id correctly 404s; `deleteMany` reported
    every typo'd id as deleted. Both now answer `RECORD_NOT_FOUND`, so a caller
    can no longer read a successful envelope as proof the write landed.

  - **#4436 — the unsupported-filter-operator refusal shipped without
    `error.code`.** A refusal with no code is unmatchable by a client, and the
    message leaked the internal `[sql-driver]` prefix. It now speaks
    `INVALID_FILTER` without the driver prefix.

  - **#4483 — the `$search` auto field set admitted its lead field
    unconditionally.** `nameField`/`name`/`title` were prepended without passing
    `SEARCH_AUTO_EXCLUDED_FIELDS`, so a search could be aimed at the primary key.
    The lead field now only ORDERS the set it is already a member of; it can no
    longer admit one.

  These change responses that were observably wrong, so callers coded against the
  buggy shapes — a 200 on a missing record, a 400 on a capability denial — will
  see different status codes. Graded `minor` on that basis rather than `patch`.

### Patch Changes

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

### Major Changes

- 7309c81: fix(driver-memory,spec): persistence is opt-in again — `new InMemoryDriver()` is pure in-memory (#4065)

  `InMemoryDriverConfig.persistence` defaulted to `'auto'`, and in Node.js `'auto'`
  means **file**. So a bare `new InMemoryDriver()` — the shape every caller in this
  repo used — silently wrote `.objectstack/data/memory-driver.json` into the process
  CWD and reloaded it on the next boot. The default is now `false`.

  **This restores the accepted design rather than replacing it.** #815, the issue
  that introduced the persistence capability, specified it as opt-in in requirement
  \#1 — "默认情况下不启用持久化（纯内存，行为不变）" — and listed
  `new InMemoryDriver()` under "纯内存" in its own config examples. The `'auto'`
  default was a drift from that spec.

  What let the drift survive is worth naming, because it is not "there was no
  test". `MemoryConfigSchema` _did_ pin the default, and asserted `'auto'`; the
  driver honoured `'auto'`; so spec and implementation agreed, and the pair looked
  verified. What nothing checked was whether the value they agreed on was the one
  #815 accepted. The driver's own `persistence.test.ts` could not have caught it
  either — every case there passes `persistence` explicitly, so the omitted-value
  path was untested on the implementation side. Both sides are now covered: three
  behavioural tests in `persistence.test.ts` (no CWD write, no cross-instance row
  carry-over, opt-in still persists) and the flipped schema assertion.

  **The symptom this fixes.** `packages/runtime/src/datasource-autoconnect.test.ts`
  seeds two rows with fixed ids and asserts the exact set. Run 1 passed and wrote
  the rows to disk; run 2 loaded them back, appended two more, and failed with four
  rows; run N had 2N. CI never saw it — every job is a fresh clone, so every CI run
  is run 1 — but `pnpm test` twice in one working tree could only ever go green
  once. The persisted file's `created_at` values, one pair per run, were the proof.

  (#4083 fixed that particular suite from the factory side, and its regression
  test is kept as-is. The blast radius was wider than one suite, though: **every**
  bare `new InMemoryDriver()` inherited the default, so any code path constructing
  one directly wrote to its working directory. Unit tests should not have write
  side effects on the CWD at all.)

  **Migrating.** Callers that want durability now ask for it:

  ```ts
  new InMemoryDriver(); // pure in-memory (new default)
  new InMemoryDriver({ persistence: "file" }); // Node.js, durable across restarts
  new InMemoryDriver({ persistence: "local" }); // browser, durable across reloads
  new InMemoryDriver({ persistence: "auto" }); // previous default behaviour
  ```

  The `'auto'` / `'file'` / `'local'` / custom-adapter paths are unchanged; only
  the value used when `persistence` is omitted moved.

  **Relationship to #4083.** That issue fixed the same hazard one consumer at a
  time, and landed first: `createDefaultDatasourceDriverFactory` now passes
  `persistence: false` for a declared `{ driver: 'memory' }` datasource and scopes
  an opted-in destination _per datasource_, and the dev sqlite step-down's
  last-resort rung passes `false` too. Both are kept exactly as #4083 wrote them.
  This change closes the half they deliberately left open — a directly-constructed
  `new InMemoryDriver()` — which is the path that still wrote into the working
  directory of whatever process happened to build one.

  The two are complementary, not redundant. #4083's per-datasource scoping is
  still the only thing that expands `'auto'`/`'file'`/`'local'` into a destination
  carrying the datasource name, so two pools that DO opt in never alias one file;
  its explicit `false` becomes belt-and-braces, which is the right posture for a
  path that must never persist.

  `DevPlugin`'s driver is now explicitly `persistence: false`, matching the cache,
  queue, job, i18n, storage and search stubs it ships beside — it was the one piece
  of that stack that quietly outlived the process.

  **One claim trimmed, no behaviour attached.** The class docstring called this a
  "production-ready implementation of the ObjectStack Driver Protocol". It stores
  no constraints at all — `create()` is a `table.push()` and `syncSchema()` only
  allocates an array — so there is no primary key, uniqueness, `NOT NULL`, foreign
  key or column typing, and `bulkCreate` lands duplicate ids where a SQL driver
  raises a violation (the second finding in #4065). The docstring now says so, and
  points test authors at in-memory SQLite. Per Prime Directive #10 the fix for
  `declared ≠ enforced` is to implement it, trim the claim, or file it; with this
  driver moving to maintenance-only the claim is what goes.

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- 6f98c2d: fix(driver-sql,driver-memory): an uncompilable filter now throws instead of matching everything (#3948)

  A filter the driver could not compile was **skipped**, not rejected. No predicate
  was emitted and the query returned every row — the caller asked to filter and
  silently received the unfiltered set.

  The reachable shape is a bare comparison triple. `['close_date','before','2024-01-01']`
  arrives at a driver only when `isFilterAST()` refused it — its operator is outside
  `VALID_AST_OPERATORS`, so `parseFilterAST()` never converted it and the raw array
  was assigned to `where`. `driver-sql`'s loop then saw three _strings_, matched
  neither `and` nor `or`, and `continue`d past all three. `driver-memory` was worse:
  it cast every string to a logic keyword, opening three empty groups and returning
  `{}` — a filter matching every record.

  This is reachable from ordinary authoring, not just malformed input: `before` and
  `after` are canonical `VIEW_FILTER_OPERATORS` members that `VALID_AST_OPERATORS`
  does not accept. Eight of the nineteen canonical view operators are in that
  position, including `equals`; the others were masked only because ObjectUI's
  adapter alias table happened to cover them.

  **Behaviour change.** Both drivers now throw on a filter element that is neither a
  logical keyword (`and`/`or`) nor a condition array, and `driver-memory` throws on
  an operator it cannot express rather than dropping the condition. The nested and
  `$`-object paths already threw on the same input, so this makes the three paths
  agree. A caller that was relying on the old silence was receiving wrong results;
  the error names the operator and the offending filter.

  **`driver-memory` also gains seven operators it silently ignored:** `not_in`,
  `is_null`, `is_not_null`, `isnull`, `isnotnull`, `is_empty`, `is_not_empty` — all
  members of `VALID_AST_OPERATORS`, all previously falling through to
  `default: return null`. `is_null` narrowed nothing instead of matching null rows.
  Alias sets and semantics mirror `driver-sql`'s `whereNull`/`whereNotNull` arms so
  the two backends accept one vocabulary.

  Migration: none for well-formed filters. If a query now throws, the filter was
  never being applied — fix the operator (the message names it), or lower it to an
  AST spelling. `before` → `<`, `after` → `>`, `'not in'` → `nin`.

### Patch Changes

- b3a2318: fix(driver-memory,driver-mongodb): a bare-day upper bound covers the whole day (#4042)

  The non-SQL half of #3777's calendar-day rule. Both drivers compiled a bare
  `YYYY-MM-DD` `$lte` (and a `between` max) as-is, so on timestamp values the
  window cut off at the final day's midnight — the dashboard date-range filter's
  default configuration (`created_at`, 7 of 13 presets ending "today") lost the
  current day, exactly as it did on SQL before #3777 was fixed.

  Both drivers now compile a bare-day upper bound half-open, sharing
  `nextUtcCalendarDay` from `@objectstack/core`:

  - `driver-memory`: the Mongo-style and array `where` spellings in the mingo
    lowering (`$lte`/`<=` → `$lt` next day; `$between`/`between` max the same),
    the analytics cube-filter `lte`, and the analytics `dateRange` window — which
    now also matches BOTH stored forms of a timestamp (ISO strings and `Date`
    objects) instead of only `Date`s, since mingo compares cross-type as
    never-equal.
  - `driver-mongodb`: the `translateFilter` lowering, all three spellings
    (`$lte`, `$between`, array `<=`/`lte`).

  Unchanged on purpose, matching the #3777 semantics table: full-ISO/`Date`
  comparands keep instant semantics, and `$gte`/`$gt`/`$lt` keep their midnight
  anchoring. Known remaining gap (tracked separately): values stored as BSON
  `Date` (mongodb) or JS `Date` (memory `find()`) never match _string_ comparands
  of any operator — a storage-form problem, not a bound-semantics one.

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

- 9e8f04d: fix(driver-memory,driver-mongodb): `Field.datetime` has one storage form per driver (#4047)

  The non-SQL counterpart of ADR-0053 D-B (#3912). Both drivers let the writer
  decide a datetime value's runtime type, and both compare across types by type
  bracket rather than by value — so a string comparand never matched a `Date`
  value, in either direction, for **every** operator including `$gte`.

  A datetime column genuinely held both forms: the drivers' own
  `created_at`/`updated_at` defaults bind a `Date` (mongo) or an ISO string
  (memory), while REST/JSON writes, relative-date tokens and `initialData`
  fixtures supply the other. A dashboard date window therefore answered with
  whichever half happened to match the comparand's type — on MongoDB, where
  `created_at` is a BSON `Date` and dashboard bounds are strings, that meant
  **no rows at all**, which is worse than the final-day loss #3777 fixed.

  Each driver now has one canonical form, applied on write and to every filter
  comparand:

  | Driver           | `datetime`                                                                                                           | `date`            |
  | ---------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
  | `driver-mongodb` | BSON `Date` — the dialect's native instant, its `timestamptz`                                                        | `YYYY-MM-DD` text |
  | `driver-memory`  | canonical UTC ISO text (sorts chronologically under the string comparison mingo performs; survives JSON persistence) | `YYYY-MM-DD` text |

  Both learn their temporal fields from `syncSchema`, so an object that was never
  declared is left exactly as written — the drivers do not guess types from
  values. `driver-memory` additionally converges rows already in the table when
  the schema arrives, which catches `initialData` fixtures and anything a
  persistence adapter restored (the in-memory analogue of
  `backfillCanonicalDatetimes`, and idempotent like it).

  `Field.date` deliberately stays timezone-naive text on both — converting it to
  an instant would invent a midnight and re-couple it to a zone. The
  calendar-day bound semantics from #3777/#4042 are unchanged and now compose
  with the converged storage: the whole-day rewrite runs on the calendar string
  first, and only the resulting bound is converted to the storage form.

- 4384921: fix(spec,drivers): `bypassTenantAudit` becomes a declared driver option, and `findOne` stops accepting a bare id (#4311)

  Three drivers built with `tsup` and tested with `vitest`, so no `tsc` had ever
  read them. Onboarding them to the #4311 type-check ratchet surfaced 292 errors,
  and most of what looked like sloppy test fixtures was the types being wrong.

  **`DriverOptions.bypassTenantAudit` is now declared.** It has been live for a
  long time without being on the schema: `SqlDriver.auditMissingTenant` reads it
  to suppress the "tenant-scoped write without `tenantId`" warning, the driver's
  own warning text tells callers to set it, `ObjectQLEngine` sets it for
  system-context calls, and `service-settings` / `service-datasource` pass it on
  every global-scope write. Because the schema never had it, the driver read it
  through `(options as any)` and no caller was type-checked. The declaration
  states the limit as well: it silences a diagnostic and MUST NOT change which
  rows a write touches — suppressing an audit warning is not a permission.

  The same cast covered `timezone`, `tenantId`, `tenantIds` and `preserveAudit`,
  all long since declared. Those reads now go through `DriverOptions`, so the next
  undeclared option fails the build instead of hiding behind an existing cast.

  **`SqlDriver.findOne(object, id)` is removed.** An undeclared
  `typeof query === 'string' | 'number'` branch accepted a bare id. It was on no
  contract, nothing outside that package's own tests used it, and the other two
  drivers answered the identical call differently — `MemoryDriver` spreads the
  string into `{0:'t',1:'1'}`, `MongoDBDriver` reads `query.where` as `undefined`
  and returns an arbitrary row. It also bypassed the shared `findRows()` path, so
  it skipped field selection, temporal coercion, unknown-column recovery and the
  `singleRowLookup` ORDER BY decision. Spell an id lookup as the query it is:

  ```ts
  -(await driver.findOne("task", "t1"));
  +(await driver.findOne("task", { object: "task", where: { id: "t1" } }));
  ```

  **`SqlDriver.initObjects` declares the `tenancy` it consumes.** Each object is
  fed to `computeAndRecordTenantField`, which reads `obj.tenancy` to pick the
  tenant column and to set or clear the sticky explicit-opt-out — but the
  parameter type listed only `{ name, fields }`, so a caller that spelled the key
  correctly was rejected while the driver read it anyway.
  `registerExternalObject` already had it.

  **`AnalyticsQueryInput` joins `AnalyticsQuery`.** `timezone` is
  `.default('UTC')`, so the parsed type requires it and an authored literal does
  not have it — the same two-tier split `QueryInput`/`QueryAST` already names on
  the query side. `InMemoryDriver.create`/`bulkCreate` also declare their
  `IDataDriver` return types; without them TS inferred the literal the method
  builds and every other column of the created row disappeared from the caller's
  view.

  One silent runtime bug fell out of the same pass: a driver test asked for
  `orderBy: [['id', 'asc']]`, the driver reads `item.field`, a tuple has none, and
  the sort never reached SQL. The tuple spelling appears nowhere else.

- 8675db6: refactor(data)!: a select-list entry is a field name — the nested-select object form is removed (#4196)

  `FieldNode` declared two forms for one entry of `QueryAST['fields']`:

  ```ts
  type FieldNode =
    | string // "name"
    | { field: string; fields?: FieldNode[]; alias?: string }; // nested select
  ```

  The object form was **declared-but-inert**. Nothing produced it, and nothing
  read `.fields` or `.alias` — every consumer on the path treats the list as
  `string[]`: `objectql`'s formula projection and its two known-field filters,
  `driver-sql`'s `select()`, `driver-memory`'s `projectFields`. `driver-mongodb`
  keyed its projection with the entry itself, so an object entry asked for a
  column literally named `"[object Object]"`, and the REST ingress stringified
  each entry before comparing it to the field map, so the same entry came back as
  `400 INVALID_FIELD: Unknown field '[object Object]'` — a rejection naming
  something the caller never wrote. An author who wrote
  `fields: [{ field: 'owner', fields: ['name'] }]` got it accepted by validation
  and then dropped or mangled, depending on the driver (ADR-0078 silently-inert
  declaration; ADR-0049 enforce-or-remove).

  The capability the object form described is already served, by a different key.
  Removing the second spelling rather than lowering it into the first is Prime
  Directive #12: one capability, one contract.

  **FROM → TO**

  | Was                                                               | Now                                                              |
  | :---------------------------------------------------------------- | :--------------------------------------------------------------- |
  | `fields: [{ field: 'owner', fields: ['name'] }]`                  | `expand: { owner: { object: 'user', fields: ['name'] } }`        |
  | `fields: [{ field: 'owner' }]`                                    | `fields: ['owner']`                                              |
  | `fields: [{ field: 'owner', fields: ['name'] }]`, one column only | `fields: ['owner.name']` (dotted path)                           |
  | `fields: [{ field: 'total', alias: 't' }]`                        | `aggregations` / `windowFunctions` — they carry the live `alias` |

  The one-line fix: **a `fields[]` entry is a string.** Move nested selection to
  `expand`, which the engine resolves through batch `$in` queries (default max
  depth 3).

  There is no `os migrate meta` step, and deliberately so: `QueryAST` is a request
  shape, never stored in stack metadata, so the chain has no source to rewrite. It
  is registered as an ADR-0087 D3 **semantic** migration
  (`query-field-node-object-form-retired`) on the protocol-17 step instead — the
  `EnhancedApiError.fieldErrors` / `BatchOptions.validateOnly` precedent. Callers
  move their own select lists, and both channels tell them how:

  - **The parse.** `FieldNodeSchema` narrows to `z.string()` with an error map that
    answers an object entry with the prescription above, not "expected string,
    received object". `z.input` becomes `string`, so `tsc` fails at the authoring
    site first.
  - **The ingress.** `assertProjectionFieldsExist` judges the entry's _shape_
    before consulting the object's field map — it is wrong about the shape, not
    about this object, and a registry-less host would otherwise pass it to a driver
    that cannot read it. The 400 now names the retired form instead of the field
    `"[object Object]"`.

  No runtime behaviour changes for anything that ever worked; the defensive
  unwrapping the drivers had grown against a shape nothing sends goes with it.

- 6038de7: feat(spec,drivers): the temporal conformance matrix gains its `Field.time` axis — and `time` finally gets a storage form off SQL (ADR-0053 D-A3.2)

  `@objectstack/spec/data` gains `TEMPORAL_TIME_ROWS` / `TEMPORAL_TIME_CASES`,
  the wall-clock half of the shared matrix. A time gets its own table rather than
  a third `kind` on the existing one because it shares no comparand vocabulary
  with the other two: no relative token resolves to a wall clock, and the
  bare-day whole-day rule (#3777) must **not** reach it — which the table now
  asserts rather than assumes, since "the rule leaked into the wrong field type"
  is exactly what a conformance matrix is for. The fixture is a business day
  carrying the boundaries #3994 measured: both window edges, the pair straddling
  the millisecond-suffix width change, midnight and `23:59:59.999`.

  **The axis found a real gap on its first run.** ADR-0053 D-C gave `Field.time`
  a canonical form on every SQL dialect, but `driver-memory` and
  `driver-mongodb` were never extended — both declared
  `TemporalFieldKind = 'datetime' | 'date'`, so a `time` column was never
  classified and never coerced. It therefore held whatever each writer produced,
  and both stores compare across types by bracket: a text bound matched no
  `Date`-written row, in either direction, for every operator. Measured on
  `driver-memory`, **8 of the 9 shared cases** returned only the text-written
  half — a business-hours window answering `[d_mid, f_close]` instead of
  `[c_open, d_mid, e_mid_ms, f_close]`. This is #4047's failure one field type
  over, and it survived #4047 because that work extended `datetime` and `date`
  without revisiting `time`. On mongo it was also a documentation failure: that
  module's canon table has listed `time` as `HH:MM:SS[.fff]` text since #3994,
  and nothing implemented it.

  Both drivers now carry `storageTimeValue`, mirroring the SQL
  `canonicalTimeOfDay`: `HH:MM:SS`, `.fff` only when the milliseconds are
  non-zero, a `Date` / epoch / full-timestamp folding to its **UTC** time-of-day
  (never the host's), and totality — an out-of-range wall clock like `'25:00'`
  passes through rather than being silently rewritten. Text on both, mongo
  included: a wall clock is not an instant, so a BSON `Date` would invent a
  calendar day and a zone the author never wrote.

  If you have existing `time` data on either driver, values written as `Date`
  objects converge to canonical text on their next write; reads of un-migrated
  documents are unchanged. Filters were already unable to reach the mixed half,
  so no query that worked before stops working.

- 0166bd5: fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

  `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
  `ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
  `isFilterAST()`, which decides whether a filter is parsed into a query at all.
  They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
  `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

  An author could declare any of them, `ViewFilterRuleSchema` validated them,
  `defineStack` accepted them — and then `isFilterAST()` refused the filter, the
  protocol passed the array through unconverted, and the driver could not apply it.
  Six of the eight were reachable only in theory because ObjectUI's adapter alias
  table happened to translate them; the safety of the query path was resting on a
  hand-written table in another repository being complete, and for `before`/`after`
  it wasn't.

  **`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
  is derived from its keys rather than restated, so an operator can no longer be
  accepted by the gate without also having a lowering — the two were separate
  hand-written lists that happened to agree, with nothing enforcing it. The map
  gained the eight canonical view spellings plus the squashed/short forms stored
  metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

  **New export `canonicalAstOperator(op)`** folds every accepted spelling of one
  comparison onto a single infix form. Both drivers now call it instead of growing
  private alias lists, which is what let them accept different vocabularies.
  `like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
  to SQL verbatim, so folding would silently wrap the value in `%…%`.

  Widening only — no spelling was removed, so no stored filter stops validating.
  A filter that previously produced an error (after #4029) or was silently dropped
  (before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
  `VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
  lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
  next operator the view layer gains fails a test instead of a query.

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

### Patch Changes

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

- 69ae136: docs: align hardening / driver docs with the Hono-only adapter surface (12.0)

  Follow-up to the adapter trim (#2391): the hardening guide's rate-limit/CORS
  recipes are rewritten from Fastify to **Hono** (the shipped adapter; the old
  `@objectstack/fastify` import was broken), CSRF guidance points at `hono/csrf`,
  and stale `@objectstack/plugin-msw` references are dropped from the driver-memory
  and driver-turso docs. README framework lists narrowed to Hono.

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

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

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

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

- 5f659e9: fix ai
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

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- 46defbb: Fix filter operators (contains, notContains, startsWith, endsWith, between, null) broken across spec and memory driver

  - Add `$notContains` to `StringOperatorSchema`, `FieldOperatorsSchema`, `FILTER_OPERATORS`, and `Filter` type
  - Add `notcontains` / `not_contains` to `VALID_AST_OPERATORS` and `AST_OPERATOR_MAP`
  - Fix memory driver `convertToMongoQuery()` passthrough to normalize non-standard operators to Mingo-compatible format
  - Add `$notContains` and `$null` operators to memory matcher
  - Fix undefined value guard in memory matcher to exclude `$exists`, `$ne`, and `$null`

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.0.12

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- @objectstack/spec@1.0.9
- @objectstack/core@1.0.9

## 1.0.8

### Patch Changes

- @objectstack/spec@1.0.8
- @objectstack/core@1.0.8

## 1.0.7

### Patch Changes

- @objectstack/spec@1.0.7
- @objectstack/core@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6

## 1.0.5

### Patch Changes

- b1d24bd: refactor: migrate build system from tsc to tsup for faster builds
  - Replaced `tsc` with `tsup` (using esbuild) across all packages
  - Added shared `tsup.config.ts` in workspace root
  - Added `tsup` as workspace dev dependency
  - significantly improved build performance
- Updated dependencies [b1d24bd]
  - @objectstack/core@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- @objectstack/spec@1.0.4
- @objectstack/core@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
  - @objectstack/core@1.0.3
  - @objectstack/spec@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2

## 1.0.1

### Patch Changes

- @objectstack/spec@1.0.1
- @objectstack/core@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2

## 0.8.1

### Patch Changes

- @objectstack/spec@0.8.1
- @objectstack/core@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1
  - @objectstack/core@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1
  - @objectstack/core@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0
  - @objectstack/core@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.4.1

### Patch Changes

- Version synchronization and dependency updates

  - Synchronized plugin-msw version to 0.4.1
  - Updated runtime peer dependency versions to ^0.4.1
  - Fixed internal dependency version mismatches

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.4.0

### Minor Changes

- Release version 0.4.0

## 0.3.3

### Patch Changes

- Workflow and configuration improvements

  - Enhanced GitHub workflows for CI, release, and PR automation
  - Added comprehensive prompt templates for different protocol areas
  - Improved project documentation and automation guides
  - Updated changeset configuration
  - Added cursor rules for better development experience

- Updated dependencies
  - @objectstack/spec@0.3.3

## 0.3.2

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 0.3.1

### Patch Changes

- @objectstack/spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.2.0

### Minor Changes

- Initial release of ObjectStack Protocol & Specification packages

  This is the first public release of the ObjectStack ecosystem, providing:

  - Core protocol definitions and TypeScript types
  - ObjectQL query language and runtime
  - Memory driver for in-memory data storage
  - Client library for interacting with ObjectStack
  - Hono server plugin for REST API endpoints
  - Complete JSON schema generation for all specifications

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 0.1.1

### Patch Changes

- Remove debug logs from registry and protocol modules
- Updated dependencies
  - @objectstack/spec@0.1.2
