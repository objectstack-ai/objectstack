# @objectstack/driver-turso

## 17.0.0-rc.6

### Major Changes

- 29e28a3: refactor(drivers)!: `aggregate` 的 query 参数收窄到 `DriverQuery`，并退役 `aggregate` / `func` 两个未声明别名 (#6212 批 B、#6321)

  #5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上，#6212 批 A+E 处理了 SQL 驱动自有的另两道门。本次是同一条线上的 `aggregate`：`driver-sql`、`driver-turso` 的转发层与 `RemoteTransport` 三处，全部从 `query: any` 收到 `DriverQuery`（`@objectstack/spec/contracts`）。

  `any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`groupBy` 的节点联合、`aggregations` 的节点形状——而这三样恰恰是这几个方法体读的全部内容。

  ## 一、退役两个协议从未声明的别名（#6321，ADR-0049）

  ```ts
  const aggregates = query.aggregations || query.aggregate; // driver-sql
  const funcName = agg.function || agg.func;
  const aggregations = query?.aggregations || query?.aggregate || []; // RemoteTransport
  const func = String(agg.function || agg.func || "");
  ```

  `QueryASTSchema` 声明的是 `aggregations`，`AggregationNodeSchema` 声明的是 `function`；`aggregate` / `func` 在 `packages/spec` 里**一个字都没有**。实测全仓唯一书写者是这两个驱动包自己的 fixture（`sql-driver-advanced` 7 处、`sql-driver-queryast` 1 处、`sqlite-wasm-driver-advanced` 7 处、`sqlite-wasm-driver-queryast` 1 处），非测试面零书写者——#4984 那一家：**fixture 拼着别名，宽容分支就永远绿着活下去，没有任何测试能在删掉它时转红**。fixture 已按已声明拼写重拼，写者归零，PD#12 与 ADR-0049 enforce-or-remove 于是把这两条 `||` 一并删掉。

  顺带删掉的还有 `|| ''`：它只在**两个键都没写**时才生效，而那时这一面把名字回引成 `""`、本地面回引成 `"undefined"`，同一份越界输入两种措辞（#5240）。别名在时这条岔路够不着，删别名恰恰让它够得着，所以同一次关掉。

  **迁移**：`aggregate:` → `aggregations:`，`func:` → `function:`。写旧拼写的内联字面量现在是编译错误（TS2353）；越过 `tsc` 的 JS 调用方，`aggregate:` 会静默拿不到聚合列，`func:` 则拿到已有的具名 400（`INVALID_QUERY`，#5907）。本仓实测需要改动的非测试调用点为零。

  ## 二、一处真实行为改动：`RemoteTransport` 现在会编 `GroupByNode` 联合

  `GroupByNodeSchema` 是 `z.union([z.string(), z.object({ field, dateGranularity?, alias? })])`，而这一层把它当 `string[]` 读。收窄后 `tsc` 直接把这条假设摆上台面（TS2322）。联合的两半状况完全不同，所以这不是一个 cast 能了事的：

  - **无 granularity 的结构化条目**（`{ field: 'region' }`）是 spec 合法、且**今天就会下推到驱动**的形状：objectql 的 aggregate 派发对它一律判为「受支持」（`engine.ts` 里逐字写着 `plain {field} object is fine`），`objectql/src/secret-fields.test.ts:341` 就是这个形状的活体。本驱动的**本地面**把它编成普通的 `GROUP BY "region"`，远端面却把它插值成 `"[object Object]"`、死在标识符安全检查里——一条查询两种答案、由连接串决定，正是 #6203 那个形状，而且**是活体不是休眠**：能力位 `queryDateGranularity` 只管带 granularity 的那一半，管不到这一半。现在读 `.field`，两面收敛。
  - **带 dateGranularity 的条目**远端确实编不出来，而这一点是**已声明**的：remote 模式发布 `queryDateGranularity: {}`，引擎据此全部落到内存分桶，因此不会下推。缺的是「绕过能力位、直连驱动」的那个调用方该得到什么答案——现在得到 ADR-0112 信封（`NOT_IMPLEMENTED` / 501），与聚合函数「协议已声明、本后端编不出」用的是同一类，而不是一句 SQL 注入告警。

  `alias` **不读**，与本地面一致：`SqlDriver.aggregate` 也不读它，只在这一面读会是新的分叉而不是修复。

  ## 三、`SqlDriver` 那一面的同一条件也换上了信封

  `SqlDriver.aggregate` 对「本方言编不出这个 granularity」原本抛裸 `Error`（`code`/`status` 皆 `undefined` ⇒ `mapDataError` 落默认分支，一个具名能力缺口以不透明 500 到达调用方）。只给远端面加信封就会造出 #5907 花一整个 issue 才关掉的那种分叉——`TursoDriver` 由 `url` 选面，同一条件不能有两种线上身份。两面首句逐字一致（`Date bucketing by '<g>' is not supported by this backend.`），尾句各报**本面**编得出的 granularity，由一条跨包 parity 用例比对两个**运行时**消息钉住。

  **消息文本变更**（可能影响按文本匹配的下游断言）：

  ```
  - SqlDriver: dateGranularity 'week' not supported on dialect 'better-sqlite3'. Engine must fall back to in-memory bucketing.
  + Date bucketing by 'week' is not supported by this backend. Bucketed here: day, month, quarter, year (dialect 'better-sqlite3'). … (code=NOT_IMPLEMENTED, status=501)
  ```

  ## 定级依据

  标 major 与 #5181 / #6075 / #6210 一致：**源码级破坏性**（调用点内联字面量、以及被删的两个别名键），加上第二、三节两处真实的运行期改动。`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

  `driver-sqlite-wasm` 未列入：它整个继承 `SqlDriver.aggregate`，自身源码零改动（改的只有它的 fixture 与一条断言）——与批 A+E 的处理一致。它读的是 driver-sql 的 `dist/*.d.ts`，因此验证时**必须先重建 driver-sql** 再 typecheck/test，否则是假绿。

  <!-- adr-0087: registered driver-aggregate-undeclared-key-aliases-removed -->

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

- 92a67f2: feat(drivers,spec)!: `GroupByNode.alias` is honoured by the SQL faces — one aggregate, one column key (#6401)

  `GroupByNodeSchema` has declared `alias` ("Alias for the projected group
  value", defaulting to `field`) for as long as the structured `groupBy` entry has
  existed. Exactly one execution path read it. The result: the SAME query came
  back with a different result-column key depending on which path the engine
  happened to take.

  ```ts
  groupBy: [{ field: "closed_at", dateGranularity: "month", alias: "qtr" }];
  ```

  - pushed down to a driver ⇒ rows keyed **`closed_at`**
  - run through the in-memory fallback ⇒ rows keyed **`qtr`**

  And the choice between them is `engine.ts`'s
  `allStructuredSupported && !tzRequiresInMemory` — a driver capability bit and a
  `timezone`, neither of which the caller can see. That is the multi-face
  consistency invariant broken in its quietest form: both answers are valid rows,
  so nothing throws and nothing looks wrong.

  **Resolved to ENFORCE**, and the leg was chosen by measurement rather than
  taste. ADR-0049 splits on whether the feature already exists: a _dangling_
  promise is removed, a _live_ one with a missing gate is enforced. `alias` is
  live — three consumers read it and change behaviour
  (`in-memory-aggregation.ts`, `MemoryDriver.performAggregation`, and
  `chartAggregateCategoryKey`), and the publish gate _compels_ it:
  `validate-react-page-props.ts` errors `REACT_CHART_AXIS_UNKNOWN` unless a
  chart's category axis is bound to `alias ?? field`, telling the author in so
  many words to "bind it to" the alias. A key the build gate makes you write is
  not a dangling promise. The count of real non-test producers is **zero**, which
  is what makes enforcing safe rather than what argues against it: no shipped
  payload changes its result keys.

  **What changed, on every SQL face at once** — a fix landing on one and not its
  twin is the #6203 shape, and `TursoDriver` picks its face from `url`:

  - **`driver-sql`** — both limbs of the structured `groupBy` branch project
    `alias ?? field`: the date-bucket limb aliases the bucket expression to it,
    and the plain limb emits `?? as ??` (only when the name actually moves — an
    alias equal to the field emits no self-rename). `presentedOutput` is now keyed
    by the OUTPUT column, matching how the aggregation branch beside it has always
    worked; an aliased group value went unpresented before.
  - **`driver-turso` REMOTE** — the same projection, `"field" AS "alias"`. The
    alias reaches the statement as a quoted identifier and is therefore held to
    `assertSafeIdentifier`, exactly like `field`.
  - **`driver-sqlite-wasm`** — inherits `SqlDriver`'s compiler; covered by its own
    conformance suite rather than by assumption.

  **GROUP BY still keys on the FIELD** on every face. Only the projection is
  renamed, so the buckets are unchanged. This is deliberate and pinned: SQLite
  resolves output names in `GROUP BY`, so a face that grouped by the alias would
  look correct here and diverge on a dialect that does not.

  `having` needed no change and now means one thing: it is applied over the
  aggregated row's own columns, so a filter on a group projection references the
  alias on every path — previously the alias on one path and the field on the
  other.

  **Conformance.** `AGGREGATION_CASES` (#6409) gains a `groupByAlias` axis and two
  cases. Their VALUES are an existing case verbatim — only the key moves — so they
  can fail only on the key, which is the point: every wrong answer in this area is
  a valid query returning plausible rows. `objectql`'s in-memory fallback is now
  **enrolled** as a fourth face, answering #6409's open question ②: it is the face
  the SQL three were converged onto, so the new behaviour would otherwise be
  pinned against nothing, and reaching it needs no engine at all —
  `applyInMemoryAggregation` is a pure function of rows and an AST.

  **Reverse verification**, predicted before running. Reverting the in-memory face
  to `g.field`: only the two alias cases move and only ONE fails — the degenerate
  `alias === field` case stays green, which is why both are in the table.
  Reverting the harness to read `c.groupBy` instead of `c.groupByAlias ?? c.groupBy`
  — the copied-neighbour mistake: everything passes on an unmodified face, a false
  GREEN, which is the failure mode that would have made the axis vacuous.

  **Frozen drivers (#5499), measured from source, not flipped.** `driver-memory`
  already returned `{ field, alias: node.alias ?? node.field }` and projects under
  the alias — it had independently reached the enforce answer, so it needed no
  alignment. `driver-mongodb` is a recorded DEBT row and the defect is wider than
  `alias`: `buildAggregationPipeline` types `groupBy` as `string[]` and builds
  `groupId[field] = '$' + field`, so a structured node — aliased or not — becomes
  the literal key `"[object Object]"`. It cannot take a structured `GroupByNode`
  at all; `mongodb-driver.ts` passes `(query as any).groupBy`, which is why `tsc`
  never saw it. Tracked on #6814.

  **Compatibility.** A caller who writes `alias` and reads the result under
  `field` on a pushdown path will now find the value under `alias` — which is what
  the key has always meant on the fallback path, and what the chart gate already
  required. Callers who never write `alias` are unaffected: the emitted SQL is
  byte-identical.

  <!-- adr-0087: not-required (no-migration-prescription) Nothing is retired: `GroupByNodeSchema.alias` keeps its declaration, its spelling and its type — it starts being HONOURED by three faces that parsed and ignored it. There is no tombstone to write and no authored metadata to rewrite, so there is no mechanical transform a migration could prescribe: every stack that validated before validates after, unchanged. The behaviour change is in the RESULT of a runtime query (a result-column key moves from `field` to `alias` on the pushdown path, converging on what the in-memory path and the chart publish gate already required), which the ledger has no channel for and no upgrader could apply a codemod to. The bang is on the changeset because callers who read that column by the field name must move, and the measured non-test producer count for the key is zero. -->

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

- 3172831: fix(drivers): text-operator case folding is the CONTRACT's answer, not the dialect's (#6518)

  The `$contains` family and `$icontains` returned **different rows on different
  databases** for the same filter, because case sensitivity was decided by whatever
  `LIKE` happened to mean on the dialect underneath. Both directions **over-matched**
  — they returned rows the filter excludes, which on an ADR-0021 RLS read scope is
  over-reach rather than a loose filter (#3948):

  |                              | `$contains` / `$notContains` / `$startsWith` / `$endsWith` — case-SENSITIVE (#4706 Q2 = A) | `$icontains` — folds ASCII ONLY (#4706 Q1 = A) |
  | :--------------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------- |
  | SQLite / turso / sqlite-wasm | ❌ `LIKE` folds ASCII                                                                      | ✅ `lower()` is ASCII-only                     |
  | Postgres                     | ✅ `LIKE` is case-exact                                                                    | ❌ `LOWER()` folds all of Unicode              |
  | MySQL                        | ❌ follows the column's collation                                                          | ❌ `LOWER()` folds all of Unicode              |

  Read across: **each dialect was already right on the half another one got wrong**,
  which is why neither half could be found from one backend alone.

  ## What now runs

  The construct is chosen per dialect, in one emitter, so the escaping and the fold
  stay a single code path (an unescaped wildcard is a filter bypass, P0 — #5567):

  - **SQLite family → `GLOB`.** `LIKE`'s ASCII fold cannot be switched off per
    statement (`PRAGMA case_sensitive_like` is connection-global, so one query would
    redefine every other query on the connection), and `CAST(col AS BLOB) LIKE ?` was
    measured to match _nothing at all_. `GLOB` is case-exact and brings its own
    escaped class — `*`, `?`, `[` as the self-closing classes `[*]`, `[?]`, `[[]`,
    because SQLite's grammar gives `GLOB` no `ESCAPE` clause. `$icontains` keeps
    `lower()` on both operands, still ASCII-only.
  - **Postgres → `LIKE`, unchanged.** Only the fold moved, from `LOWER()` to an
    explicit `translate()` over the 26 ASCII letters. Measured on a live PostgreSQL
    16 (ICU database): `LOWER('CAFÉ')` is `'café'` — the over-fold — while the
    `translate()` form leaves `É` alone.
  - **MySQL → `LIKE` over `CAST(… AS BINARY)`**, so the comparison is byte-wise and
    no collation decides the case; `$icontains` folds byte-wise over the same binary
    rendering, which is ASCII-only because UTF-8 is self-synchronising.
  - **Any other client** keeps the previous `LIKE` / `LOWER()` shape — it is the only
    form that still runs there — and is recorded as residue rather than left to be
    discovered.

  `driver-turso`'s remote transport carries the twin (it compiles filters itself and
  inherits nothing), and the two transports are now held to the same rows by a
  parity suite that runs the shared `FILTER_TEXT_CASES` on both.

  ## Behaviour change — read this before upgrading

  A filter whose comparand's case did not match the stored text used to match on
  SQLite/turso/sqlite-wasm and may have matched on MySQL. It no longer does:

  ```ts
  // rows: { id: '1', name: 'ACME Corp' }, { id: '2', name: 'acme corp' }
  {
    name: {
      $contains: "acme";
    }
  } // was ['1','2'] on SQLite → now ['2'] everywhere
  {
    name: {
      $icontains: "acme";
    }
  } // ['1','2'] — unchanged, and now correct on PG/MySQL too
  {
    name: {
      $icontains: "café";
    }
  } // was ['3','4'] on PG/MySQL → now ['4'] everywhere
  ```

  If you were relying on `$contains` to ignore case, **write `$icontains`** — that is
  the operator for it, and it now folds the same ASCII-only range on every backend.
  Result sets only ever get NARROWER, never wider, so a filter that was already
  correct stays correct.

  ## Why `minor` rather than `major`

  No declared surface moves. `$contains` still exists, still takes the same
  comparand, and `filter.zod.ts` is untouched — the case-sensitivity this delivers
  was **already published** as the contract by #5701 (`FILTER_TEXT_CASES`, one
  release earlier in this same v17 major), and the drivers were the half that had
  not caught up. This is Prime Directive #12 applied in the direction it points:
  declared = enforced. It is graded the way its sibling #5702/#6549 was graded for
  the same operator family in the same rc cycle, and it registers nothing in the
  ADR-0087 registries because it retires no authorable key.

  ## What is deliberately NOT in this change

  `driver-memory` and `driver-mongodb` still fold case on their query paths — they
  are the #5499 frozen family, so their `FILTER_TEXT_CASES` cells stay honest DEBT
  and are tracked as #6682 (case sensitivity) and #6520 (`$icontains`). The
  `service-analytics` SQL compilers were measured already compliant: they emit
  Postgres-shaped statements, where `LIKE` is case-exact, and that assumption is now
  written down and pinned rather than implied.

- 17a0a1e: fix(driver-turso): the remote face refuses an `auto_number` create instead of silently writing NULL (#6944)

  `TursoDriver` picks its transport from `url`. Local and embedded-replica inherit
  `SqlDriver`'s write path and issue record numbers from the persistent
  `_objectstack_sequences` table. Remote overrides the write path to
  `RemoteTransport`, which builds its own `INSERT` and never enters
  `fillAutoNumberFields` — so on that face `auto_number` was only a column mapped
  to `TEXT`, and the slot the engine deliberately leaves empty stayed empty.
  Measured on `main` @ `2f3e79351`:

  ```
  REMOTE create      -> RESOLVED case_number=null
  REMOTE bulkCreate  -> RESOLVED [null, null]
  REMOTE upsert      -> RESOLVED case_number=null
  LOCAL  create      -> RESOLVED case_number="CASE-00001"
  ```

  Nothing upstream caught it. `supports.autonumber` is `true` on this face
  (inherited via `...super.supports`), so the engine defers generation to the
  driver entirely and never runs its own fallback — `engine.ts` already records
  `driver-turso` in its driver table as "inherited, no fallback path". A driver
  face that boots and quietly fails to deliver a declared capability is the shape
  #3724 ruled on; triage applied that ruling here on 2026-08-09 as **disposition
  B — explicit refusal**. Implementing autonumber on the remote transport (A)
  stays deferred for want of measured demand.

  ## What changed

  `TursoDriver.create` / `bulkCreate` / `upsert` now refuse, in remote mode, a
  write that would need a record number this face cannot issue:

  ```
  NOT_IMPLEMENTED / 501
  Object "crm_case" declares auto_number field(s) [case_number] left empty for
  this create, and the Turso REMOTE transport does not generate record numbers. …
  ```

  `NOT_IMPLEMENTED` / 501 is the same class this package already gives an
  aggregate function it cannot compile (#5907) or a date bucket it cannot emit
  (#6212), for the same reason and per ADR-0112: `autonumber` is a field type
  `@objectstack/spec` declares and this very driver's other faces generate, so the
  caller's object definition is correct and the gap is the backend's.

  The refusal is raised on `TursoDriver`, not inside `RemoteTransport`, because
  the transport cannot see what it would need in order to decide:
  `RemoteTransport.create(object, data)` takes no schema and caches none. The
  driver can — `registerRemoteFieldMetadata` → `registerExternalObject` classifies
  every field at remote schema-sync time and populates `autoNumberFields`,
  measured live in remote mode.

  ## What is deliberately NOT refused

  - **A record that already carries a value in the slot.** That is the `isSystem`
    seed replay and the `preserveAudit` historical import, which the engine
    exempts from its strip on purpose (#5503); on this face they were, and remain,
    written through unchanged and correctly. The generate predicate
    (`undefined` / `null` / `''`) is `fillAutoNumberFields`' own, reused rather
    than re-derived.
  - **A merging upsert.** `RemoteTransport.upsert` emits
    `INSERT … ON CONFLICT DO UPDATE`, so a row that matches keeps the number
    already in its column — measured. Only the provably-inserting shape (no `id`,
    no explicit conflict keys, so the transport mints a fresh id for the sole
    merge key) is refused. An id- or conflict-key-bearing upsert that turns out to
    insert is a known residue: classifying it needs the round trip the refusal
    exists to avoid, and it is pinned as such in the suite.
  - **Local and embedded-replica.** Both still generate; pinned across all three
    faces so the refusal cannot leak onto the wrong one (#6203).

  `packages/drivers/driver-turso` only. `driver-memory` / `driver-mongodb` sit
  inside the #5499 freeze and declare no `supports.autonumber`; they take the
  engine's own fallback path and are unrelated.

### Patch Changes

- e120a5a: feat(drivers): lower `count_distinct` on the SQL family (#6409)

  `count_distinct` has been declared by `AggregationFunction` since the enum was
  written, and until now no SQL backend compiled it: both faces of the SQL family
  refused it with `NOT_IMPLEMENTED` / 501. A dashboard measure asking for a
  deduplicated count against a SQL datasource got a capability-gap refusal for a
  query that was already correct.

  This is the ENFORCE half of #6188's split ruling (maintainer, 2026-08-07).
  `array_agg` and `string_agg` took ADR-0049's remove leg and left the enum in
  protocol 17 — no SQL backend compiled them and `string_agg` had no single shape
  to lower to. `count_distinct` was deliberately kept on the other side of that
  split, on the strength of having exactly one portable lowering. That lowering
  now exists:

  - **`driver-sql`** — `SqlDriver.aggregate` emits `count(distinct "column")`, on
    every dialect the driver targets.
  - **`driver-turso`** — `RemoteTransport.aggregate` emits the same, on the remote
    path. Both faces in one change, deliberately: `TursoDriver` picks between them
    from `url`, so a lowering that landed on one alone would mean one query
    answering two ways depending on a connection string.

  **Semantics: distinct NON-NULL values of the target column** — the standard
  `COUNT(DISTINCT col)` answer, and the same one `objectql`'s in-memory fallback
  and `service-analytics`'s SQL strategy already give.

  **`field` is now required for `count_distinct`.** `AggregationNodeSchema` makes
  `field` optional because `COUNT(*)` is a real spelling, but `COUNT(DISTINCT *)`
  is a syntax error in every dialect. A `count_distinct` aggregation with no
  `field` is refused up front with `INVALID_QUERY` / 400 and a message naming the
  fix, rather than being sent to the database and coming back as an opaque 500.
  Plain `count` with no `field` still means `COUNT(*)`, unchanged.

  **The refusal message no longer names `count_distinct` as unsupported.** Both
  faces build their "Compiled here:" list from their lowering table, so the
  message now lists it among the functions that work. With this entry the declared
  aggregate vocabulary and the SQL family's compiled vocabulary are the same set.

  **New shared conformance table.** `AGGREGATION_CASES` / `AGGREGATION_ROWS`
  (`@objectstack/spec/data`) is the standard both SQL faces are now run against —
  values over one fixture carrying duplicates and nulls, so a lowering that lost
  the dedup or counted NULL as a value fails on a number rather than passing a
  SQL-string assertion. `driver-memory` and `driver-mongodb` are inside the #5499
  freeze and are not enrolled; the table records what each would answer and why,
  rather than omitting them.

- e195092: test(verify): `checkDateBucketParity` / `checkReadCoercion` 的调用点不再 `as never`，替身的编译期检查恢复生效 (#6354)

  `@objectstack/verify` 用 `BucketableDriver` / `CoercibleDriver` 两个**结构替身**表达「被测驱动确实具备这组方法」。这是一个**已发布**的契约面——仓外驱动（cloud 的 `driver-turso`）照着它实现自己的一致性测试。但全仓 **10 个**调用点无一例外把驱动 `as never` 之后再传进去，于是这件事**一次也没有被检查过**：替身存在的全部意义，被 100% 的调用点关掉了。

  本次逐处删掉这 10 个 cast，一个不留：

  - `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts` **6 处**（真实 `SqlDriver` / `SqliteWasmDriver` 1 处，负向控制的假驱动 5 处）
  - `packages/drivers/driver-turso/src/date-bucket-parity.test.ts` **2 处**（`TursoDriver` 本地模式 + 那条 `week` 绊线）
  - `packages/qa/dogfood/test/read-coercion-conformance.test.ts` **2 处**（`checkReadCoercion` 同族，同形且同样是死 cast）

  **零运行时改动，零新增逃逸口**——只删不加，全程未引入任何 `as any` / `as unknown as` / `@ts-expect-error` / `as never`。三个包 typecheck 全绿：这些 cast 每一个都是死的，替身与真实驱动的形状本来就一致，被抹掉的只是**说出这件事**的能力。

  代价原本是休眠的，也正因为休眠才值得修：哪天某个驱动少掉替身要求的一个方法、或替身自身长出新成员，10 个调用点一个都不会红，`checkDateBucketParity` 会在运行期抛 `driver.aggregate is not a function`，而不是在 `tsc` 里被拦下。对仓外驱动作者而言，这个替身是他们唯一能对照的形状说明书，而说明书此前从不校验。

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

- bee5ffe: drivers: every SQL read door routes through the tenant chokepoint (#6792)

  `SqlDriver.applyTenantScope()` owns read-side tenant isolation for the whole SQL family —
  the `tenantId` early-out, the "object has no tenant field" early-out, the NULL-org
  platform-row rule (#2734) and the ADR-0105 D2 union posture (#3623). Its own docstring
  said "every CRUD method routes through it". Nothing ever checked that, and it was false
  for as long as it had existed. **Three** read doors built their query through
  `getBuilder()` and never arrived:

  - **`findWithWindowFunctions()`** — the documented #4286 window door. It returns **rows**,
    so on a deployment where the scope would have applied (`options.tenantId` set, object
    has a tenant field) it returned rows belonging to **every** tenant. Measured with two
    tenants seeded plus one NULL-org platform row: `tenantId: 'org_a'` returned
    `[a1, a2, b1, b2, p1]` here against `find()`'s `[a1, a2, p1]` — another tenant's rows,
    handed over at the driver layer.
  - **`analyzeQuery()` / `explain()`** — returns a **plan**, not rows, so this is a smaller
    fix and it is made on its own merits rather than folded into the one above. It is the
    same defect #6577 fixed on these two methods one builder line lower: a plan is only
    worth reading if it explains the statement `find()` would actually run, and a missing
    tenant predicate changes selectivity and therefore which index the planner picks.
    Compiled `select * from account` where `find()` sent the `organization_id` clause.
  - **`distinct()`** — returns one column's **values** for every tenant. This one was in no
    card. #6792 states the opposite, listing `distinct` among the scoped call sites; the
    13th read site is `aggregate()`. It was found by measuring the invariant rather than
    re-reading it.

  All three now call `applyTenantScope()` beside their `getBuilder()` line, the position
  `findRows()` uses. They route through the chokepoint rather than re-deriving a predicate:
  a local equality would silently drop NULL-org platform rows (#2734) and collapse group
  reads to active-org reach (#3623). Both of the chokepoint's early-outs are inherited
  unchanged, so an unscoped admin/seed read (no `tenantId`) and any object without a tenant
  field behave exactly as before.

  **The durable half is a gate, not the three lines.** `pnpm check:tenant-chokepoint`
  (`scripts/check-tenant-chokepoint.mjs`, wired into `.github/workflows/lint.yml`) re-derives
  the invariant from the AST across the `SqlDriver` family on every run: a method that builds
  through `getBuilder(object, options)` must call `applyTenantScope()` on that builder, or
  carry a written exemption. Insert builders are exempt structurally — write-side tenancy is
  `injectTenantOnInsert` — rather than by a name list. It is keyed on the **builder** and not
  on the method signature, because the signature criterion the card sketches ("takes
  `(object, …, options)` and returns rows") misses `distinct` (no `query` parameter) and
  `analyzeQuery` (returns a plan). Verified red against the pre-fix tree, red against a
  newly-added unscoped door, and silent once that door is scoped.

  The chokepoint docstring no longer asserts the invariant; it names the gate that proves it.

  If you call these doors directly on a multi-tenant deployment, pass `options.tenantId` as
  you would to `find()` — that is what now takes effect. Callers that never passed it are
  unaffected; that remains the documented unscoped/admin path.

- 939f579: drivers(sql,turso): 聚合函数拒收带上 ADR-0112 信封,并把两类条件分开措辞

  `SqlDriver.mapAggregateFunc()` 与 `RemoteTransport.aggregate()` 此前对同一条件各抛一个裸
  `Error`(`code`/`status` 皆 `undefined`),`mapDataError` 因此落默认分支——一条本该 4xx 的
  调用方错误以不透明 500 到达客户端。两处同时改,同一信封体例、首句逐字一致(#5240):

  - **协议未声明的函数名**(如 `median`)→ `INVALID_QUERY` / 400。这正是协议门
    (`metadata-protocol` 的 `invalidQueryError`,#4254)对同一条件已经给出的码,于是
    进程内调用方与 REST 调用方读到同一个答案。
  - **协议已声明、本后端编不出**(`count_distinct` / `array_agg` / `string_agg`)→
    `NOT_IMPLEMENTED` / 501。这是能力缺口而不是调用方的错(`driver-mongodb` 编得出这三个),
    措辞明确说明查询拼写无误,不把作者说成打错字。

  两面都只改拒收的身份:编得出的五个函数生成的 SQL 逐字节不变。

- 67e935c: drivers(turso): remote 聚合函数名不再大小写归一化,两面只认协议声明的小写拼写 (#6203)

  `TursoDriver` 按连接串 `url` 选面:本地/副本继承 `SqlDriver`,远程委派 `RemoteTransport`。
  两面此前对聚合函数名的归一化不一致 —— remote 先 `.toLowerCase()` 再查自己的编译表,local
  拿到什么查什么。于是同一个驱动、同一条查询,答案取决于连接串:

  ```
  COUNT   REMOTE -> RESOLVED "SELECT count(\"stage\") AS \"n\" FROM \"deal\""
          LOCAL  -> THREW    INVALID_QUERY / 400
  ```

  本次删掉 remote 侧的 `.toLowerCase()`。`AggregationFunction` 是**大小写敏感**的 `z.enum`
  (`AggregationFunction.parse('COUNT')` 直接抛错),`COUNT` 是协议从未声明的拼写,remote
  多认的是一种私有方言;按契约优先(PD#12)收紧消费端,而不是把方言固化成第二套事实契约。

  **升级说明(user-visible)**:remote 连接不再接受大写或混合大小写的聚合函数名。
  `COUNT` / `Count` / `SUM` 等此前在 remote 能编出 SQL 的拼写,现在与 local 一样统一落
  `INVALID_QUERY` / 400(「不是已声明的聚合函数」)。**作者侧修法是改用小写** —— 把
  `aggregations[].function` 写成协议声明的 `count` / `sum` / `avg` / `min` / `max`
  (以及已声明但本后端未实现的 `count_distinct` / `array_agg` / `string_agg`)。

  经 REST/协议门进来的查询不受影响:大写拼写在 `AggregationNodeSchema` 就被拒,到不了驱动;
  仓内亦无任何发送大写拼写的调用方。受影响的只有绕过 spec 校验、直接调用远程驱动且依赖该
  归一化的进程内调用方。

  `#5907` 落地的拒收信封(第 1 类 `INVALID_QUERY`/400、第 2 类 `NOT_IMPLEMENTED`/501、
  按调用方原始拼写分类)与默认 alias 的拼法均未改动。

- fa2d3b7: fix(driver-turso): narrow every override's `options` from `any` to `DriverOptions` (#6402)

  `TursoDriver` overrides 17 methods that take an `options` argument, and every one
  of them declared `options?: any` while the base it forwards to (`SqlDriver`, and
  behind it the `IDataDriver` contract) declared `DriverOptions`. The keys
  `DriverOptions` names — `bypassTenantAudit`, `tenantId`, `transaction`,
  `accessible_org_ids`, `skipCache`, `timeout`, … — were therefore unchecked at all
  17 doors.

  The argument is #5181's, one axis over. An internal caller that misspells
  `bypassTenantAudit` gets no runtime complaint: the typo'd key is simply never
  read, the write proceeds unaudited, and nothing anywhere says so. `tsc` is the
  only channel that ever objects, and `any` had switched it off. Nothing is known
  to have gone wrong through this gap — it is closed because the door was open, not
  because someone walked through it.

  **Why all 17 at once.** The shape was character-identical across every override,
  so narrowing a subset would read to the next person as a _verdict_ on the rest.
  That is not hypothetical: #6075 (PR #6210) narrowed `count`'s `query` and
  deliberately left its `options`, and #6212 batch B did the same on `aggregate` —
  each leaving a comment saying so. Those comments are now discharged. The three
  prior narrowings (#5181 / PR #6076, #6075 / PR #6210, #6212) each closed the
  `query` axis; this closes the `options` axis, which had never been touched.

  **Consumer impact.** Annotation-only — no runtime behaviour changes, and the full
  monorepo typecheck is unchanged at 125/125 green, so no caller in this repo was
  passing an off-contract value. It is a `patch` rather than a docs-only change
  because the narrowed signatures are public: a downstream TypeScript consumer
  holding a `TursoDriver`-typed reference and passing an `options` value that is not
  a `DriverOptions` will now see a compile error where it previously saw none. That
  error is the point — the value was already being ignored by the driver.

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
- Updated dependencies [29e28a3]
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
- Updated dependencies [db12b88]
- Updated dependencies [6f6fec7]
- Updated dependencies [7d1ff75]
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
- Updated dependencies [d367f03]
- Updated dependencies [45e711a]
- Updated dependencies [465a0fa]
- Updated dependencies [6de592c]
- Updated dependencies [d254421]
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
- Updated dependencies [ef678d0]
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
- Updated dependencies [6146b67]
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
- Updated dependencies [82397b6]
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
- Updated dependencies [3264516]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [62159bd]
- Updated dependencies [d48aad5]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [bee5ffe]
- Updated dependencies [3172831]
- Updated dependencies [939f579]
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
  - @objectstack/driver-sql@17.0.0-rc.6
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
  - @objectstack/driver-sql@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

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

- 05bb200: feat(driver-turso): remote 模式补上 canonical 时间列 backfill 通道(分批、可恢复、完成标记) (#5770)

  `SqlDriver.backfillCanonicalDatetimes` / `backfillCanonicalTimes` 是 Knex 路径,
  remote 模式的 DDL 与 CRUD 全部走 `@libsql/client`,永远到不了它们。于是
  `canonicalDatetimeFields` / `canonicalTimeFields` 在 remote 恒空,
  `needsLegacyDatetimeRepair` 恒为 true。在 `origin/main`(`d82b85fee`)上实测:

  ```
  canonicalDatetimeFields['probe']            -> undefined
  needsLegacyDatetimeRepair('probe','at')     -> true
  temporalFilterColumnSql('probe','at','"at"')
    -> (case when typeof("at") in ('integer','real')
          then strftime('%Y-%m-%dT%H:%M:%fZ', "at"/1000.0, 'unixepoch')
          else coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', "at"), "at") end)
  ```

  每一次对 `Field.datetime` / `Field.time` 的 filter 都编译成这个表达式 —— 正确,但
  **不可索引**。local 跑完 backfill 能退回 `col >= ?`,remote 此前没有这个出口,
  代价是永久的(cloud#1005 后果 A)。

  **后果 B 实测比原单描述更尖锐。** `RemoteTransport.mapFieldTypeToSQL` 把时间列声明为
  TEXT,#942 之前的 remote 写路径原样透传数字,于是 epoch 毫秒落盘成
  `'1753660800000.0'`。共享修复表达式按 `typeof(col) in ('integer','real')` 分派,
  TEXT 亲和列永不命中该支;`strftime` 也解析不了这串数字,`coalesce` 把原值还回来 ——
  该行是修复表达式的**不动点**,永远转不过来,并且按 TEXT 比较。原单记为「任何 filter
  都匹配不到」;实测是**更坏**的形态 —— `'1753660800000.0'` 字典序排在所有 `'2…'`
  之前,所以该行既被自己所属的窗口漏掉,又被并不包含它的窗口命中:

  ```
  where at between '2025-07-01T…' and '2025-08-01T…'  -> ['ok']            (legacy 行丢失)
  where at <= '2030-01-01T…'                          -> ['legacy','ok']   (不该命中却命中)
  ```

  ## 本次落地(维护者 2026-08-03 裁定的方案 1)

  新增 `remote-canonical-backfill.ts` 与
  `TursoDriver.backfillRemoteCanonicalTemporal()`,在 remote 的 `initObjects` /
  `syncSchema` 之后自动运行 —— 与 local 在 `initObjects` 里调用 backfill 的位置对应:

  - **分批**:每条 `UPDATE` 至多改 `batchSize` 行,借
    `rowid IN (SELECT … LIMIT ?)` 子查询限量(`UPDATE … LIMIT` 需要 libSQL 不保证的
    编译选项)。
  - **可恢复**:不需要任何断点状态。WHERE 守卫本身就是断点 —— 它选中的正是尚未
    canonical 的行,中断在任何位置都不回滚已转换的行,下次从余量继续;已收敛的列
    重跑只花一条语句、零写入。
  - **完成标记**:只有在收尾探针测到「两个阶段都无事可做」时才标 canonical,写进
    `canonicalDatetimeFields` / `canonicalTimeFields` —— 与 local 完全相同的消费点
    (`needsLegacyDatetimeRepair`),因此两种 transport 靠同一条规则拿回可索引形态。
    被批次预算截断或报错的列**不标记**,保留读侧修复。
  - **后果 B 的可解部分**:对元数据声明为 `Field.datetime` / `Field.time` 的列,把
    纯数字文本按 `cast(col as real)` 喂回**驱动自己的**表达式(typeof 变成 'real',
    于是走它原本的 integer/real 分支)。因此本仓不新增第二套 epoch 转换规则。
  - **不可解残留如实记录**:只解释 1e12 ≤ v < 4102444800000(2001-09-09 ~ 2100-01-01)
    的值。下界是为了让 epoch **秒**永不入界 —— 2100 年前的秒值最大约 4.1e9,若按毫秒
    解释会把 `'1753660800'`(2025-07-28)静默改写成 1970-01-21,实测确认。界外的行
    原样留在盘上并计入 `unresolvedEpochTextRows`,不猜。

  方案 2(DDL 亲和性对齐)按裁定等 staging 存量探针另议,不在本次范围;方案 3(在
  `@objectstack/driver-sql` 公共表达式里加启发式)维护者已否决 —— 上面的恢复限于
  一次性迁移、且只作用于元数据声明为时间类型的列,与那条被否决的读路径启发式不是
  一回事。

  ## 正确性姿态不变(ADR-0053 D-B3 / cloud#1003)

  backfill 是**性能出口,不是正确性前提**。读写路径不依赖它跑过:任何失败(远端不可
  达、标识符非法、预算耗尽)都只导致该列不被标记、读侧继续带修复、答案照旧正确,
  且不会让 boot 失败。新增 20 条用例覆盖两个后果、分批/断点续跑/失败中断、完成标记
  的三个门、不可解残留、以及「标记与不标记答案一致」的 D-B3 断言。

  `turso-remote-temporal-conformance.test.ts` 的两条 legacy sweep 现在显式清除
  canonical 标记(与 driver-sql 的 `LegacyStorageDriver.forgetCanonical` 同一做法),
  并断言修复确实仍在生效 —— 此前 remote 「未 backfill」是因为压根没有 backfill 而
  **碰巧**成立,现在它是 fixture 必须自己声明的状态。

### Patch Changes

- d82b85f: fix(driver-turso): remote 模式拒收条件层的 `$`-算子键 —— 不再编译成静默空集/全表写 (#5769)

  `RemoteTransport.buildWhereSQL` 只认 `$and` / `$or` / `$not` 三个组合算子;条件
  层其余任何 `$` 开头的键都掉进**字段路径**,被双引号引成一个**列名**。在
  `origin/main`(`5c94f833c`)上用捕获客户端 + 三行 fixture 实测:

  ```
  { $eq: 'won' }                 → SELECT * FROM "deal" WHERE "$eq" = ?         → []
  { $gt: 5 }                     → SELECT * FROM "deal" WHERE "$gt" = ?         → []
  { $where: 'return true' }      → SELECT * FROM "deal" WHERE "$where" = ?      → []
  { $and: 'x' }                  → SELECT * FROM "deal" WHERE "$and" = ?        → []
  { $or: [{}, { $where: 'x' }] } → SELECT * FROM "deal"(整句没有 WHERE)        → 全部三行
  ```

  前四行是**静默空结果集**:SQLite 的向后兼容规则把「解析不到列的双引号标识符」
  降级成字符串字面量,于是语句编得出、跑得通、一行不匹配 —— 和「确实没有匹配的
  行」在调用侧完全无法区分(在关掉该规则的构建上,`find()` 自己的 `no such column`
  兜底也会把它吞成 `[]`,两条路一个答案)。

  第五行不依赖任何方言怪癖,也是代价最大的一种:`{}` 是 `$or` 的 TRUE 单位元,
  整组被吸收,连同它那个畸形兄弟已经编出来的子句一起被丢掉,语句**整个丢掉了
  WHERE**。读路径上这是把过滤器本要排除的行原样交还;`deleteMany` / `updateMany`
  上这是**全表写** —— 实测三行全部被一个一行都没点名的过滤器改写。

  现在:条件层任何非 `$and`/`$or`/`$not` 的 `$` 键,在 find / findOne / count /
  aggregate / deleteMany / updateMany 六个建 WHERE 的入口上一律以
  `INVALID_FILTER` / 400 响亮拒收,且**不发出任何语句**。消息分两种 —— 是字段算子
  写高了一层(`$eq`/`$gt`/…)就指路 `{ <字段名>: { <算子>: <值> } }`;协议根本没
  声明的键(`$where`/`$nor`/`$expr`/`$elemMatch`)就点名拒收。声明正确但值不是数组
  的 `$and` / `$or`(`{ $and: 'x' }`)同样落在这个闸里,按「需要条件数组」拒收 ——
  它此前从两个 `Array.isArray` 判断底下漏进同一条字段路径,结局一模一样。

  这条规则本来就是 objectstack#5348 的裁定,PR #5368 已在 `SqlDriver` 的校验遍历
  (`reduceFilterKey`)落地,`driver-sqlite-wasm` 与 Turso **local** 继承。
  `RemoteTransport` 是独立的过滤器编译器,什么都继承不到,所以同一个
  `TursoDriver`、同一个过滤器,只因 `url` 不同就给两个答案,而且方向是反的:local
  严、remote 松。本次补的正是这最后一面,新增的 local/remote 一致性用例把这条叉
  钉死。

  合法过滤器一个字节都没变:三个组合算子的嵌套、`$and: []` / `$or: []` / `$not: {}`
  的布尔单位元、字段层算子、隐式相等、`IS NULL`,以及既有的六种拒收(未知字段算子、
  不可绑定比较值、空算子映射、非节点子过滤器、非节点顶层 `where`、非布尔 `$null`)
  各自的措辞,全部照旧。

- 8a2ea6c: driver-turso: remote mode answers the NULL / no-value family the way local mode does

  `TursoDriver` compiles filters two different ways: local (and replica) mode
  inherits `SqlDriver.applyFilterCondition`, remote mode uses
  `RemoteTransport.buildWhereSQL`, an independent emitter. The NULL rulings landed
  only on the first, so ONE driver gave one filter two answers depending on the
  `url` it was constructed with. Measured against a fixture with two valued rows
  and two no-value rows:

  | filter                          | local            | remote (before) |
  | ------------------------------- | ---------------- | --------------- |
  | `{ d: { $ne: 'v1' } }`          | rows 2,3,4       | row 2           |
  | `{ d: { $nin: ['v1'] } }`       | rows 2,3,4       | row 2           |
  | `{ d: { $notContains: 'v1' } }` | rows 2,3,4       | row 2           |
  | `{ $not: { d: 'v1' } }`         | rows 2,3,4       | row 2           |
  | `{ d: { $exists: 'yes' } }`     | `INVALID_FILTER` | rows 1,2        |

  Remote mode now matches local on all five:

  - **`$not` is NULL-safe** (#5146). Each leaf of the negated condition is made
    total before the negation, so `NOT (…)` is TRUE or FALSE for every row instead
    of vanishing into SQL's UNKNOWN. A row whose column has no value does not
    satisfy the negated condition, so it IS returned.
  - **`$ne`, `$nin` and `$notContains` are NULL-safe** (#5298), emitted as
    `(col IS NULL OR <test>)`. `$ne: null` is unchanged and still compiles to
    `IS NOT NULL` — polarity follows the comparand, not the operator's name — and
    no positive comparison changes shape.
  - **A non-boolean `$exists` comparand is refused** with `INVALID_FILTER` / 400
    (#5369), as `$null` already was. `@objectstack/spec`'s `FieldOperatorsSchema`
    declares `$exists` as a boolean, and the emitter's `=== false` test sent every
    other value — including the truthy string `"false"` — to the `IS NOT NULL`
    side. `$exists: true` / `$exists: false` are unchanged.

  Why it matters beyond a row count: a CEL `!expr` in a permission rule lowers to
  `{ $not: {…} }`, so this was one RLS read scope admitting different row sets per
  connection mode. The `$ne` and `$not` cases are now enrolled in the shared
  `FILTER_LOGIC_CASES` conformance table, which all eleven filter backends run.

  **Upgrade note:** a query that relied on remote mode silently dropping no-value
  rows from a negative filter will now see them. Spell that intent explicitly —
  `{ $and: [{ d: { $ne: 'v1' } }, { d: { $null: false } }] }` — which is what it
  already had to be on every other backend.

- a58c0b5: fix(driver-turso): remote 分页读补齐确定性排序，与 local 面共用同一条规则

  `TursoDriver` 在 remote 传输(`libsql://` / `https://` 等 URL)下的分页读不满足
  `IDataDriver.find` 的确定性分页 MUST：`RemoteTransport.buildSelectSQL` 把调用方的
  `orderBy` 原样拼进 SQL 后直接接 `LIMIT` / `OFFSET`，不追加任何唯一列，无序分页读
  更是完全不排序。SQLite 不承诺并列行在两条语句之间排布一致，所以表一大、计划一变，
  `ORDER BY status LIMIT 50 OFFSET 50` 翻页时就会有记录出现两次、另一条永远不出现 ——
  每一页都是满的、每一行都合法，从任何单个响应里都看不出来。

  同一个驱动的 local 面早已按 #4363 办事，于是一个驱动的两条传输对同一个分页查询给出
  不同的排序保证，而传输模式只由 URL 决定。

  修法是**复用**而不是复制：`TursoDriver.find` / `findOne` 现在通过继承来的
  `SqlDriver.orderKeysFor()` 解析出完整排序键再交给传输层，三态规则只有一份实现 ——

  | `orderBy` | 分页                | 结果                                       |
  | --------- | ------------------- | ------------------------------------------ |
  | 非空      | 任意                | 调用方的键 + `id`                          |
  | 空        | 有 `limit`/`offset` | 单独 `id`                                  |
  | 空        | 都没有              | 不加 ORDER BY（#4363 carve-out，原样保留） |

  `findOne` 的语义一并保住：它的 `limit: 1` 由传输层自己注入，若在 `buildSelectSQL`
  里判定就会被误读成「页大小为 1 的第一页」，从而给系统里最热的读加上
  `ORDER BY id LIMIT 1` —— 正是让计划器放弃谓词自身索引的形状。

  唯一列的判定沿用 local 面同样保守的前提：只有本驱动自己建的表才追加 `id`
  (`RemoteTransport` 建表时无条件写入 `"id" TEXT PRIMARY KEY`)；不是自己建的表保持
  原样并告警一次，绝不凭空发明排序列。

- acf34e3: fix(drivers): refuse an `undefined` filter comparand instead of crashing (SQL) or silently answering `IS NULL` (Turso remote) (#6050)

  **⚠️ 行为变更(升级说明在最后一节)。** 比较数位置上的 `undefined` 从「静默/崩溃」变为 `INVALID_FILTER` / 400 拒收。作者侧的修法是显式判空,或改用 `null` / `$null`。

  ## 实测到的毛病

  同一个 `TursoDriver`,同一条过滤器,答案取决于它是用哪个 `url` 构造的 —— 四行 fixture(`d` 在 1-2 有值、3-4 为 NULL),`origin/main` @ `cba7454df`:

  | filter                                | LOCAL(继承 `SqlDriver`)          | REMOTE(`RemoteTransport`) |
  | ------------------------------------- | -------------------------------- | ------------------------- |
  | `{ d: undefined }`                    | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ d: { $eq: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `['3','4']`               |
  | `{ $not: { d: undefined } }`          | 抛裸 knex `Undefined binding(s)` | `['1','2']`               |
  | `{ d: { $ne: undefined } }`           | `['1','2']`                      | `['1','2']`               |
  | `{ $not: { d: { $ne: undefined } } }` | `[]`                             | `['3','4']`               |
  | `{ d: { $in: [undefined] } }`         | 抛裸 knex `Undefined binding(s)` | `[]`                      |
  | `{ d: { $gt: undefined } }`           | 抛裸 knex `Undefined binding(s)` | `[]`                      |

  两个可分开的毛病:

  **A —— 抛出的那几格没有 ADR-0112 信封。** knex 的 `Undefined binding(s) detected when compiling SELECT` 既没有 `code` 也没有 `status`,`mapDataError` 落默认分支,于是一条「调用方把 filter 写坏了」的错误以不透明 500 的形态到达客户端。#1116 / #4436 为这条通路清点过同类形态,唯独漏了这一格。

  **B —— 守卫与它自己的发射器分裂。** `$ne` 发射器读 `coerced == null`(宽松,所以 `undefined` 编译成 `IS NOT NULL` —— 一条 TOTAL 谓词),而必须钉住这个发射器的两张极性表 `operatorIsNullTotal` / `nullValueSatisfiesOperator` 读 `=== null`(严格,于是判它「不 total」且「NULL 行满足它」)。`nullGuardForFieldSpec` 因此把一条已经 total 的谓词包成 `d IS NULL OR d IS NOT NULL` —— 恒真 —— 取反后恒假,答 `[]`。这正是 #5298 立的不变量(每张极性表钉的是它自己发射器的拼写)在它自己的定义处被破坏。

  ## 修法

  一道闸,落在比较数进入**任何**发射器或守卫之前,两个毛病同闸消灭:knex 再也见不到 undefined 绑定,守卫与发射器对 undefined 的分歧变成**不可达**而不是「被修好」。

  - `driver-sql`:闸落在 `reduceFilterKey` 的校验走查上(与 `$null` / `$exists` 的拒收并排),外加 `applyFilters` 的平铺映射分支 —— `{ d: undefined }` 进不了走查(`typeof undefined` 不是 `'object'`,构不成 `hasMongoOperators`),而它恰恰是这个 bug 最常见的拼写。两处共用一个函数。
  - `driver-turso`:`buildWhereSQL` 入口做一次整棵子树的前置走查。必须前置,否则 `{ $not: { d: undefined } }` 会先把操作数交给 `nullSafeNegationOperand`(一个守卫)。
  - 顺带把两侧的 `== null` / `|| === undefined` 拼写统一收严成 `=== null`(#5347 收紧 `$null` 臂时给的理由:宽松拼写在闸被挪走后会悄悄恢复回答一个没人裁决过的取值)。

  拒收的位置逐个清点:直接比较数、单值算子的比较数(`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族)、列表算子数组的**成员**(`$in`/`$nin`/`$between`)、以及嵌在 `$and`/`$or`/`$not` 里的以上各位。`$null` / `$exists` 的 `undefined` 保持它们**自己**的拒收措辞(比较数是声明的布尔量,那条消息更贴切 —— #5240「一个条件一种措辞」两个方向都适用)。两个驱动的拒收句子逐字一致。

  ## ⛔ `null` 一字未动

  `{ f: null }`、`{ $eq: null }` → `IS NULL`;`{ $ne: null }` → `IS NOT NULL`;`$null: true/false` 不变;`null` 仍是合法的 `$in` 成员。`null` 是声明过的比较数,拒的只是 JS 里与「没有这个键」不可区分的那个值。

  ## 升级说明

  如果你的进程内代码这样拼过 filter:

  ```ts
  // 之前:id 缺失时 —— 本地崩、远端静默匹配全环境行
  await ql.find("deal", { where: { owner_id: ctx.user?.id } });
  ```

  现在会收到 `INVALID_FILTER` / 400,消息里带修法。两种正确写法:

  ```ts
  // 1) 显式判空 —— 键不存在就是「不约束」
  const where: Record<string, unknown> = {};
  if (ctx.user?.id !== undefined) where.owner_id = ctx.user.id;

  // 2) 真的想要空值谓词 —— 写出来
  await ql.find("deal", { where: { owner_id: null } }); // 或
  await ql.find("deal", { where: { owner_id: { $null: true } } });
  ```

  `where` 整体缺席仍然是「没有过滤器」(`query?.where` 为 `undefined` 是它唯一合法的位置),不受影响。

  ⚠️ 本次只覆盖 `driver-sql` 与 `driver-turso`(含 remote)。`driver-memory` / `driver-mongodb` 是 #5499 的投入冻结面,按裁决只测不改;`@objectstack/formula` 与 `service-analytics` 的 `read-scope-sql.ts` 对同一形状各有一种不同读法,实测记录在 #6125,留待单独裁决。

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

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/driver-sql@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/driver-sql@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/driver-sql@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/driver-sql@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/driver-sql@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-sql@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/driver-sql@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/driver-sql@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [0cc0374]
- Updated dependencies [5b878d9]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/driver-sql@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/driver-sql@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/driver-sql@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
- @objectstack/driver-sql@4.0.3

## 4.0.3

### Patch Changes

- fix: implement lazy connect in RemoteTransport to self-heal from serverless cold-start failures, transient network errors, or missed `connect()` calls. The transport now accepts a connect factory and auto-initializes the @libsql/client on first operation when the client is not yet available. Concurrent reconnection attempts are de-duplicated.

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/driver-sql@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 3.3.2

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/driver-sql@3.3.2

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/driver-sql@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/driver-sql@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/core@3.3.0
