# @objectstack/driver-sqlite-wasm

## 17.1.0

### Patch Changes

- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [8bbf459]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2c570f3]
- Updated dependencies [7337f30]
- Updated dependencies [420804d]
- Updated dependencies [cbf4b40]
- Updated dependencies [9c4d096]
- Updated dependencies [86431f7]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
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
- Updated dependencies [a9df51c]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [ab8b10f]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [c8806ae]
- Updated dependencies [bb96297]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [3b3f67d]
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
- Updated dependencies [73cfddf]
- Updated dependencies [a4acb8d]
- Updated dependencies [d634e66]
- Updated dependencies [682b86b]
- Updated dependencies [6a1b45e]
  - @objectstack/spec@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/driver-sql@17.1.0

## 17.0.0

### Major Changes

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

- 62159bd: refactor(driver-sql)!: `SqlDriver.distinct` 的第三参收成裸 `FilterCondition`，一个静默返回全集的写法就此编译不过 (#6320)

  `distinct` 不在 `IDataDriver` 上，所以 #5181（PR #6076）与 #6075（PR #6210）的收窄都没走到它，#6212 批 A+E（#6355）收的是 `analyzeQuery` / `findWithWindowFunctions`，也没覆盖它。它的方法体一直说得很清楚——`applyFilters(builder, filters)` 拿的是**实参本身**，因此它要的是 `find()` 放在 `query.where` 里的那个值，**不是 query 信封**；`filters?: any` 只是没把这句话写进类型里。

  ```ts
  // 收窄前后都成立，一处调用点都不用改
  await driver.distinct("orders", "product", { status: "completed" });
  ```

  **收窄真正买到的东西，是实测出来的，不是推断的。** 三行数据（`Laptop`/`Mouse` 为 `completed`，`Ghost` 为 `pending`），逐个形状喂给 `distinct('orders','product', …)`：

  | 第三参                       | 收窄前                             | 收窄后       |
  | :--------------------------- | :--------------------------------- | :----------- |
  | `{ status: 'completed' }`    | 返回 `["Laptop","Mouse"]`          | 不变         |
  | 省略                         | 返回全集                           | 不变         |
  | `'completed'`（标量）        | **编译通过，返回全集**             | **编译错误** |
  | `{ object, where }`（信封）  | 抛 `INVALID_FILTER` / 400          | 不变         |
  | `['status','=','completed']` | 抛 `INVALID_FILTER` / 400（#5158） | 不变         |

  第三行就是本次消掉的那一格：一个真心想问「completed 订单里有哪些商品」的调用，编译通过，然后拿到**每一个**商品。`applyFilters` 对「真值但非对象、非数组」的 filter 不发射任何谓词（该方法尾注写着这件事），于是过滤条件被整条丢掉。方向是**放宽**——这正是 #6320 与 #5234 同族的那类「静默错答案」。

  **有一格是任何类型都关不上的，本次如实写进注释而不是假装关上了。** `FilterCondition` 的键**就是字段名**，所以它是开放映射（`[key: string]: any`）：`{ object, where }` 在结构上是一个完全合法的 filter——约束两个分别叫 `object` 和 `where` 的列。没有任何注解能把它和正当 filter 分开。#6320 提出的「让反向错配也编译不过」在这个参数上**不可达**，实测确认；能拿到的保证是**运行期响亮失败**：信封里的 `where` 是对象，而没有任何比较值可以是对象，于是 `assertCompilableComparand` 抛 `INVALID_FILTER` / 400。这半边 driver-sql 从来就不是静默的；`driver-memory` 那半边（裸 filter 交给它会静默返回全集）留在 #5499 冻结面内，本次不碰。

  **零运行时改动**：非测试改动 100% 是一个类型注解加一段注释，无逻辑、无行为、无 emit 差异。

  **逐处复核了全部 14 个调用点**（本单正文记的是 3 处，实测偏低）：driver-sql 11 处、driver-sqlite-wasm 3 处、driver-turso 0 处；其中真正传第三参的是 4 处（driver-sql 2 + driver-sqlite-wasm 2），全部本来就写的裸 filter，**零报错、零 fixture 改动**。

  **driver-sqlite-wasm 也标 major**：`SqliteWasmDriver extends SqlDriver` 且不覆写 `distinct`，所以它**已发布的 `.d.ts`** 里这个方法的签名同样收窄，它的使用者看到的是同一个变化。该包读的是 driver-sql 构建后的 `dist/*.d.ts` 而非源码，是一处已知门禁盲区，本次用「往参数类型里临时塞一个调用方不可能满足的成员、重建、看调用点是否逐一变红」证明它确实读到了新 d.ts：driver-sql 6 处红、driver-sqlite-wasm 3 处红，与预判逐一相符。

  ### 迁移

  调用点若把**标量**（或任何非 `FilterCondition` 值）交给第三参，编译器会指出来：

  ```
  error TS2345: Argument of type 'string' is not assignable to parameter of type 'FilterCondition'.
  ```

  改法是把它写成它本来就该是的裸 filter 对象（`'completed'` → `{ status: 'completed' }`）。⚠️ 这类调用点在收窄前拿到的是**未过滤的全集**，所以这不是一次等价改写：修完之后返回值会变，而变化后的那个才是调用方本来想要的答案。本仓零处这样的调用点。

  ⚠️ 无类型的 JS 调用方**既不会拿到编译错误、也不会有任何行为变化**（本次零运行时改动）。对他们而言，上面那条是「你一直没在过滤」的**唯一通知渠道** —— 这也是本次记台账条目的理由，见下。

  <!-- adr-0087: registered driver-sql-distinct-bare-filter-typed -->

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

- f1544e2: feat(driver-sql): compile `$field` to a column-to-column comparison on SQL push-down (#5222)

  `FieldReferenceSchema` (`{ $field: 'other_column' }`) is declared in the spec and
  genuinely PRODUCED — `compileCelToFilter` emits it whenever a CEL permission/RLS
  rule compares one field to another — but its only implementation was the
  in-memory evaluator. #5041 measured the consequence and installed a loud refusal
  (`INVALID_FILTER` / 400, replacing a bare `TypeError` and, inside an `$in` list,
  a silent zero-row answer), deliberately leaving the capability itself to this
  change. Until now, therefore, one permission rule had two behaviours chosen by
  whether the query reached a database.

  The six scalar comparison operators — `$eq` / `$ne` / `$gt` / `$gte` / `$lt` /
  `$lte`, including the array-triple authorings that lower to them — now compile
  `{ $field: 'col' }` into a real column reference:

  ```js
  {
    amount: {
      $gt: {
        $field: "budget";
      }
    }
  } // → where "amount" > "budget"
  ```

  **Nothing that worked before changes.** This is additive: every shape that
  compiled still compiles identically, and the refusal gate was NARROWED, never
  removed. A minor bump because a previously-400 filter now returns rows.

  **The refused arm, and why each entry is there** (all keep `INVALID_FILTER` /
  400):

  - **Dotted paths** (`{ $field: 'account.owner_id' }`) — maintainer ruling: v1 is
    same-table columns only. No JOIN planning, no alias-qualified columns.
  - **Undeclared columns**, on either side — the `$field` value lands in a SQL
    identifier position, so only fields the object declares are accepted, refused
    at COMPILE time rather than by the database. Federated/external tables
    (ADR-0015), whose column set this driver does not own, are refused wholesale.
  - **The tenant-isolation column**, on either side — a privilege-escalation
    comparison surface. Closed on both sides because the operands of `=` commute.
  - **Cross-class comparisons** (a number against text, a date against text) —
    SQLite orders by storage class first while the in-memory evaluator applies JS
    coercion, so the two paths genuinely disagree and neither answer can be made
    the other. Refused rather than shipped as a silent divergence.
  - **`$in` / `$nin` / `$between` list members** — the in-memory evaluator does not
    resolve a reference inside a list either (`resolveValue` returns an array
    unchanged), so there is no correct semantics for SQL to be equivalent to.
  - **The string operators** (`$contains`, `$startsWith`, …) — a column-side LIKE
    pattern cannot be metacharacter-escaped portably, and an unescaped one is the
    `%`-matches-every-row filter bypass.
  - **The bare `{ field: { $field: 'other' } }` spelling** — what
    `parseFilterAST(['a', '=', { $field: 'b' }])` lowers to. Still refused, because
    the in-memory evaluator answers `false` for it rather than reading it as an
    equality; the refusal now names `$eq` as the spelling that compiles instead of
    falling through to a generic operator list.

  **Equivalence is proven, not asserted.** A cross-path conformance suite runs each
  supported shape through the in-memory evaluator AND through SQL push-down against
  the same seeded rows, holding both to the same declared id list. Its fixture
  carries every NULL arrangement two columns can be in — target NULL, referent
  NULL, and BOTH NULL — because three-valued SQL against a two-valued JS matcher is
  the one place these paths can genuinely diverge. Every emitted predicate is
  therefore written TOTAL: `{ a: { $eq: { $field: 'b' } } }` matches a row where
  both columns are NULL, which a plain `a = b` would drop, and `$not` over any
  cross-field leaf is its exact complement.

  The suite runs the full driver axis — SQLite always, live Postgres and MySQL
  when the runner provisions them — and on both SQL drivers: `driver-sqlite-wasm`
  inherits the compiler but executes through its own sql.js dialect, which binds
  the identifier list itself. The dialect axis is not ceremony here: a cross-field
  predicate is the one filter shape whose SQL carries two identifiers and no bound
  value, and the class rule has a different failure per backend — comparing text to
  a number is a silent wrong answer on SQLite (storage classes order before values)
  but `operator does not exist: text > integer` on Postgres. The guard is what
  keeps either from being reached.

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
- Updated dependencies [29e28a3]
- Updated dependencies [c7f4417]
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
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
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
- Updated dependencies [ecb39ea]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [db12b88]
- Updated dependencies [62452c6]
- Updated dependencies [6f6fec7]
- Updated dependencies [7d1ff75]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
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
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [42e3b01]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [39eb01b]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
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
- Updated dependencies [d367f03]
- Updated dependencies [45e711a]
- Updated dependencies [465a0fa]
- Updated dependencies [cf5e033]
- Updated dependencies [6de592c]
- Updated dependencies [d254421]
- Updated dependencies [e2798fa]
- Updated dependencies [06ba036]
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
- Updated dependencies [0f17114]
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
- Updated dependencies [c7406b0]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [6f98c2d]
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
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [5d4de37]
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
- Updated dependencies [ef678d0]
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
- Updated dependencies [6146b67]
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
- Updated dependencies [33a5ff4]
- Updated dependencies [9e01213]
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
- Updated dependencies [4addd9d]
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
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [4fccace]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
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
- Updated dependencies [2ddba89]
- Updated dependencies [2ab1257]
- Updated dependencies [3fe0ff1]
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
- Updated dependencies [9c5abf4]
- Updated dependencies [82397b6]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
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
- Updated dependencies [f98fa65]
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
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [647ec8b]
- Updated dependencies [54299ca]
- Updated dependencies [3264516]
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
- Updated dependencies [62159bd]
- Updated dependencies [193cd5c]
- Updated dependencies [f1544e2]
- Updated dependencies [7457a09]
- Updated dependencies [5aae790]
- Updated dependencies [07f1822]
- Updated dependencies [d48aad5]
- Updated dependencies [5f0852f]
- Updated dependencies [c53aa53]
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
- Updated dependencies [bee5ffe]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [3172831]
- Updated dependencies [f8cfbb4]
- Updated dependencies [939f579]
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
- Updated dependencies [acf34e3]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
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
- Updated dependencies [2342ee4]
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
- Updated dependencies [a5dcb74]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/driver-sql@17.0.0

## 17.0.0-rc.6

### Major Changes

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

- 62159bd: refactor(driver-sql)!: `SqlDriver.distinct` 的第三参收成裸 `FilterCondition`，一个静默返回全集的写法就此编译不过 (#6320)

  `distinct` 不在 `IDataDriver` 上，所以 #5181（PR #6076）与 #6075（PR #6210）的收窄都没走到它，#6212 批 A+E（#6355）收的是 `analyzeQuery` / `findWithWindowFunctions`，也没覆盖它。它的方法体一直说得很清楚——`applyFilters(builder, filters)` 拿的是**实参本身**，因此它要的是 `find()` 放在 `query.where` 里的那个值，**不是 query 信封**；`filters?: any` 只是没把这句话写进类型里。

  ```ts
  // 收窄前后都成立，一处调用点都不用改
  await driver.distinct("orders", "product", { status: "completed" });
  ```

  **收窄真正买到的东西，是实测出来的，不是推断的。** 三行数据（`Laptop`/`Mouse` 为 `completed`，`Ghost` 为 `pending`），逐个形状喂给 `distinct('orders','product', …)`：

  | 第三参                       | 收窄前                             | 收窄后       |
  | :--------------------------- | :--------------------------------- | :----------- |
  | `{ status: 'completed' }`    | 返回 `["Laptop","Mouse"]`          | 不变         |
  | 省略                         | 返回全集                           | 不变         |
  | `'completed'`（标量）        | **编译通过，返回全集**             | **编译错误** |
  | `{ object, where }`（信封）  | 抛 `INVALID_FILTER` / 400          | 不变         |
  | `['status','=','completed']` | 抛 `INVALID_FILTER` / 400（#5158） | 不变         |

  第三行就是本次消掉的那一格：一个真心想问「completed 订单里有哪些商品」的调用，编译通过，然后拿到**每一个**商品。`applyFilters` 对「真值但非对象、非数组」的 filter 不发射任何谓词（该方法尾注写着这件事），于是过滤条件被整条丢掉。方向是**放宽**——这正是 #6320 与 #5234 同族的那类「静默错答案」。

  **有一格是任何类型都关不上的，本次如实写进注释而不是假装关上了。** `FilterCondition` 的键**就是字段名**，所以它是开放映射（`[key: string]: any`）：`{ object, where }` 在结构上是一个完全合法的 filter——约束两个分别叫 `object` 和 `where` 的列。没有任何注解能把它和正当 filter 分开。#6320 提出的「让反向错配也编译不过」在这个参数上**不可达**，实测确认；能拿到的保证是**运行期响亮失败**：信封里的 `where` 是对象，而没有任何比较值可以是对象，于是 `assertCompilableComparand` 抛 `INVALID_FILTER` / 400。这半边 driver-sql 从来就不是静默的；`driver-memory` 那半边（裸 filter 交给它会静默返回全集）留在 #5499 冻结面内，本次不碰。

  **零运行时改动**：非测试改动 100% 是一个类型注解加一段注释，无逻辑、无行为、无 emit 差异。

  **逐处复核了全部 14 个调用点**（本单正文记的是 3 处，实测偏低）：driver-sql 11 处、driver-sqlite-wasm 3 处、driver-turso 0 处；其中真正传第三参的是 4 处（driver-sql 2 + driver-sqlite-wasm 2），全部本来就写的裸 filter，**零报错、零 fixture 改动**。

  **driver-sqlite-wasm 也标 major**：`SqliteWasmDriver extends SqlDriver` 且不覆写 `distinct`，所以它**已发布的 `.d.ts`** 里这个方法的签名同样收窄，它的使用者看到的是同一个变化。该包读的是 driver-sql 构建后的 `dist/*.d.ts` 而非源码，是一处已知门禁盲区，本次用「往参数类型里临时塞一个调用方不可能满足的成员、重建、看调用点是否逐一变红」证明它确实读到了新 d.ts：driver-sql 6 处红、driver-sqlite-wasm 3 处红，与预判逐一相符。

  ### 迁移

  调用点若把**标量**（或任何非 `FilterCondition` 值）交给第三参，编译器会指出来：

  ```
  error TS2345: Argument of type 'string' is not assignable to parameter of type 'FilterCondition'.
  ```

  改法是把它写成它本来就该是的裸 filter 对象（`'completed'` → `{ status: 'completed' }`）。⚠️ 这类调用点在收窄前拿到的是**未过滤的全集**，所以这不是一次等价改写：修完之后返回值会变，而变化后的那个才是调用方本来想要的答案。本仓零处这样的调用点。

  ⚠️ 无类型的 JS 调用方**既不会拿到编译错误、也不会有任何行为变化**（本次零运行时改动）。对他们而言，上面那条是「你一直没在过滤」的**唯一通知渠道** —— 这也是本次记台账条目的理由，见下。

  <!-- adr-0087: registered driver-sql-distinct-bare-filter-typed -->

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

### Patch Changes

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
