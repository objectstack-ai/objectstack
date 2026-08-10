# @objectstack/service-external-datasource

## 17.0.0-rc.6

### Major Changes

- e2798fa: feat(service-datasource)!: `DRIVER_CATALOG` publishes `mongodb`, and the factory can no longer fall through to `memory` (#6345)

  **BREAKING — `DRIVER_CATALOG`'s MongoDB entry publishes `id: 'mongodb'`.** That
  field is documented as "used as `datasource.driver`" and it is literally what the
  Studio connection form writes into a datasource row, so this is the face of
  #6345's `mongo` → `mongodb` rename that reaches stored data. Rows written before
  the rename carry `mongo`; the ADR-0087 D2 conversion
  `datasource-driver-mongo-to-mongodb` converges them at every rehydration seam,
  and `mongo` remains an accepted alias so a deployment that skipped the migration
  still connects. The factory's dispatch arm renames with it (`kind === 'mongodb'`).

  **A `turso` construction arm — which the rename made mandatory, not optional.**
  `createDefaultDatasourceDriverFactory().supports()` is
  `resolveDriverId(id) !== undefined`, so the moment `turso` gained a config
  contract in `@objectstack/spec` this factory began claiming it. Before this arm,
  that claim was answered by `create()`'s trailing `memory` fall-through: a libSQL
  datasource would have been built as an ephemeral in-process store that accepts
  writes, reports success and loses everything — the #3276 silent-wrong-engine
  class with a new spelling. The arm is the same shape `mongodb` and `sqlite-wasm`
  already use (lazy import, typed not-installed error), because all three ride in
  optional packages and being an optional INSTALL has never meant lacking a
  contract.

  The CLI and standalone stack still inject their own turso factory for the
  `default` datasource (#5602's host-factory seam), and an injected factory
  replaces this one — so this arm serves every OTHER door: a runtime datasource
  created in Setup, `testConnection`, a declared non-default datasource. Those
  doors previously got `supports() === false` and degraded; they now build.

  **The fall-through itself is gone.** `memory` was the last arm's _implicit_
  position — no `if`, just the end of the function — so any `BuiltinDriverId` the
  switch did not handle silently became an in-memory store. It is now an explicit
  `kind === 'memory'` arm followed by an exhaustiveness stop typed `never`: adding
  a builtin without an arm is a compile error, and if a stale published
  `@objectstack/spec` ever reaches a newer consumer at run time, the result is a
  named refusal rather than a different engine. This is the trap the next driver
  would have inherited; turso is simply the one that found it.

  **Why `major`.** The published `DRIVER_CATALOG[].id` value changes. Any consumer
  that compares a stored `datasource.driver` against the catalog id — a form
  pre-selecting the current driver, a grouped list, an equality filter — stops
  matching pre-rename rows until the conversion has run. Nothing throws, which is
  precisely why this is not a `minor`: the failure is a dropdown that silently
  shows no selection, and a bump that lets it arrive unannounced would be the same
  class of quiet as the defect the rename fixes.

  **Not renamed, deliberately:** `SqlDialect`'s `'mongo'` member
  (`data/type-compat.ts`). That is a different vocabulary — it names the type
  system of an EXTERNAL schema being introspected, alongside `snowflake` and
  `bigquery`, and is never a `datasource.driver`. Renaming it would have been
  sympathetic magic on a matching string.

  <!-- adr-0087: registered datasource-driver-mongo-to-mongodb -->

### Patch Changes

- 01faeb1: fix(service-datasource): a `pool` block on a `memory` datasource is rejected, not dropped in silence (#5931)

  #5714 made a `pool` block the driver cannot honour a loud authoring error, but
  its ruling was scoped to the two sqlite arms — `memory` kept dropping it. The
  `memory` arm hands `InMemoryDriver` nothing but `buildMemoryConfig(spec)`, which
  reads `spec.config` and never `spec.pool`, so a sized pool reached nothing and
  said nothing. Measured through the real factory:

  ```text
  memory   + pool{min:3,max:9}   driver config {"persistence":false}   pool undefined
  sqlite   + pool{min:3,max:9}   rejected (since #5714)
  postgres + pool{min:3,max:9}   knex config.pool {"min":3,"max":9}    live {min:3,max:9}
  ```

  `memory` now joins `POOL_UNSUPPORTED_DRIVER_IDS`, so the same three doors that
  already rejected sqlite reject it: the Setup wizard's create/update, the
  boot-time auto-connect pre-pass, and the driver factory itself.

  **Behaviour change.** A datasource declaring `driver: 'memory'` (or `inmemory` /
  `in-memory` / `mingo`) together with a non-empty `pool` block used to load and
  run; it now throws at whichever door it arrives through. The fix is the one edit
  the message names — delete the `pool` block. Nothing is lost by deleting it: it
  configured nothing before. An absent or empty `pool` is unchanged, and every
  `memory` datasource without one builds exactly as it did. No declaration in this
  repo, the example apps included, carried the combination.

  **Its own explanation, not SQLite's.** SQLite is rejected because a second
  connection to `:memory:` opens a separate, empty database, so sizing the pool
  would split one datasource across several stores. That reasoning is false for
  `memory`: there is no connection at all — the store is a plain data structure in
  this process — so the message says that instead. Telling an author their driver
  picked a connection strategy for them would send them looking for a knob that
  does not exist. Reasons are now keyed by driver id, which makes an arm joining
  the set without writing one a type error.

  Maintainer ruling 2026-08-07, which also set the default for the next sister
  arm: when a declared key is silently dropped on one arm and an earlier ruling
  already made it a loud authoring error on a sibling, the new arm joins the
  existing rejection set rather than queueing for a ruling of its own — unless the
  original rationale was measured to be arm-specific.

  No API surface is added — `POOL_UNSUPPORTED_DRIVER_IDS`,
  `driverReadsDeclaredPool`, `unsupportedPoolIssue`, `unsupportedPoolMessage` and
  `assertDatasourcePoolSupported` keep the signatures #5714 published, and the
  sqlite arms' rejection text is byte-for-byte unchanged.

- d92ed03: fix(service-datasource): 未构建的工作区不再被当成「配置写错了」(#5794)

  datasource 的 fail-fast 报错原本只有一句收尾建议,不分成因:

  ```
  ✗ datasource 'default': connect failed — Cannot find module
    '…/@objectstack/driver-sql/dist/index.mjs' imported from …
    Fix the datasource configuration, or set OS_ALLOW_DRIVER_CONNECT_FAILURE=1
    to boot anyway and serve errors until it is reachable.
  ```

  对「数据库真连不上」——错的 DSN、轮换掉的密码、断掉的网络——这句话是对的。
  但对**驱动包没构建**这一个成因,两半都是有害建议:

  - **「Fix the datasource configuration」** 把读者支去改一份本来就正确的配置。
    在那里写什么都变不出一个 `dist/` 目录。
  - **「set OS_ALLOW_DRIVER_CONNECT_FAILURE=1 to boot anyway」** 比没用更糟:
    它不是绕过问题,而是**藏起**问题。半个工作区会宣称自己启动成功,然后对每个
    请求回 `ERR_DATASOURCE_UNAVAILABLE`——比诚实地拒绝启动难查得多。那个开关是
    为「数据库暂时不可达」准备的(一个关于世界的事实,可能自己好起来);缺构建产物
    是关于这份 checkout 的事实,不该有任何环境变量能启动越过它。

  而唯一有效的修法(`pnpm build`)一个字都没提。

  现在 connect 失败会按**成因**选收尾句。底层错误是模块解析失败时(ESM `import()`
  报 `err.code === 'ERR_MODULE_NOT_FOUND'`,CJS `require()` 报 `MODULE_NOT_FOUND`;
  `code` 被 re-throw 丢掉时退回 `Cannot find module` / `Cannot find package` 文本),
  消息改成:

  ```
  The driver package could not be LOADED at all — it is not installed, or its build
  output is missing. That is a build precondition, not a datasource fault: the
  configuration is fine, and no boot-time override can make a driver that does not
  exist answer a query. Run `pnpm install && pnpm build`, then start again.
  ```

  一个正确修法,只说一次,**不提**那个逃生开关——连「别用它」都不提:一个已经卡住的
  读者会去找最短的那行看起来能让他继续的话。这与 `datasource-pool-support.ts`
  (#5714 / #5931)和 `check:dev-prereqs`(#5795)是同一条消息纪律。

  判据复用 `@objectstack/types` 的 `isModuleNotFoundError`(framework#3265 起的唯一
  所有者),不另起一份;它先看结构化的 `err.code`、再退回文本,而这个结构化信号原本
  在 `handleFailure` 只收 `reason: string` 时被丢弃了,所以抛出值本身现在也一并传入。

  **纯诊断分类,零行为变化。** fail-fast 的判定、触发时机、抛出的错误类型、保留的
  连接状态,以及设了 `OS_ALLOW_DRIVER_CONNECT_FAILURE` 时的降级启动路径全部不变;
  其它成因(真连接失败、驱动不受支持、凭据解析不出)的消息逐字未动。

- 6146b67: `os migrate plan` no longer creates a database on a project that has never been started (#6743)

  `migrate plan` is a dry run, and since #3917 it has reported the boot-time
  create-table DDL and the artifact seed instead of performing them. It still
  brought the database file itself into existence, though: SQLite creates the
  file at open, so a `plan` in a fresh project left behind a 0-table
  `.objectstack/data/objectstack.db` — a write side effect from a read-only
  command, and one that erased the only signal ("no database file yet") by which
  the next command can tell a never-started project from a started one.

  A missing SQLite target is now opened as an empty in-memory database instead of
  being created. **The plan output is unchanged**, deliberately: a database with
  zero tables is exactly what a freshly created empty file is, so "every table
  needs creating" — the true and useful answer for a new project — still prints,
  and the `Database:` line still names the real target path rather than the
  in-memory stand-in.

  New driver capability, additive and off by default:
  `SqlDriverConfig.sqliteAbsentFile` (`'create'` | `'empty-in-memory'`, default
  `'create'`). Every existing caller keeps SQLite's own create-if-absent
  behaviour. It is threaded to the driver as a host-composition option
  (`createDefaultDatasourceDriverFactory`, `DefaultDatasourcePlugin`,
  `createStandaloneStack`), not as an authorable `datasource.config` key — a
  datasource must not be able to declare itself into never persisting.

  `os migrate apply` deliberately does **not** use it: it boots deferred too, but
  flushes the deferred DDL after confirmation and needs a real file to flush into.

- b948a41: The `sqlite-wasm` and `mongodb` arms of the shared datasource driver factory now tell you how to install the optional driver package they are missing (#7385)

  All three of `sqlite-wasm`, `mongodb` and `turso` are built from OPTIONAL packages, so all three have to answer "the package is not here". After #7314 fixed the libSQL arm, the other two still answered with the fault and nothing else:

  ```text
  sqlite-wasm driver requested but @objectstack/driver-sqlite-wasm is not installed (…).
  mongodb driver requested but @objectstack/driver-mongodb is not installed (…).
  ```

  No install command, no statement of what happens next, and not even the name of the datasource that failed — while the `turso` arm beside them stated all three. An admin who added a mongo datasource in Setup and one who added a libSQL datasource hit the same class of problem and got two different qualities of answer, decided by nothing but which driver they picked.

  Both arms now answer through a shared builder, keeping the two discipline points #7384 landed under: the message NAMES THE DATASOURCE (several may be declared and only one of them is this engine), and it names exactly one fix with no escape hatch — no `OS_ALLOW_DRIVER_CONNECT_FAILURE` (it would only hide a package that does not exist) and no `OS_DATABASE_URL` / `--database` (they select the HOST's `default` datasource and can do nothing for the one that failed). The underlying import error is still interpolated in full, which is what keeps `isUnbuiltWorkspaceFailure` able to recognise a half-built checkout from these arms and re-route the remedy to `pnpm install && pnpm build`.

  The consequence sentence is per-engine rather than copied. Mongo, like libSQL, is a server this process connects to, so a silent fallback would open a local database while the real server stayed untouched. `sqlite-wasm` has no remote to shadow, so it states its own truth instead: stepping down to the in-process memory driver would accept every write and drop it at shutdown, leaving the configured file empty, and stepping down to native `better-sqlite3` would need exactly the native addon a WASM datasource is chosen to avoid.

  New exports, mirroring the libSQL pair, so a host that renders its own remedy reads one declaration instead of re-typing a command: `SQLITE_WASM_DRIVER_PACKAGE`, `SQLITE_WASM_DRIVER_INSTALL_COMMAND`, `missingSqliteWasmDriverMessage`, `MONGODB_DRIVER_PACKAGE`, `MONGODB_DRIVER_INSTALL_COMMAND`, `missingMongodbDriverMessage`.

- b0c16a5: fix(service-datasource): the open-core libSQL arm tells you how to install the driver it is missing (#7314)

  `@objectstack/driver-turso` is an OPTIONAL install — it drags `@libsql/client`
  and its native bindings — so both loaders that can build a libSQL datasource
  have to answer "the package is not here". Until now they answered it very
  differently.

  The HOST loader (`@objectstack/runtime`'s `loadTursoDriverFactory`, the single
  owner since #6268) raises `MissingDriverPackageError` carrying the install
  command as data, plus a message naming the command, the consequence, and why the
  boot refuses instead of quietly opening a SQLite file. The shared open-core
  factory's `turso` arm — the one that serves **every other door**: a datasource
  added in Setup, `testConnection`, a declared non-default datasource — said only:

  ```text
  turso driver requested but @objectstack/driver-turso is not installed (…).
  ```

  The fault and nothing else. Same missing package, and whether you were told how
  to fix it depended on whether your datasource happened to be named `default`.

  That arm now answers with the same quality of remedy:

  ```text
  datasource 'warehouse': a libSQL/Turso datasource was requested, but the driver
  package @objectstack/driver-turso is not installed. Install it next to the
  server that opens this datasource:

      npm install @objectstack/driver-turso

  (pnpm add … / yarn add ….) It is an OPTIONAL package, so a default install stays
  free of @libsql/client and its native bindings. This refuses rather than falling
  back to another engine: a silent fallback would open an empty local database
  that accepts writes while your libSQL data stays untouched, and every write
  would land in the wrong database. Import error: …
  ```

  Two deliberate differences from the host loader's wording, because this arm
  serves different doors. It **names the datasource** — here there may be several
  and only one of them is libSQL. And it names **no** `OS_DATABASE_URL` /
  `--database` / `OS_ALLOW_DRIVER_CONNECT_FAILURE`: those select or bypass the
  HOST's `default` datasource and can do nothing for the datasource that actually
  failed, and pointing a stuck reader at a knob that cannot affect their problem
  is the failure `connect-failure-remedy.ts` was written to end (#5794). One fix,
  stated once, no escape hatch named.

  The original import error is still interpolated in full, which is load-bearing
  rather than context: this re-throw drops the error's `code`, so the
  unbuilt-workspace classifier can only recognise a half-built checkout from the
  `Cannot find package` text the message carries.

  `TURSO_DRIVER_PACKAGE`, `TURSO_DRIVER_INSTALL_COMMAND` and
  `missingTursoDriverMessage` are exported, so a host that renders the remedy
  itself reads one declaration instead of re-typing a sentence.

  Behaviour is otherwise unchanged: the same failure at the same moment, still a
  refusal and never a fallback to a different engine. Only the message differs.

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
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 99d7a93: fix(service-datasource): a `pool` block on a sqlite datasource is rejected, not dropped in silence (#5714)

  `datasource.pool` is declared, strict and documented, and until now it reached a
  driver only from the arms that build a pooled client: `postgres` / `mysql` hand
  `buildSqlPool(spec)` to `SqlDriver`, `mongo` maps `min`/`max` onto the client's
  `minPoolSize`/`maxPoolSize`. The `sqlite` and `sqlite-wasm` arms passed no pool
  at all — `resolveSqliteDriver` has no such option and `SqliteWasmDriver` does
  not take one — so an author who sized their pool got the driver's own single
  connection and nothing said otherwise. Measured through the real factory:

  ```text
  sqlite   + pool{min:3,max:9}   knex.client.config.pool {"createTimeoutMillis":15000}   live {min:1,max:1}
  postgres + pool{min:3,max:9}   knex config.pool {"min":3,"max":9}                      live {min:3,max:9}
  ```

  `examples/app-crm` was the live specimen: `CrmDatasource` asked for
  `{ min: 1, max: 5 }` and ran on one connection.

  **Wiring it through would be wrong, not merely more work.** Knex's
  better-sqlite3 dialect pins `{min:1,max:1}` on purpose: every pool acquire runs
  `new Database(filename)`, so two connections to `:memory:` are two separate,
  mutually invisible databases. Honouring `max: 5` there would split one
  datasource's data across five stores. Sizing a SQLite pool is not a knob the
  platform can offer, so the declaration is rejected at authoring/publish instead
  — Prime Directive #12: fix the metadata at the producer, reject it loudly, never
  tolerate it in the consumer.

  **Observable behaviour change — read this if any datasource declares `pool`.**
  A `sqlite` / `sqlite-wasm` datasource carrying a `pool` block now **fails**
  where it used to boot with the block ignored:

  - **Boot** (`DatasourceConnectionService.connectDeclared`) refuses before a
    single connection is attempted, naming every offending datasource in one
    throw. Every _declared, active_ datasource is judged, including the ones the
    ADR-0062 D2 gate leaves unconnected — a pool block on a datasource nobody
    connects is exactly as dropped as a connected one's. `active: false` is
    skipped, so switching a datasource off remains the way out.
  - **Setup → Datasources** (`createDatasource` / `updateDatasource`) rejects the
    draft before the record is stored. An update that touches neither `pool` nor
    `driver` is not re-judged, so a record written before this gate stays editable
    — including the `active: false` that takes it out of service.
  - **The driver factory** (`createDefaultDatasourceDriverFactory`) rejects it as
    the last door, for hosts that build drivers directly.

  The fix is to delete the block: `pool` is a no-op on SQLite either way, so
  removing it changes nothing about how the datasource runs.

  ```diff
   export const CrmDatasource = defineDatasource({
     name: 'crm_primary',
     driver: 'sqlite',
     config: { filename: ':memory:' },
  -  pool: { min: 1, max: 5 },
     active: true,
   });
  ```

  `pool` is unchanged and still honoured on `postgres` / `mysql` / `mongo`, and a
  plugin-contributed driver id (`com.vendor.snowflake`) is not judged at all —
  the same boundary the `datasource.config` gate draws in #4410: the platform
  validates what it can construct.

  This verdict is an **authoring** error, not a connect failure: it never goes
  through the ADR-0062 D5 degradation path, so `OS_ALLOW_DRIVER_CONNECT_FAILURE`
  does not apply to it and is not suggested. That hatch exists for a database that
  is unreachable — a fact about the world that may resolve itself. A `pool` the
  driver cannot read is a fact about the metadata.

  Hosts that inject their own driver factory can hold the same contract with the
  newly exported `assertDatasourcePoolSupported` / `driverReadsDeclaredPool` /
  `unsupportedPoolIssue` / `POOL_UNSUPPORTED_DRIVER_IDS`.

### Patch Changes

- cba7454: fix(service-datasource): give this package's vitest run a 60s `testTimeout` — close the #4856 coverage hole that let the merge queue evict unrelated PRs (#6044)

  `packages/services/service-datasource` had no `vitest.config.ts` at all, so
  every case ran under vitest's **5000ms** default. #4856 fixed this class of
  flake by setting per-package timeouts in each package's own `vitest.config.ts`
  — a structure that cannot reach a package with no config file to carry it.

  The cases that build a REAL driver pay a one-time `@objectstack/driver-sql`
  (knex) import inside the first case that reaches it. In
  `datasource-pool-support.test.ts` the pool rejections throw before that import,
  so "sqlite WITHOUT a pool still builds exactly as before" is the first case
  through it: measured idle it runs ~1.1s while its neighbours run 0-2ms (the
  postgres/mysql cases ride the module cache at 31/82ms). ~4.6x headroom against
  5000ms holds on a PR branch and not on a merge-queue runner building several
  PRs' batches at once — the observed signature: intermittent reds only in queue
  full builds, evicting PRs that never touched this package (#5999 twice, #5973
  once, 2026-08-06).

  `testTimeout: 60_000` reuses #4856's value rather than inventing a new number,
  set at the config layer so future cases are covered on arrival. Isolation was
  reviewed rather than assumed (the #6044 triage forbade a timeout-only closure):
  the flaky case builds `:memory:`, unprobed on the production path, never opens
  a connection or loads the native addon, and every factory-door case destroys
  its knex handle; the boot and wizard doors run on per-case fakes. No temp
  files, no ports, no shared mutable state across cases — the red was load
  variance on a real one-time import, not a leak.

  No runtime, schema or public API change — test configuration only.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
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
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- cdf4d9a: `datasource.config` is now validated against its driver's contract (#4410)

  `config` was the one authorable slot on a datasource with no gate at all. The
  schema's own comment claimed "the driver's own `configSchema` is what validates
  it" — nothing did: both bundled driver specs set `configSchema: {}`, no code read
  the field, and the per-driver zod schemas were not even exported from the
  package. So `config: { hostname: 'db.internal' }` (the key is `host`) was
  accepted in silence and the datasource connected to `localhost` while the parse,
  the save and the connection probe all reported success.

  `DatasourceSchema` now parses `config` against
  the contract for the declared driver, and `DatasourceAdminService`
  (create/update/test, the Setup wizard's path) applies the same check. Both read
  one registry in `@objectstack/spec/data`, which also projects each contract to
  JSON Schema for `DriverDefinitionSchema.configSchema` and the Studio connection
  form, so the form offers exactly the fields the validator accepts.

  New exports from `@objectstack/spec/data`: `PostgresConfigSchema`,
  `MysqlConfigSchema`, `SqliteConfigSchema`, `SqliteWasmConfigSchema`,
  `MongoConfigSchema`, `MemoryConfigSchema`, plus `resolveDriverId`,
  `getDriverConfigSchema`, `getDriverConfigJsonSchemaById` and
  `validateDriverConfig`. A driver the platform ships no contract for (a plugin's
  `com.vendor.snowflake`) keeps an unvalidated `config`.

  **Migration.** A config that was silently ignored now fails with the correction
  in the message. The renames:

  | Wrote                        | Write instead | Driver                 |
  | ---------------------------- | ------------- | ---------------------- |
  | `user`                       | `username`    | postgres, mysql, mongo |
  | `connectionString` / `dsn`   | `url`         | postgres, mysql, mongo |
  | `uri`                        | `url`         | mongo                  |
  | `file` / `path` / `database` | `filename`    | sqlite, sqlite-wasm    |
  | `hostname`                   | `host`        | postgres, mysql, mongo |
  | `searchPath`                 | `schema`      | postgres               |

  And the relocations — keys that were never driver config:

  | Wrote in `config`                                               | Write instead                                                                                                                                                               |
  | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `min` / `max` / `idleTimeoutMillis` / `connectionTimeoutMillis` | the datasource's own `pool` block                                                                                                                                           |
  | `schemaMode`                                                    | next to `driver`, on the datasource                                                                                                                                         |
  | `readOnly`                                                      | `external: { allowWrites: false }` — the enforced write gate. (This row said `capabilities: { readOnly: true }` until #4487's liveness audit found that key has no reader.) |
  | `ssl: { ca, cert, key, rejectUnauthorized }`                    | the datasource's own `ssl` block — inside `config`, `ssl` is the on/off boolean shorthand                                                                                   |

  Two memory-driver keys are **removed**: `indexes` and `maxRecordsPerObject`.
  `InMemoryDriverConfig` has no field for either — the driver keeps no indexes and
  evicts nothing — so both were inert. Drop them; for real indexing use a driver
  that indexes.

  A postgres, mysql or mongo datasource must now name a connection target
  (`database`, or a `url` that carries it). An empty `config` used to mean "the
  client's own localhost default", which is the same defect in its most complete
  form.

  **Also fixed, because the contract can only be enforced where it is honoured.**
  These keys were declared and read by nothing; they now reach the driver:

  - `datasource.pool` is honoured by every SQL driver (it was declared, carried
    into the connection spec, then overwritten with a hardcoded `{ min: 0, max: 5 }`),
    and maps onto the Mongo client's `minPoolSize` / `maxPoolSize`.
  - `datasource.schemaMode` reaches the driver. It was dropped between the
    datasource record and the connection spec, so a `schemaMode: 'external'`
    database — one ObjectStack must never run DDL against — was constructed as
    `managed`.
  - `datasource.ssl` reaches the SQL clients, certificates and all. It stopped at
    the record — nothing put it on the connection spec — so a TLS block configured
    nothing, which is exactly what its own schema comment warns about ("a TLS
    setting that never took effect looked identical to one that did").
  - postgres `schema` (knex `searchPath`), `applicationName` and `statementTimeout`.
  - mongo `password`, `authSource` and `options`. A mongo datasource carrying a
    `config.password` previously composed its URL with an **empty** password.

- aee1806: feat(spec,service-datasource): graduate the driver factory's four legacy `datasource.config` `??` fallbacks into an ADR-0087 conversion (#4456)

  `createDefaultDatasourceDriverFactory` still carried four undeclared read-side
  `??` fallbacks that predate the #4410 config gate: sqlite `file`/`database`
  (canonical `filename`), postgres/mysql `connectionString` (canonical `url`),
  postgres/mysql/mongo `user` (canonical `username`), and mongo `uri` (canonical
  `url`). They were never part of the contract — no schema, form, doc or example
  ever named them — and they kept working only because the reader was lenient
  (AGENTS.md Prime Directive #12 debt).

  **FROM → TO, applied automatically at load** by the new conversion entry
  `datasource-config-driver-key-aliases` (retired-from-load-path; replayed over
  stored `sys_metadata` rows by `applyConversionsToStoredItem` and by
  `os migrate meta`):

  - sqlite / sqlite-wasm: `config.file` / `config.database` → `config.filename`
  - postgres / mysql: `config.connectionString` → `config.url`, `config.user` → `config.username`
  - mongo: `config.uri` → `config.url`, `config.user` → `config.username`

  The mapping is driver-aware — `database` renames only under sqlite, where it
  aliased the file path; for postgres/mysql/mongo it is a canonical key and is
  untouched. A canonical key already present wins; the legacy alias is left
  shadowed (the factory's `??` precedence, preserved).

  **Behaviour change (the deletion):** the factory now reads exactly one spelling
  per key. A `DatasourceConnectionSpec` handed to the factory _directly_ with a
  legacy spelling is no longer honoured — authored metadata was already rejected
  by the per-driver zod gate with a rename hint (#4410), and stored runtime
  datasource rows are canonicalized at every rehydration seam (including the
  `sys_metadata` restore path in `DatasourceAdminServicePlugin`, which now
  replays the full conversion chain), so no supported path still produces the
  legacy shape. One-line fix for hand-built specs: use the canonical key from
  the table above.

- 63b33e6: A `datasourceMapping` rule is routing, not a hint — an object mapped to an
  unreachable datasource no longer silently reads and writes the DEFAULT store
  (#4462).

  **Observable behavior change; read this before upgrading.** Measured on `main`
  during the v17 verification: map an object to a Postgres datasource with a bad
  URL and the boot succeeds, `/ready` answers `200`, the datasource name appears in
  **zero** log lines, `POST /api/v1/data/<mapped object>` returns `201` — and the
  row is physically in the default store. The operator finds out by opening the
  database they declared and finding it empty. ADR-0062 D2's phase-1 note called a
  mapping-only datasource "decorative" to keep an example byte-for-byte unchanged;
  what that bought was a silent data-placement bug.

  The fix is a pair, and each half is what makes the other correct:

  1. **Routing stops falling through** (`@objectstack/objectql`). `getDriver` step
     2: a mapping rule that MATCHES and names a datasource with no live driver now
     throws — `DatasourceUnavailableError` when the connect layer recorded a
     verdict, otherwise an error naming the object, the datasource and the two
     remedies. `default` still resolves onward: the default driver keeps its
     natural name (#3826), so step 5 is how routing to it works.
  2. **ADR-0062 D2 grows gate (d)** (`@objectstack/service-datasource`,
     `@objectstack/runtime`). A datasource a mapping rule routes at least one
     object to is auto-connected at boot, and a boot-time connect failure is
     **fatal** with an operator-readable reason — the same call gate (b) already
     makes for an explicit `object.datasource` binding, now correct for (d)
     because half 1 removed the fallback. `OS_ALLOW_DRIVER_CONNECT_FAILURE` still
     degrades the boot instead, as for every other fatal connect.

  The mapped-object list is resolved by the boot path from the engine's own
  matcher (`ObjectQLEngine.resolveMappedDatasource`, newly public) and passed to
  `connectDeclared({ mappedObjects })`; the connection service never re-derives
  rule matching. Two matchers drifting by one clause would connect a datasource
  routing never uses, or route to one nothing connects — the defect again.

  **What to do if this breaks your boot.** It means a `datasourceMapping` rule in
  your stack points at a datasource that cannot be connected. Either fix the
  datasource configuration, or delete the rule — the second is what
  `examples/app-crm` did in this change, and it is what keeps that example's
  runtime behavior identical: its rules routed everything to an unconnected
  `:memory:` datasource, i.e. to the default store by fall-through.

### Patch Changes

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
- Updated dependencies [b25a116]
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
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- c9d254a: feat(datasource,runtime): kernel teardown disconnects through the one datasource path — and never closes an adopted pool (#3993)

  After the #3826 connect convergence, ADR-0062 D5's "owns connect/disconnect"
  was half-true: nothing disconnected the `default` (or a declared datasource's
  pool) on graceful shutdown. `DriverPlugin` never had teardown, `ObjectQLPlugin`
  teardown never touched drivers, and the kernel's actual teardown phase is
  `destroy()` — the Plugin contract has no `stop()`, so stray `stop` methods were
  never called by anything.

  The disconnect half now mirrors the connect half:

  - **`DatasourceConnectionService.disconnect(name, { asDefault })`** resolves
    the default under its NATURAL name (the same #3826 rule that makes
    `drivers.get('default')` impossible — the old lookup could never have found
    it), and honours a new ownership discriminator recorded at connect time.
  - **`disconnectAll()`** closes exactly the pools THIS service opened —
    `'connected'` states only. `already-registered` drivers belong to whoever
    registered them (an `onEnable` bridge, the default's idempotent replay) and
    are never touched.
  - **`DatasourceDriverHandle.ownership: 'factory' | 'host'`** is the
    discriminator. `createPrebuiltDriverFactory` stamps its handles `'host'`:
    an ADOPTED instance's pool outlives the kernel (the cloud control-plane
    driver doubles as every environment kernel's proxy base; per-environment
    drivers are registry-cached across kernel rebuilds), so kernel teardown —
    including a cloud LRU eviction's `kernel.shutdown()` — clears the retained
    verdict but NEVER closes the pool. Factory-built instances disconnect as
    before there was a before.
  - **`DefaultDatasourcePlugin.destroy()`** and
    **`DatasourceAdminServicePlugin.destroy()`** wire the sweep at the kernel's
    real teardown phase, best-effort (a failed disconnect never masks shutdown).

  A welcome side effect: a file-backed `sqlite-wasm` default with
  `persist: 'on-disconnect'` now actually flushes on graceful shutdown.

  Also flips ADR-0062's status to reflect the completed convergence (#3992):
  D1 is fully implemented across both repos since cloud#915; the remaining
  `DriverPlugin` uses are documented named-auxiliary/escape-hatch cases, and the
  degraded-boot parity guard stays with its role shifted to "the escape hatches
  must not drift".

- c3bcb42: feat(runtime,datasource): the default-datasource connect seam accepts a host driver factory — adopt pre-built instances without forking the verdict (#3826)

  ADR-0062 D1's open-core convergence (#3869/#3886) left one structural question
  open: a host whose `default` needs a driver the shared factory cannot build —
  the cloud distribution's `turso`, or an instance pooled BEYOND one kernel (the
  cloud control-plane driver doubles as the proxy base of every environment
  kernel; per-environment drivers are cached across kernel rebuilds) — had only
  two options, both bad: stay on the legacy pre-built `DriverPlugin` path, whose
  connect verdict lives in `ObjectQLEngine.init()` (the second implementation
  #3826 exists to retire), or fork the connect orchestration. Either re-opens the
  #3741 → #3758 drift this whole line of work is about.

  Two additive pieces close it:

  - **`DefaultDatasourcePlugin` accepts an injected `IDatasourceDriverFactory`**
    (defaults to the shared open-core factory, byte-for-byte unchanged when
    omitted). The factory only changes what `create()` returns — the policy-free
    init connect, `bootCritical` fail-fast, `OS_ALLOW_DRIVER_CONNECT_FAILURE`
    escape hatch, and the start() replay into retained admin state are identical
    either way, and the new tests pin that (an adopted instance that cannot
    connect takes the exact same verdict).
  - **`createPrebuiltDriverFactory(driver, { driverId?, fallback? })`** in
    `@objectstack/service-datasource` — the "adopt an existing driver" seam the
    first #3826 pass found missing, landed AS a factory so it composes into the
    one connect path instead of becoming a second entry point. `create()` returns
    the SAME instance every call: construction, pooling, and reuse stay host
    concerns; only the verdict converges. Not for the common case — a `default`
    expressible as `{ driver, config }` should stay a plain definition.

  The `@objectstack/verify` dogfood harness now boots through
  `DefaultDatasourcePlugin` (declared `sqlite-wasm` definition) instead of a
  pre-built `DriverPlugin` — so the dogfood gate exercises the same declared
  -default connect path `objectstack dev`/`serve` use, which is the §Risk
  mitigation ADR-0062 promised ("behind the dogfood gate") and did not yet have.
  The degraded-boot parity guard stays: `ObjectQLEngine.init()`'s verdict is
  still live for the boot re-verification, `DriverPlugin` escape-hatch drivers,
  and the cloud compositions until they converge onto this seam.

### Patch Changes

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

- 7bf5349: fix(service-datasource): the datasource-admin 503 names the service the route actually needs (#4225)

  `admin-routes.ts` registered nine service-backed routes behind one hard-coded 503:

  ```ts
  const unavailable = (res) =>
    sendError(
      res,
      503,
      "SERVICE_UNAVAILABLE",
      "The datasource-admin service is not available."
    );
  ```

  Six of those routes resolve `datasource-admin`, so the message was right. Three
  resolve `external-datasource` — `GET /:name/remote-tables`, `POST /:name/test`,
  `POST /:name/object-draft` — and answered with the same sentence. An operator
  whose federation service was unwired was told to go look at `datasource-admin`,
  which was running fine.

  The code was never the bug. `SERVICE_UNAVAILABLE` is correct for all nine:
  ADR-0112's ledger asks generic conditions to reuse the standard catalog rather
  than register a per-service 503 synonym, and this module documents that decision
  inline. Which service is down is carried by `message`, exactly as intended — the
  `message` was simply wrong on three routes.

  Rather than parameterise the 503 helper and leave the name typed out a second
  time at each call site, the lookup and the message now come from one argument.
  The two `adminService()` / `externalService()` resolvers collapse into a single
  `resolve(res, service, method)` that answers the 503 itself, naming whatever
  service it just failed to resolve:

  ```ts
  const svc = resolve(res, "external-datasource", "listRemoteTables");
  if (!svc) return;
  ```

  Fixing the three messages needed only the parameter; taking the name from the
  lookup is what stops a tenth route reintroducing the mismatch. The per-route
  capability check is preserved — a host may wire a partial implementation, so
  "the service is registered" and "this route can use it" stay separate facts.

  Wire-visible change, on those three routes only: the 503 body's `error.message`
  now reads `The external-datasource service is not available.` — the same string
  `packages/rest/src/external-datasource-routes.ts` already emits for its own
  surface. Status and `error.code` are unchanged on all nine.

  Each of the nine 503s is now pinned to the service it names, driven through the
  real `HonoHttpServer` against a context that resolves services **per name**. The
  mock every existing test used answers the same object for every lookup, which is
  why nothing could see this: it cannot tell the two services apart. One case
  covers the operator's actual situation — `datasource-admin` wired and answering
  200s, `external-datasource` absent — including `POST /:name/test`, where the
  wired admin service has a `testConnection` of its own and must not answer for the
  external route.

  Pre-existing: #3843 carried every code string over verbatim and #3973 changed no
  bytes on the wire.

- 366105c: fix(service-datasource,rest): the last three uncovered datasource routes answer their registered refusal code (#4264)

  #4249 (fixed in #4263) gave the rest surface's two introspection routes a
  failure contract; this closes the same gap on the three sibling routes it left
  uncovered. Each had no `catch` around its service call, so a service throw was
  swallowed by the adapter and surfaced as the pre-#3675 non-envelope
  `500 { error: 'No response from handler' }` — no `success` flag, no
  `error.message`, no code to switch on, real cause lost.

  Wire-visible changes — each route now answers `400` in the declared envelope,
  under the refusal code registered (ADR-0112) for the service it dispatches to,
  with the service's own message at `error.message`:

  - `GET /api/v1/datasources` (`listDatasources` throw) →
    `400 DATASOURCE_ADMIN_ERROR` — matching its eight siblings in
    `service-datasource/admin-routes.ts`, which already answer their catches this
    way.
  - `POST /api/v1/datasources/:name/external/refresh-catalog` (`refreshCatalog`
    throw) and `POST /api/v1/datasources/:name/external/validate` (`validateAll`
    throw) → `400 EXTERNAL_DATASOURCE_ERROR` — the same code #4249 gave the two
    introspection routes one block above them.

  The issue left the code choice open (`INTERNAL_ERROR` was the alternative);
  the registered per-service codes win on consistency: every other catch in both
  modules — including pure reads — already answers 400 with the service-attributed
  code, and `refreshCatalog`'s dominant throw class (unknown datasource,
  unreachable remote, no such schema) is the one #4249 already adjudicated as a
  400 refusal on `listRemoteTables`. A 500 here would fork the failure contract
  within a module — the drift #4249 removed.

  No new codes: both were registered in the error-code ledger by #4263. The
  envelope-conformance suites and the `REFUSALS` pin table gain one row per
  route.

- bcf1112: fix(service-datasource,rest)!: external-datasource refusals answer their own error code (#4249)

  #4225 / #4234 fixed the 503 `message` on the three routes in
  `service-datasource/admin-routes.ts` that dispatch to `external-datasource`
  rather than `datasource-admin`. The identical mis-attribution survived one field
  over, on the 400 path — and machine-readably: one shared `badRequest` helper
  hard-coded `DATASOURCE_ADMIN_ERROR`, which the ADR-0112 ledger defines as a
  refusal _from the datasource-admin service_. So a `no such schema` raised by the
  external-datasource introspector was reported as datasource-admin's, and where
  #4225 misled a human reading prose, this misrouted a client switching on
  `error.code`.

  `EXTERNAL_DATASOURCE_ERROR` is now registered in the error-code ledger — under
  `@objectstack/service-datasource` and `@objectstack/rest`, the two packages that
  emit it; per the ledger's own rule the per-package rows are provenance, not
  identity — and `badRequest` takes the same `ServiceName` the route passed to
  `resolve` (#4234), so the code, like the 503 message, comes from the service the
  route actually dispatches to.

  Wire-visible changes:

  - **The three external-datasource routes' 400 `error.code`** —
    `GET /datasources/:name/remote-tables`, `POST /datasources/:name/test`,
    `POST /datasources/:name/object-draft` — is now `EXTERNAL_DATASOURCE_ERROR`
    (was `DATASOURCE_ADMIN_ERROR`). Status, envelope, and `error.message` are
    unchanged, as is everything on the six datasource-admin routes. No consumer
    branches on the old code (grepped both repos, all the ADR-0112 sweep forms).
  - **The rest surface's two introspection routes now have a failure contract at
    all.** `GET /datasources/:name/external/tables` and
    `POST /datasources/:name/external/tables/:remote/draft` carried no
    `try`/`catch`, so the very same service operations that answer 400 through
    the admin surface surfaced here as the adapter's non-envelope
    `500 { error: 'No response from handler' }`. They now answer
    `400 EXTERNAL_DATASOURCE_ERROR` in the declared envelope — one operation, one
    failure contract, on both paths. (`EXTERNAL_IMPORT_ERROR` on the import route
    is unchanged: a refused import is a different act from a failed
    introspection, and its name says so.)

  Why a new registered code rather than reusing one: ADR-0112's ledger asks
  _generic_ conditions to reuse the standard catalog — that argument carried
  #4225's 503, where `SERVICE_UNAVAILABLE` is correct for all nine routes and only
  the free-text `message` named the service. A refusal specific to one service is
  exactly what registered extension codes are for, and the closed `ErrorCode`
  union means correcting the attribution had to be a ledger edit. Widening
  `EXTERNAL_IMPORT_ERROR` to cover introspection was rejected because these are
  not imports; leaving the throws uncaught was rejected because the adapter's 500
  is not the declared envelope.

  The conformance rows that pinned the drift move with it, and each surface now
  pins the refusal code per route the way #4234 pinned the 503 message per route.

  Pre-existing, like #4225: #3843 carried every code string over verbatim.

- 974c6d4: fix(datasource): a `memory` datasource is ephemeral again, and each pool gets its own store (#4083)

  The shared driver factory built `new InMemoryDriver()` for `driver: 'memory'` with
  no config, so the pool inherited that driver's own `persistence: 'auto'` default —
  in Node, a file adapter at the **relative, process-global** path
  `.objectstack/data/memory-driver.json`. Two consequences, neither intended:

  - **It was not ephemeral.** The pool flushed its whole store into the server's
    working directory (on an unref'd 2s autosave timer, and again at teardown) and
    reloaded it on the next boot. That is the opposite of what the driver id
    promises the operator who asks for it — `OS_DATABASE_DRIVER=memory` is
    documented as _ephemeral, not real SQL_ — and it means a "throwaway" datasource
    left state in the deploy directory.
  - **Every memory pool in a process shared one destination.** The default path
    carries no per-datasource component, so two `driver: 'memory'` datasources
    loaded and saved the same file: each saw the other's tables, and the last
    teardown to flush clobbered the other's rows.

  Both were visible as an intermittent test failure. The ADR-0062 D1 federated-read
  acceptance seeds 2 rows into an auto-connected external memory datasource and
  reads them back; it returned 2 rows on a clean checkout and 2×N on the Nth run in
  the same tree — passing in CI (always run #1, always a fresh checkout) and
  failing locally for anyone who ran it twice. Whether a given run leaked depended
  on the autosave timer, which is what made it look flaky rather than wrong.

  - The factory now builds the memory pool with **`persistence: false` by default**.
  - It also **honors the datasource's own `config`**, which was previously dropped
    entirely: `initialData` and `strictMode` never reached the driver.
  - When an author _does_ opt into persistence (`config.persistence`), the default
    destination is **scoped to the datasource** —
    `.objectstack/data/memory-<name>.json` / `objectstack:memory-db:<name>` — so
    pools stay independent. An explicit `path`/`key`, or a custom `adapter`, is
    left exactly as written.
  - The dev-only sqlite step-down's last-resort in-memory driver
    (`resolveSqliteDriver`, #2229) is built the same way, making its own
    "not persistent" contract true.

  `InMemoryDriver`'s documented defaults are unchanged — constructing one directly
  still auto-detects persistence. Only the datasource-scoped pools this factory
  builds changed.

  **Migration.** A deployment relying on `driver: 'memory'` state surviving a
  restart was relying on a bug, and should declare it: set
  `config: { persistence: 'file' }` on the datasource (now written to a
  per-datasource file), or use a real driver — `sqlite`/`sqlite-wasm` give durable
  storage with real SQL. Existing `.objectstack/data/memory-driver.json` files are
  no longer read; delete them.

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

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

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
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
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
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
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
- Updated dependencies [d5749d7]
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
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 48c110e: feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

  #3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
  gaps survived that fix, both in the cases that still boot — a policy denial, an
  `autoConnect` datasource, or any failure the operator waved through with
  `OS_ALLOW_DRIVER_CONNECT_FAILURE`:

  - **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
    for every row — the contract declared three states and the implementation only
    ever emitted one — so a dead datasource looked exactly like a healthy-untested
    one. `checkDriversHealth()` could not help either: it iterates registered
    drivers, and a datasource that never connected was never registered, so it is
    _absent_ from the probe rather than unhealthy. The only trace was a warning
    that scrolled past at boot, which made the diagnostic procedure "restart the
    server and re-read the logs".
  - **The query-time error said nothing.** `getDriver()` answered four different
    situations with one sentence, `Datasource 'x' is not registered.`: refused by
    policy, failed to connect under the escape hatch, a misspelled name, and
    `active: false`. Only the third is an authoring bug, so the other three sent
    the reader hunting for a typo that does not exist.

  Both come from the same root: `connect()` already produced a `ConnectResult` for
  every attempt and every caller threw it away.

  - **`DatasourceConnectionService` retains the last verdict per datasource**, with a
    coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
    the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
    `disconnect()` drops it, so a removed pool stops explaining itself.
  - **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
    `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
    deliberate — a policy denial is a decision, not a fault, and will not clear on
    its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
    summary returned from create/update, so a "Save" whose pool failed to open is no
    longer presented as success.
  - **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
    from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
    recorded _why_ a declared datasource has no driver. An undeclared name keeps the
    original message — there is genuinely nothing to add. 503 rather than 500/400:
    nothing about the request is wrong, and the state may clear.
  - **A privileged/public split for the reason.** The error **never** carries the
    underlying cause — connect failures routinely contain hosts, ports and DSNs, and
    a policy's `reason` is written for operators. Those stay in the logs and the
    (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
    `publicReason` for hosts that want to tell tenants something specific
    (e.g. `'External datasources require the Scale plan.'`); it is the only string
    that reaches an end user.
  - **Readiness is deliberately not gated on this.** `/ready` still reflects
    registered-driver health only: an optional datasource being down must not pull an
    otherwise-working replica out of the load balancer.

  Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
  it. The ADR claimed D1 ("exactly one definition → live driver path") as
  implemented; only the _construction_ half converged. The `default` driver is still
  registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
  with its own failure verdict, pool teardown, and no connect policy. What blocks the
  merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
  _definition_ and builds the driver, while `default` arrives pre-built, and routing
  it through the service would make `ObjectQLPlugin`'s boot depend on an optional
  higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
  both paths to the same operator-visible contract (fail-fast by default, identical
  `OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
  to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
  it cost three months and a second bug report.

  **Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
  consumer exhaustively switching on it needs a case (the admin UI shows it as a
  distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
  were reported `'unvalidated'` now report their real state. Query-time errors for a
  datasource the connection layer recorded change from a generic `Error` to
  `DatasourceUnavailableError` (503 instead of the previous catch-all status);
  matching on the old `is not registered` text still works for the undeclared-name
  case, which is the only one that was ever accurate.

- 87aca93: fix(datasource)!: a declared datasource that objects bind to must connect, or the boot fails (#3758)

  `DatasourceConnectionService.handleFailure()` fail-fasted only for an `external`
  datasource with `validation.onMismatch: 'fail'`. Everything else degraded to one
  `warn` line — including the case the D2 auto-connect gate itself flags as having
  **no fallback path**: a datasource that objects bind to explicitly via
  `object.datasource`. Those objects never fall through to the `default` driver;
  `engine.getDriver` throws `Datasource 'x' is not registered` for them.

  So an app declaring `datasource: 'analytics'` with 20 objects bound to it, booted
  against a wrong `ANALYTICS_URL`, started clean and exited zero — and then failed
  every read and write of those 20 objects with an error that reads nothing like
  _the analytics database is unreachable_. The rest of the app worked, which made it
  **harder** to locate than a total outage: it looks like "some pages are broken",
  not like a misconfigured datasource. This is the same decision #3741/#3751 fixed
  one layer up in `ObjectQLEngine.init()`; the boundary here was still drawn in the
  old place.

  - **Fail-fast is now keyed on "no fallback path", not on `onMismatch` alone.** At
    the `declared-auto` (boot) trigger, a connect failure aborts the boot when the
    datasource is `external` + `onMismatch: 'fail'` **or** when ≥1 object binds to
    it explicitly. `autoConnect: true` with nothing bound stays lenient — that is
    "connect it if you can", and nothing declares a dependency on it. The
    runtime-admin create/update and boot-rehydration triggers are unchanged and
    still always degrade: a UI action must never brick a running server.
  - **Every failure mode counts**, not just an unreachable socket: an unresolvable
    `external.credentialsRef` (D3) and an unsupported `driver` leave the bound
    objects exactly as dead, so they take the same verdict.
  - **The error names the bound objects** (up to 10, then `+N more`) alongside the
    underlying cause, so the message points at the real problem instead of just the
    datasource name. The service already receives the list for post-connect
    `syncObjectSchema`.
  - **`connectDeclared()` attempts every gated datasource before throwing**, and
    aggregates, so one failed boot reports all the misconfigured ones rather than
    one per restart — the same shape as `ObjectQLEngine.init()`'s
    `DriverConnectError`.
  - **The escape hatch is shared with the engine guard**:
    `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` now also covers this path (and covers
    `onMismatch: 'fail'`, which previously had no opt-out). The operator intent is
    identical — "I know the database is unreachable, boot anyway" — and two flags
    would only guarantee one of them gets missed. When set, boot continues and a
    `DEGRADED BOOT` banner goes to stderr as well as the logger, because `os serve`
    swallows stdout during boot. `emitDegradedBootBanner` moved to
    `@objectstack/types` so both call sites share one implementation;
    `@objectstack/objectql` re-exports it unchanged.

  ADR-0062 D5 is amended with the new criterion and the shared flag.

  **Migration.** No change for a correctly configured deployment — a datasource that
  connected before still connects. A deployment that was _silently_ booting with a
  dead, explicitly-bound datasource now fails the boot instead, naming the
  datasource, the cause, and the objects that depend on it; fix the datasource
  configuration. To keep booting without it — deliberately, knowing every request
  touching those objects will fail — set `OS_ALLOW_DRIVER_CONNECT_FAILURE=1`.

- 19e3e6e: feat(runtime)!: the standalone `default` datasource is a declaration, connected through the one datasource path (#3826)

  ADR-0062 D1 asked for exactly one "definition → live driver" path. Construction
  converged earlier; the _connect + failure verdict_ half did not — the standalone
  `default` driver was pre-built and smuggled into the engine as a `driver.*`
  kernel service, so "what if it cannot connect" lived in `ObjectQLEngine.init()`,
  a second implementation of the policy `DatasourceConnectionService` owns for
  every other datasource. #3741 → #3758 showed what two copies cost: a fix to one
  missed the other for three months.

  - **`createStandaloneStack` now emits a datasource DEFINITION**, not a driver.
    URL→config translation and `mkdir` stay host concerns; the new
    **`DefaultDatasourcePlugin`** (exported from `@objectstack/runtime`) connects
    the definition at boot through the shared `DatasourceConnectionService` —
    same driver factory, same failure verdict, same retained state. It must be
    registered before `ObjectQLPlugin` (boot schema-sync needs the driver);
    `createStandaloneStack` orders it correctly.
  - **`sqlite-wasm` joined the shared driver factory** (`sqlite-wasm` /
    `wasm-sqlite` ids) — it was the last bespoke construction site.
  - **`bootCritical` on `ConnectableDatasource`**: the host declares a datasource
    the platform cannot run without; a boot connect failure is then fatal
    regardless of object bindings, sharing `OS_ALLOW_DRIVER_CONNECT_FAILURE` and
    the `DEGRADED BOOT` banner with the engine-level guard. A connect policy that
    denies a boot-critical datasource fails the boot loudly — the #3828 "denial is
    not a failure" boundary was drawn for optional datasources.
  - **`connect(record, { asDefault: true })`**: registers the built driver as the
    engine's default under its natural name (no `'default'` stamping — routing to
    `default` goes through the engine's default-driver fallback, and the natural
    name keeps logs/lookups byte-for-byte with the previous boot).
  - **`default` is a host-reserved name**: an app bundle declaring a datasource
    named `default` is rejected at load (`AppPlugin`), and the runtime-admin
    create rejects it too. It would shadow the host's primary datasource and, if
    it passed the auto-connect gate, silently divert every unbound object.
  - The primary DB now shows a REAL `status` in Setup → Datasources (#3827) —
    `ok` when connected, `error` + reason when the operator boots degraded.
  - `ObjectQLEngine.init()` is unchanged and keeps its fail-fast: it re-connects
    the already-connected default (every open-core driver's `connect()` is
    idempotent), which is exactly the boot verification #3741 wants.
  - `DriverPlugin` remains the escape hatch for tests and pre-built/proxy drivers
    (e.g. the CLI's `telemetry` datasource) — no longer how the standalone
    default boots. The CLI serve config-load fallback (`createStorageDriver`,
    incl. mysql/turso) still constructs directly; tracked in #3826.

  **Migration.** Boots through `createStandaloneStack` (CLI `serve`/`dev`
  artifact path, quickstarts, embedders using the stack factory) change shape but
  not behavior: same driver kinds, same URLs, same fail-fast semantics, same
  escape hatch. Embedders that composed `DriverPlugin` manually are unaffected.
  An app that declared a datasource literally named `default` now fails to load
  with a rename instruction — that name never routed correctly to begin with.

- 5cfd4d5: feat(cli): the serve storage fallback declares the default datasource instead of constructing a driver (#3826)

  The last open-core second site of "definition → live driver": when a host
  `objectstack.config.ts` supplies objects but no driver plugin, `serve` built a
  driver via `createStorageDriver` and registered it through `DriverPlugin`, with
  its connect and failure verdict landing in `ObjectQLEngine.init()` — the same
  split #3869 removed from the standalone stack.

  - **`createStorageDriver` is gone.** `resolveStorageDefinition` translates the
    driver kind + URL into `{ driverId, config }` (a pure host-side translation,
    like `standalone-stack`'s), and serve hands it to the runtime's
    `DefaultDatasourcePlugin` — same shared factory, same `bootCritical` failure
    verdict, same `OS_ALLOW_DRIVER_CONNECT_FAILURE` escape hatch, and the primary
    DB's real status in Setup → Datasources.
  - **`mysql`/`mysql2` joined the shared driver factory** (SqlDriver over
    `mysql2`; DSN or discrete fields, secret as password).
  - **Host-composition passthroughs**: the factory honours `config.autoMigrate`
    (the #2186 dev loosen-only self-heal, for the SQL kinds) and `config.persist`
    (the CLI's wasm `on-disconnect` mode). Connection builders ignore both keys.
  - **`turso`/libSQL fails loud at resolution**, same typed
    `UnsupportedDriverError`, same actionable message — nothing is constructed to
    fail later.
  - **The `telemetry` sibling datasource stays a pre-built `DriverPlugin`** — the
    documented escape hatch for named auxiliary drivers. Its provisioning now
    gates on the statically-known sqlite file path; the old coupling to the
    primary's _resolved_ engine is replaced by the telemetry provision's own
    step-down check, which already guarded the ABI-broken case.

  Verified end to end: a host-composed config (plugins + objects, no driver)
  boots through the declared fallback with the same banner labels; the artifact
  path (`dev:crm --fresh`) is table-for-table unchanged (71 tables, zero
  `no such table`).

  **Migration.** None for CLI users — same URLs, same env vars, same banner. The
  removed `createStorageDriver` was CLI-internal; `resolveDriverType`,
  `inferDriverTypeFromUrl` and `UnsupportedDriverError` are unchanged.

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
- Updated dependencies [840ee4b]
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
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [030125b]
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
  - @objectstack/types@17.0.0-rc.0

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

- f2063f3: fix(cli): extend native better-sqlite3 → wasm SQLite auto-fallback to the persistent-file / `--artifact` dev path (#2229)

  The native-`better-sqlite3` → wasm SQLite → in-memory step-down previously only
  guarded the zero-config `:memory:` dev branch of `serve`. A normal
  `objectstack dev` run never reaches it — `dev` injects a persistent `file:` DB
  (so AI-authored data survives restarts) and `--artifact` boots resolve sqlite
  through the datasource factory — both of which constructed
  `better-sqlite3` directly with no probe and no fallback. An ABI mismatch (e.g.
  a cached prebuilt binary built for a different Node version) was therefore not
  caught at boot and surfaced later as a runtime `Find operation failed` on the
  first query.

  The probe-by-connect + step-down is now hoisted into a shared
  `resolveSqliteDriver` helper (`@objectstack/service-datasource`) and applied to
  both previously-unguarded sqlite construction sites: the explicit `sqlite` /
  `file:` branch in `serve.ts` and the sqlite branch of the default datasource
  driver factory. better-sqlite3 loads its native addon lazily (first query), so
  the helper forces the load with a `SELECT 1` and, **in dev only**, steps down to
  wasm SQLite (real SQL + on-disk persistence — the same `file:` keeps working)
  then to the in-memory driver as a last resort, emitting the existing
  `⚠ native better-sqlite3 unavailable …` warning. In production the native driver
  is returned unprobed so a load failure surfaces loudly (fail-closed) rather than
  silently degrading to a different engine.

  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Minor Changes

- 49da36e: feat(datasource): fail-closed credential resolution at connect (ADR-0062 Phase 2, D3)

  `DatasourceConnectionService` now treats a declared `external.credentialsRef` as
  **fail-closed**: the credential must resolve to a cleartext secret (via the
  host's `SecretBinder` over `ICryptoProvider`) _before_ the driver is built. An
  absent secret store, or a ref that cannot be resolved/decrypted (missing
  `sys_secret` row, rotated key, or a throwing resolver), leaves the datasource
  **unconnected with a clear message** — never a silent build-without-secret that
  would connect with no/wrong auth or fail later with a confusing driver error.

  The same policy as connect failures applies: a code-defined `external` datasource
  with `validation.onMismatch: 'fail'` auto-connected at boot fails fast (bricks
  boot); runtime-admin create/update + boot rehydration degrade-with-warning. Code-
  and runtime-origin secrets converge on the one connection path (the same
  `SecretBinder` is threaded through the shared service). New `failed-credentials`
  connect status.

- ac79f16: feat(datasource): auto-connect declared external datasources (ADR-0062 Phase 1, D1/D2/D5)

  A declared external datasource is now connected to a live ObjectQL driver and its
  federated objects are queryable **with zero app code** — no `onEnable` driver
  wiring. Implements ADR-0062 Phase 1.

  - **D1 — one connect path.** New `DatasourceConnectionService` in
    `@objectstack/service-datasource` owns the single "definition → live driver"
    path: build via the injected driver factory → resolve `external.credentialsRef`
    via the `SecretBinder` → connect → `engine.registerDriver` under the datasource
    name → register the datasource def → sync each bound federated object's read
    metadata (DDL-free). Both origins converge on it: the runtime-admin
    `registerPool` now delegates here, and `AppPlugin` auto-connects code-defined
    datasources. Exposed as the `'datasource-connection'` kernel service.
  - **D2 — opt-in-safe gate.** A declared datasource auto-connects only when it is
    `external`, an object **explicitly** binds to it via `object.datasource`, or it
    sets the new `autoConnect: true` flag. A managed datasource that nothing
    explicitly binds (incl. ones referenced only by a `datasourceMapping` rule, e.g.
    `examples/app-crm`'s `:memory:` datasources) stays metadata-only — existing apps
    are byte-for-byte unchanged. See the ADR-0062 D2 implementation note.
  - **D5 — lifecycle, ordering & policy.** Connect happens in `AppPlugin.start()`
    (before the `kernel:ready` validation gate, relying on the kernel's
    init-all-then-start-all ordering). Fail-fast for a declared `external` datasource
    with `validation.onMismatch: 'fail'`; degrade-with-warning otherwise (and always
    for runtime-admin/rehydrate, so a UI action or replica blip never bricks the
    server). Adds a host-injectable `DatasourceConnectPolicy` (open-core default
    allows; a multi-tenant host binds a stricter fail-closed policy for egress
    isolation) consulted before every connect — one connect path, no cloud fork.

  Adds `datasource.autoConnect` to the spec. The legacy `onEnable` +
  `ctx.drivers.register` bridge remains supported as an escape hatch (idempotent vs.
  auto-connect). No behavior change for managed apps.

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

- bb04824: fix(build): don't bundle lazily-imported optional drivers (fixes build break from #1524).

  After moving optional internal `@objectstack/*` peerDependencies off `peer` (to
  stop the changesets fixed-group major cascade), tsup no longer auto-externalized
  them and began bundling the lazily `await import()`-ed driver packages — pulling
  in their optional native clients (`mysql` / `oracledb` via knex) and failing the
  build. Fix: `service-datasource` externalizes `@objectstack/driver-*` in tsup
  (kept as devDeps for tests); `plugin-dev` moves its framework packages to
  `dependencies` (auto-externalized; it's a dev-only plugin). Full build green.

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

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

### Minor Changes

- 2faf9f2: External Datasource Federation (ADR-0015) — Phase 2 (service core).

  Adds the federation service contract, the type-compatibility matrix, and a
  new service package that introspects, drafts, and validates federated
  objects:

  - `@objectstack/spec`:
    - `data/type-compat.ts` — dialect-aware SQL↔field-type matrix
      (`canonicalizeSqlType`, `suggestFieldType`, `isCompatible`) for
      postgres/mysql/sqlite/snowflake/bigquery/mongo.
    - `contracts/external-datasource-service.ts` — `IExternalDatasourceService`
      plus `RemoteTable`, `GenerateDraftOpts`, `ObjectDraft`,
      `SchemaValidationResult`/`Report`.
  - `@objectstack/service-external-datasource` (new): implements the service —
    `listRemoteTables`, `generateObjectDraft` (renders a reviewable
    `*.object.ts` with `// REVIEW:` markers), `validateObject`/`validateAll`
    (structured `SchemaDiffEntry` diffs), and `refreshCatalog`. Decoupled from
    the kernel via injected I/O; kernel plugin registers it as the
    `external-datasource` service.

  REST routes and the `os datasource` CLI commands follow in a subsequent
  slice.

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
