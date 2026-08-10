# Changelog — @objectstack/service-analytics

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
