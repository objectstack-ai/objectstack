# @objectstack/driver-sqlite-wasm

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
  - @objectstack/driver-sql@17.0.0-rc.5

## 17.0.0-rc.4

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
- Updated dependencies [06ba036]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [0f17114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [c7406b0]
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
- Updated dependencies [4addd9d]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [2ddba89]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [9c5abf4]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [f98fa65]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [193cd5c]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [acf34e3]
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
  - @objectstack/driver-sql@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- 9b43ee2: test(drivers): the filter-logic standard now covers the backend it was counted without (#4405)

  `FILTER_LOGIC_CASES` (#3774) opens by calling itself the standard "the four
  independent FilterCondition backends are each checked against". Five backends
  exist. `driver-mongodb`'s `translateFilter` was missed, not excluded — an
  independent implementation whose `$and`/`$or`/`$not` translation shares no line
  of code with the SQL compiler or the in-memory matcher, and the only one whose
  target language cannot spell the standard directly: MongoDB has no
  document-level `$not` at all (the server answers `unknown top level operator:
$not`), so a negation has to leave as `$nor`, and a branch's own keys have to
  stay in one document while `$and`/`$or` clauses are lifted beside them. That
  route was never checked against the shared cases. Both DEBT rows the #4363 gate
  recorded are now cleared, and `scripts/check-driver-conformance.mjs` reports
  `ok` for every cell of the matrix.

  **`driver-mongodb` runs the table twice, and the split is deliberate.**
  `mongodb-filter-logic-translation.test.ts` drives every shared case through
  `translateFilter` and evaluates the emitted MongoDB _document_ over the shared
  fixture — a pure function, no server, so it always runs. That matters here more
  than anywhere: `mongodb-memory-server` downloads a ~123 MB binary from
  fastdl.mongodb.org, and a defect only a downloadable binary can catch is a
  defect nobody catches on a restricted network. Its in-process reader is strict
  by construction — every shape it does not model throws instead of evaluating to
  true, a document-level `$not` included — and its own discrimination is pinned by
  cases that require a widened document to FAIL the case it widens, so "all green"
  cannot mean "the reader says yes to everything".
  `mongodb-filter-logic-conformance.test.ts` runs the same table against a real
  mongod and answers the one question the first half cannot — does MongoDB agree?
  — skipping cleanly (never silently) when the binary is unreachable.

  **`driver-sqlite-wasm` runs the table through its own engine.** It inherits
  `SqlDriver`'s filter compiler, so nothing is re-implemented; what the suite pins
  is that a nested `(… AND …) OR (… AND …)` survives the custom sql.js dialect
  that compiles, binds and marshals it — the same seam its temporal and pagination
  suites cover for their clauses. Tracked as DEBT rather than EXEMPT because
  "inherits, therefore fine" is the assumption those suites exist to disprove; the
  suite is what disproves it.

  **No divergence was found.** `translateFilter` answers all seventeen shared
  cases correctly today, `$not`-inside-a-branch and nested `$and`-inside-`$or`
  included, so no translation change ships here — what changes is that the next
  edit to it cannot quietly widen a filter. Both suites were verified to be
  discriminating rather than decorative by reintroducing the #3774 miscompile
  (propagating `or` into a branch's own contents): 15 of the mongodb translation
  suite's 26 tests fail, and 13 of the wasm suite's 18.

  `packages/spec`'s `filter-logic-conformance.ts` header now says five and names
  the fifth — a code comment; no schema, export or generated artifact moved.

- 24915d2: fix(driver-sqlite-wasm): a `RETURNING` write is a write — persist it (#4518)

  A file-backed `sqlite-wasm` database flushed its schema at boot and then
  recorded nothing else. Every table was on disk; every row written after schema
  sync lived only in the WASM heap and died with the process. Reopening the file
  found a complete, empty database.

  **Cause.** The Knex dialect picked its execution branch from _"does this
  statement return rows"_ — and then marked the database dirty only on the other,
  row-less branch. `INSERT … RETURNING *` returns rows, so it executed on the
  row-returning branch and never set the flag. Since the `on-disconnect` flush is
  gated on the same flag, nothing rescued it afterwards either: **both** persist
  strategies dropped the write. ObjectQL writes through `RETURNING *` (it hands
  the stored row back to the caller), so this covered essentially all business
  data, along with `knex.raw('INSERT …')` and any other mutation arriving without
  a Knex `method`.

  **Fix.** "Does this statement change the database?" is now one exported
  predicate — `statementMutatesDatabase(sql, method)` — classifying by Knex method
  _and_ SQL text, applied at a single funnel after execution. It is independent of
  which branch executed the statement, so a mutation can no longer slip through by
  returning rows, by arriving without a method, or by taking a branch that forgot
  to say so. Transaction control still routes to `noteTransactionControl`, which
  keeps deferring flushes until the transaction closes (#1494), and mutating
  `PRAGMA` assignments (`auto_vacuum`, `user_version`) now count as writes too.

  **What changes for you.** Nothing to author. File-backed wasm SQLite now
  actually persists under `on-write` / `debounced:*`, and `disconnect()` is a real
  durability boundary: when it returns, committed data is on disk. This is what
  `bootStack({ databaseFile })` in `@objectstack/verify` needed to make `stop()` →
  second `bootStack` a genuine cold boot — the suspended-run restart proof
  ADR-0019 promises is now asserted end to end in the dogfood gate. Expect more
  disk writes than before on a file-backed dev database, because previously there
  were almost none.

  **One internal signature moved.** `WasmSqliteConnection.markDirty(method?)` is
  now `markDirty()`. It used to re-filter the caller's Knex method against its own
  allowlist, which made "did this mutate?" a decision taken in two places that
  could — and did — disagree. If you call it directly, drop the argument; the
  dialect classifies, the connection obeys.

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
  - @objectstack/driver-sql@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

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

- 9881074: test(drivers): the "held to by a gate" claim now has a gate behind it (#4363)

  Three changesets — filter combinator semantics (#3774), temporal storage form
  (ADR-0053), deterministic paged reads (objectui#3106 / #4363) — each introduced
  a shared case-set in `@objectstack/spec/data` with some version of the claim
  that a future driver "is held to this by a gate rather than by remembering it".

  There was no gate. The case-sets are exports sitting in a package; nothing
  obliged a driver to import them. Measured on `main`, the matrix had three holes:
  `driver-sqlite-wasm` ran neither pagination case-set, and neither it nor
  `driver-mongodb` ran the filter-logic one — including a hole in the very
  case-set whose changeset made the claim.

  `scripts/check-driver-conformance.mjs` (`pnpm check:driver-conformance`, wired
  into lint.yml's required job) makes the hole the failure. Every
  (driver × case-set) cell is covered — some file under the package's `src/`
  imports _and drives_ the case-set's marker export — or carries a measured
  DEBT/EXEMPT entry, reconciled in both directions. A third direction, CLASSIFIED,
  holds the other end: a new `*-conformance.ts` fixture nobody classified fails
  the run rather than starting life uncovered, which is the direction that
  actually rots (#4203). It caught an unclassified `TEMPORAL_TIME_CASES` on its
  first run.

  `driver-sqlite-wasm` gains the pagination suite the gate found missing. It
  inherits `SqlDriver`'s ORDER BY construction, so nothing is re-implemented —
  what the suite pins is that the clause survives a different _engine_: this
  driver swaps knex's transport for a custom sql.js dialect that compiles,
  executes and marshals every row through its own path, and a dialect that
  reordered or dropped the trailing `ORDER BY id` would fail in no other suite.

  The two filter-logic holes are ledgered as DEBT rather than fixed here, with
  their reasons printed on every run and tracked in #4405. The mongodb row is the
  substantive one: `translateFilter` is an independent FilterCondition backend —
  the fifth, and the one #3774 never enrolled when it counted "the four".

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

- c53aa53: File-backed SQLite now runs `journal_mode = WAL` (#3941).

  `SqlDriver.connect()` set `auto_vacuum` and left the journal mode alone, so
  every ObjectStack SQLite database ran SQLite's built-in default — a rollback
  journal. That is the worst mode for the shape this platform actually has, which
  is **several processes on one file**: a dev server, `os migrate`,
  `os meta resync`, a test run. Measured, on the same file:

  |                                                | rollback journal                                   | WAL                                                               |
  | :--------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------- |
  | writer while another process holds a read open | `SQLITE_BUSY` — committing needs an exclusive lock | proceeds                                                          |
  | idle attached connection visible to SQL        | no — a lock lasts only as long as its transaction  | yes (`locking_mode = EXCLUSIVE` + `BEGIN IMMEDIATE` reports busy) |

  The second row is why the `os migrate` occupancy check had to inspect file
  descriptors to see a live server at all (#3940): under a rollback journal there
  was nothing in the database to see. That signal stays — it names the process,
  which WAL's lock probe cannot — but the SQL probe is now authoritative for
  databases ObjectStack created rather than a fallback that was blind in practice.
  Concurrent _writers_ still serialize; SQLite allows one at a time in any mode.

  Journal mode is a persistent property of the file, so an existing database is
  converted in place on the next connect (a header change — no rows are touched)
  and stays converted. Two consequences to plan for:

  - `app.db-wal` / `app.db-shm` exist beside the database while a connection is
    attached, and `app.db-wal` can hold committed transactions. A clean shutdown
    checkpoints them away; a naive copy of `app.db` alone while a server runs does
    not. Use `sqlite3 app.db ".backup …"`.
  - **WAL does not work on network filesystems** (NFS/SMB). Opt out with
    `OS_DATABASE_SQLITE_JOURNAL_MODE=delete`, or per datasource with
    `sqliteJournalMode: 'delete'` in the driver config (which outranks the env
    var). Either form _applies_ `delete`, so it also converts a database that
    already adopted WAL back — skipping would have stranded it.

  Nothing here fails a boot, and nothing is assumed: `PRAGMA journal_mode = X`
  answers with the mode actually in force rather than raising on refusal, so the
  reply is read back; and because a filesystem can accept WAL and then fail the
  first read _through_ it, the mode is proven with a read and rolled back to
  `delete` if that fails — with a warning naming the file and the escape hatch.
  `synchronous` is untouched, so durability is exactly what it was. `:memory:`
  databases are left alone, as is `auto_vacuum = INCREMENTAL`, which keeps
  reclaiming under WAL (ADR-0057).

  `os db clean` now counts `-wal` / `-shm` as part of the database when it measures
  what a `VACUUM` reclaimed, so bytes that were sitting in the log do not read as a
  reclaim of zero.

  `@objectstack/driver-sqlite-wasm` deliberately stays out of WAL. Its live
  database is in the WASM heap and what reaches disk is a byte image it exports, so
  nothing reads the database across processes and the pragma buys it nothing —
  while still being a persistent header change in the operator's file. sql.js
  _accepts_ the pragma (its VFS is memory-backed), so this had to be declared
  rather than discovered.

  It also now parks a `-wal` left behind by an unclean native-driver exit rather
  than loading the image beside it: wasm SQLite cannot read that log, and leaving
  it next to a freshly rewritten image would let a later real SQLite replay frames
  that no longer belong to it. The warning names the file it parked and how to
  recover what was in it.

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
- Updated dependencies [42e3b01]
- Updated dependencies [c8124e5]
- Updated dependencies [39eb01b]
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
- Updated dependencies [6f98c2d]
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
- Updated dependencies [33a5ff4]
- Updated dependencies [9e01213]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [3fe0ff1]
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
- Updated dependencies [c53aa53]
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
  - @objectstack/driver-sql@17.0.0-rc.1
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
- Updated dependencies [c7f4417]
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
- Updated dependencies [32d3800]
- Updated dependencies [cf5e033]
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
- Updated dependencies [5d4de37]
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
- Updated dependencies [647ec8b]
- Updated dependencies [7457a09]
- Updated dependencies [5f0852f]
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
  - @objectstack/driver-sql@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/driver-sql@16.1.0

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
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
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
- Updated dependencies [ce468c8]
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
  - @objectstack/driver-sql@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/driver-sql@16.0.0-rc.1

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
- Updated dependencies [47d923c]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [efbcfe1]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [ce468c8]
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
  - @objectstack/driver-sql@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/driver-sql@15.1.1

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
  - @objectstack/driver-sql@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/driver-sql@15.0.0

## 14.8.0

### Patch Changes

- a199626: Harden the wasm SQLite driver (the dev fallback used when native `better-sqlite3` has an ABI mismatch) against three failure modes that spammed `pnpm dev`:

  - **Atomic flushes.** The database was persisted with a plain `writeFile` that truncates-then-streams in place, so a process killed mid-write (a dev-server restart, Ctrl-C, or crash — likely under `on-write`, where every dispatcher tick flushes) left a torn file that sql.js rejected on the next boot with `database disk image is malformed`. Flushes now write to a sibling temp file, `fsync`, and atomically `rename()` over the target, so a reader always sees a complete image.
  - **Corruption self-heal.** When an on-disk image is already corrupt, the driver now detects it at open (via `PRAGMA quick_check`), quarantines the bad file to `<db>.corrupt-<timestamp>`, and boots on a fresh database — instead of failing every query forever with no path to recovery.
  - **`undefined` bindings.** A raw `undefined` binding made sql.js `throw` a plain string (`Wrong API use : tried to bind a value of an unknown type (undefined).`), which aborted the write and logged as a garbled char-indexed object. `undefined` is now coerced to SQL `NULL`, matching the driver's `useNullAsDefault` semantics and the native better-sqlite3 path.

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [84650c5]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/driver-sql@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/driver-sql@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/driver-sql@14.6.0
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
  - @objectstack/driver-sql@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/driver-sql@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/driver-sql@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/driver-sql@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/driver-sql@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/driver-sql@14.0.0
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
  - @objectstack/driver-sql@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/driver-sql@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/driver-sql@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/driver-sql@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/driver-sql@12.3.0

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
  - @objectstack/driver-sql@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/driver-sql@12.1.0

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
  - @objectstack/driver-sql@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/driver-sql@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
- Updated dependencies [8d87930]
  - @objectstack/spec@11.9.0
  - @objectstack/driver-sql@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0
- @objectstack/driver-sql@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/driver-sql@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/driver-sql@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/driver-sql@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/driver-sql@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/driver-sql@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/driver-sql@11.2.0

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
  - @objectstack/driver-sql@11.1.0

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
- Updated dependencies [98a1535]
- Updated dependencies [bc22a89]
- Updated dependencies [8a7e9f1]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/driver-sql@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [5ba52b0]
  - @objectstack/driver-sql@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/driver-sql@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
- Updated dependencies [517dad9]
  - @objectstack/spec@10.1.0
  - @objectstack/driver-sql@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [92db3e5]
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
  - @objectstack/driver-sql@10.0.0
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
  - @objectstack/driver-sql@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [d9508d1]
- Updated dependencies [1d352d3]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/driver-sql@9.10.0
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/driver-sql@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [796f0d6]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/driver-sql@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/driver-sql@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/driver-sql@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/driver-sql@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/driver-sql@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/driver-sql@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/driver-sql@9.4.0
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
  - @objectstack/driver-sql@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/driver-sql@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/driver-sql@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/driver-sql@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/driver-sql@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/driver-sql@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [1e8b680]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/driver-sql@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/driver-sql@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/driver-sql@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/driver-sql@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- be20aa4: Fix `COMMIT; - cannot commit - no transaction is active` under `persist: 'on-write'` (#1494).

  sql.js's `Database.export()` closes and reopens the database (it has no in-place
  serialize), which rolls back any open transaction. The fire-and-forget flush
  triggered after a write inside a Knex transaction (e.g. the autonumber sequence
  `BEGIN…COMMIT`) could therefore abort that transaction, leaving the trailing
  `COMMIT` to fail. The connection is now transaction-aware: `flush()` is deferred
  while a transaction is open and runs once it fully closes, so committed data is
  still persisted without aborting in-flight transactions.

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
  - @objectstack/driver-sql@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/driver-sql@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/driver-sql@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [24c9013]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/driver-sql@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/driver-sql@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/driver-sql@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/driver-sql@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/driver-sql@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/driver-sql@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/driver-sql@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/driver-sql@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/driver-sql@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/driver-sql@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [4944f3a]
- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/driver-sql@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/driver-sql@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/driver-sql@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/driver-sql@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/driver-sql@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/driver-sql@6.2.0

## 6.1.1

### Patch Changes

- 084ee2f: Sync `@objectstack/driver-sqlite-wasm` into the v6 fixed-version group so it
  releases in lockstep with the rest of the framework. The package was
  previously stuck at 5.2.1 on npm while every other `@objectstack/*` package
  moved to 6.0.0, which broke StackBlitz/WebContainer installs of templates
  that pin `^6.0.0`.
  - @objectstack/spec@6.1.1
  - @objectstack/core@6.1.1
  - @objectstack/driver-sql@6.1.1

## 5.2.2

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/driver-sql@6.1.0

## 5.2.1

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/driver-sql@6.0.0
