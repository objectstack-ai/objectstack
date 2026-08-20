# @objectstack/formula

## 17.1.0

### Patch Changes

- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
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
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
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
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
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
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0

## 17.0.0

### Minor Changes

- f6cd635: fix(formula): the CEL pushdown compiler parses through the canonical front end, so `DEFAULT_LIMITS` finally apply to RLS/sharing predicates (#6132)

  `cel-to-filter.ts` — the ONE canonical CEL → `FilterCondition` pushdown compiler
  (ADR-0058 D1/D2/D6), consumed by the RLS path (`plugin-security`'s
  `RLSCompiler`), the sharing seeder (`plugin-sharing`), and the analytics SQL
  backend — kept a **private, limitless** parse environment of its own:

  ```ts
  new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });
  ```

  no `limits`, no stdlib, no `rewriteNullableTernary`. That made the pushdown path
  the one place on the platform that answered a _different_ question from
  `celEngine.compile()` about what parses. Measured: a 300-term addition, a
  60-level parenthesis nest and a 200-element list literal all parsed there while
  the interpreter refused each one outright (`Exceeded maxAstNodes (256)` /
  `maxDepth (32)` / `maxListElements (64)`). Escalated: an 80-term conjunction, a
  40-level nest and a 200-element `$in` all reached **real pushdown SQL**,
  silently — and `isSupportedRlsExpression`, the ADR-0056 D4 authoring gate, was a
  thin wrapper over the same limitless environment, so it was no independent check
  either.

  It now parses through `parseCelToAstWithReason` — #4812's canonical entry, with
  `DEFAULT_LIMITS`, the stdlib and the #3306 null-guard rewrite. "What parses" has
  one answer again.

  **Within the limits nothing moves, and that is measured, not asserted.** Across
  the 710 sources of the pushdown corpus that both front ends accept, the only AST
  difference is `rewriteNullableTernary`'s `dyn(…)` wrap on the three null-guard
  ternaries — and a ternary faults on its own `?:` node before the lowerer
  descends into a branch, so verdict _and_ detail come out byte-identical. Pinned
  in `cel-to-filter-parse-convergence.test.ts`, which rebuilds the old environment
  to compare against.

  **Over the limits, behaviour changes — in two dated steps.**

  - **Now, during `17.0.0-rc.x` (`rc-grace`):** an over-limit predicate **still
    compiles** — nothing that enforces today stops enforcing on this upgrade — and
    emits one WARN per predicate naming the bound that was exceeded
    (`maxAstNodes` / `maxDepth` / `maxListElements` / …), the platform's value for
    it, and what the predicate itself measures (cel-js's own accounting: the
    smallest bound it parses under), plus what will happen at GA.
  - **At v17.0.0 GA (`fail-closed`):** the same predicate is **refused** —
    `{ ok: false, reason: 'parse-error', detail: 'Exceeded maxAstNodes (256)' }` —
    and the RLS path turns that into `RLS_DENY_FILTER`, i.e. zero rows, fail
    closed. A sharing rule with such a condition is not seeded.

  **The flip is one line.** `CEL_PUSHDOWN_LIMITS_MODE` in
  `packages/formula/src/cel-pushdown-limits.ts` — the single dated switch,
  shipping as `'rc-grace'`, to be set to `'fail-closed'` at the v17.0.0 GA release
  (i.e. when this package's version leaves `17.0.0-rc.x`). Both positions are
  exercised in CI today, in `@objectstack/formula` and in
  `@objectstack/plugin-security` (where the `RLS_DENY_FILTER` outcome lives), so
  the GA half is proven before it ships rather than after. Two tests are written
  to go red on that line so the flip cannot be silent.

  **If you author RLS or sharing predicates:** a predicate over any of these
  bounds is already refused everywhere else on the platform (`os build`,
  `os validate`, the interpreter). Split it, or move the logic into a hook/action
  body (`ScriptBody { language: 'js' }`), before upgrading past the rc line. The
  WARN names the predicate and its measure so you can find them.

  **New public surface**, for consumers that must _report_ a refusal rather than
  merely react to one:

  - `parseCelToAstWithReason(source, opts?)` — the reason-carrying sister entrance
    to `parseCelToAst`. Same front end, same verdict, but it distinguishes
    `'parse'` (not valid CEL) from `'bounds'` (valid CEL, over budget) and names
    the exceeded limit, its platform value, and the source's measure. Graded by
    the same by-class/by-code classifier `celEngine.compile` uses (#6223) — never
    by error prose. `parseCelToAst` is unchanged and still collapses every refusal
    to `null`.
  - `CelParseResult`, `CelBoundsOverrun`, `CelLimitKey`, `ParseCelToAstOptions`.
  - `CEL_PUSHDOWN_LIMITS_MODE`, `celPushdownLimitsMode()`,
    `setCelPushdownLimitsModeForTests()`, `CelPushdownLimitsMode`.

  `@objectstack/lint` needs no change, at either position of the switch. Its two
  enforceability gates read `isSupportedRlsExpression` and `compileCelToFilter`,
  both downstream of this switch, and both suites pin "the lint verdict IS the
  consumer's verdict" in both directions — so authoring-time reporting flips with
  the runtime by construction. An over-limit sharing `condition` is in fact
  already an authoring **error** today (`expression-invalid`, from the general
  expression rule, quoting `Exceeded maxAstNodes (256)`), because that rule has
  always gone through the canonical front end.

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

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- 58f3220: 新增规范 parse-to-AST 入口 `parseCelToAst(source)`,并 re-export AST 节点类型 `CelAstNode`(#4812)。

  `parseCelToAst` 与 `compile` / `evaluate` / `collectCelRootIdentifiers` 共用同一条前端链路
  ——#3306 的 `rewriteNullableTernary` 重写、`DEFAULT_LIMITS` 边界、以及注册了 stdlib 的
  `unlistedVariablesAreDyn: true` 环境 —— 因此全仓对「什么能解析」只有一个答案。此前消费方
  若自建 `new Environment(...)`,拿到的是一份**不带 limits** 的答案:它会解析、并进而推理
  `compile()` 直接拒绝的表达式。

  `parseCelToAst` 只做 parse,不做 check(后者是 `compile()` 的职责):解析成功但类型检查失败的
  表达式(大量 `dyn` 操作数的谓词即是)仍然会拿到 AST。解析失败返回 `null` 而不抛错。

  `CelAstNode` 的 re-export 补上了一个既有缺口:`lowerCelAst` 一直接收 cel-js 的 `ASTNode`,
  而该类型从未导出,消费方只能越过本包直接依赖 `@marcbachmann/cel-js` —— 这正是第二个解析入口
  的成因。

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

- 6965160: feat(lint): view/page 可见性谓词的裸标识符构建期闸门 —— 坏谓词发不出去(#6128)

  新增 **error 级** 规则 `visibility-bare-identifier`:view/page 的可见性谓词
  (`visibleWhen` 及其两个已弃用别名 `visibleOn` / `visibility`)里引用了任何绑定根都解析不到的
  顶层标识符时,`os validate` / `os build` / `os lint` 一律拒收。写成 `status == 'active'`
  而不是 `record.status == 'active'` 的谓词,从此发不出去。

  按 #5149 维护者 2026-08-06 裁决的构建期半边落地(运行时 warn-once 半边已由 objectui#3541 合入)。
  本仓传统的准确表述是:fail-open 或 fail-closed 都可以裁,**静默不可以**。谓词失败仍然 fail-open
  (已发货 app 行为不变),但坏谓词不再能进入产物。

  **为什么现有两道闸都放行**(#5149 Repro 1 实测,已写进规则注释,防后人误并):
  ADR-0032 的标识符闸(`validate-expressions.ts`)解析 record 作用域的裸引用,但它的遍历只覆盖
  objects / flows / actions / sharingRules / hooks,**从不走 views 与 pages**;ADR-0089 D3b
  只判**有根**的谓词根错层(runtime 面的 `data.`、metadata 面的 `record.`),**无根**的谓词两边都不匹配。
  两闸之间正好漏掉「作者按文档示例写了裸字段名 → 谓词永远解析失败 → 控制台 fail-open 静默显示」。

  **判定由两个既有 oracle 合成,本包不自建 CEL 环境**(#4812 的教训):声明性判定取
  `@objectstack/formula` 的 `firstUndeclaredReference`(即 `validateExpression` 给 record 作用域
  裸引用定罪的同一个严格环境),AST 取规范入口 `parseCelToAst`。AST 先收集所有处于**接收者位置**
  的标识符(`a.b` / `a?.b` / `a['b']` / `a.exists(…)`)并在检查前声明它们,于是只剩「当作裸值引用」
  的标识符会被判 —— 未知**根**(`my_record.x`)交还给 ADR-0089 D3b,不在本规则射程内。

  **与 #4953(全量 vs 稀疏绑定)的边界**:#4953 实测同一求值器在两种绑定下语义相反
  (`has(record.a)` 全量 true / 稀疏 false;`record.a != null` 全量 false / 稀疏 FAULT)。本规则
  **按构造与该分叉无关** —— 它从不追问某个 KEY 在已绑定的根上是否存在,只追问标识符有没有根,
  而无根标识符在两种绑定下都解析不到。`has(record.x)` / `record.x != null` 等守卫写法在本闸门下
  一律绿,无论 #4953 最终怎么裁;已加测试钉住这条边界。

  **遍历按实测修正,否则规则生来即死**:`os build` 跑 `examples/app-showcase` 得到的唯一一条
  view 表单谓词落在 `views[0].formViews.edit.sections[0].fields[6].visibleWhen` —— 运行时 app 形状下
  `views[]` 条目是**视图容器**(`ViewSchema` 声明的自有键就是 `list` / `form` / `listViews` /
  `formViews`),`sections` 在下一层。原遍历只读 `views[].sections`,在这份 stack 上报告「干净」。
  现在覆盖容器的 `form` 与每个 `formViews.<key>`,以及仍然直接携带 `sections` 的 `defineForm` 形状;
  pages 改走共享的 `walkPageComponents`(regions、slotted 页的 `slots`、以及 `properties` 里的
  `page:tabs` / `page:accordion` / `page:card` 子树都随之覆盖,source-authored 页按其既有语义跳过)。
  `objects[].views` 明确不读 —— 该键已被 schema 立碑拒绝,读它只会造出一条永不触发的幽灵检查。
  两条既有 ADR-0089 D3b advisory 随遍历一并变得真正可达。

  注册表 tier `advisory` → `gating`(#5762 的先例):tier 声明并非自述,
  `authoring-rule-wiring.test.ts` 会读规则源码核对。

  已知盲点(已钉测试、方向安全):字段名与 CEL **类型名**相同时(`type` / `int` / `string` / `list`
  / `map` / `timestamp` …)不判 —— CEL 自身声明这些标识符,`type == 'grid'` 到检查器那里是类型
  overload 错误而非未知变量;改读 overload 消息会误杀合法的 `type(record.x) == string`。语法不通过
  的谓词同样不判,交还给拥有该判定的闸门。两者都是漏判,永远不会变成误红。

  仓内 `app-todo` / `app-crm` / `app-showcase` 三个示例 `os validate` 全部通过、零 visibility finding,
  无需修改任何示例内容。

  `@objectstack/formula` 侧:公开导出 `firstUndeclaredReference`(理由与既有的
  `collectCelRootIdentifiers` 一致 —— 绑定根集合不同的消费方需要的是同一个答案,替代方案是在消费方
  自建严格 `Environment`,而那正是 #4812 从本包消费方手里拿掉的私有前端)。

- bf1edef: feat(formula,lint): wire ADR-0056 D4's RLS authoring gate, from the runtime's own predicate (#4983)

  `isSupportedRlsExpression` has carried the same docblock since ADR-0056 D4:
  "exposed so an authoring-time gate (`objectstack compile`) can REJECT a
  predicate the runtime would silently drop … A `false` here means 'this
  predicate will never enforce'." It had **no non-test consumer anywhere** — the
  function written to fix declared-but-never-read was itself declared and never
  read. This lands the consumer, in two steps that had to happen in this order.

  **1. `sqlPredicateToCel` and `isSupportedRlsExpression` move FROM
  `@objectstack/plugin-security` (`src/rls-compiler.ts`) TO `@objectstack/formula`
  (`src/rls-predicate.ts`), and are exported from its root.** Executable code
  unchanged — a change of address, not of behaviour; `plugin-security` now imports
  them from `@objectstack/formula` and keeps no copy, so there is still exactly
  one definition. No import path outside the two packages changes: neither symbol
  was ever exported from `@objectstack/plugin-security`'s entry point. The move is
  what makes step 2 possible at all — `@objectstack/lint` may depend on
  `@objectstack/spec` and never on a runtime, so with the predicate living in a
  runtime the gate's only other door was copying the SQL→CEL bridge, whose
  boundary conditions (quoted literals are never rewritten; canonical CEL passes
  through unchanged) _are_ the gate's red/green line. A fork drifting by one
  character rejects policies the runtime executes correctly — the false-positive
  direction, which is worse than the gap. ADR-0058 D1 asks for a single canonical
  shape gate; the bridge is part of that gate.

  **2. New `@objectstack/lint` rule `validateRlsPredicateEnforceability`,
  `error`, on all three authoring commands**, over
  `permissions[].rowLevelSecurity[].using` and `.check`:

  - **`rls-predicate-unenforceable`** — parses as CEL, outside the pushdown
    subset: a function call (`size(...)`, `has(...)`), arithmetic, a ternary, a
    cross-object path (`record.account.region`).
  - **`rls-predicate-unparseable`** — does not parse as CEL even after the legacy
    SQL bridge (`=` → `==`, `IN` → `in`): SQL `AND` / `OR` / `LIKE`, a subquery.
    Its own id because the fix is different — write CEL (`&&`, `||`), not a
    different shape.

  What the gate prevents, measured through `plugin-security` rather than inferred:
  `RLSCompiler` drops the policy and logs one request-time WARN. On the read path,
  when it is the only applicable policy, `compileFilter` returns the
  `RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause — so
  every select / update / delete on the object matches **zero rows**. On the
  ADR-0058 D4 write path the post-image `check` becomes that same sentinel, which
  no record satisfies, so every insert / update fails with `PermissionDeniedError`.
  The runtime fails closed, which is why this was survivable: the result is not a
  hole but a policy that reads as an authorization and behaves as a blanket
  refusal, with nothing at authoring time pointing at the line that caused it.

  Fix a flagged predicate by rewriting it inside the lowerable subset — `==` `!=`
  `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
  `startsWith` / `endsWith` / `contains` over single-column field paths (ADR-0058
  D2), against a literal or a `current_user.*` value. Two specific migrations:
  `has(x)` / `size(x) > 0` → `x != null` (a function call is correct in an object
  _validation_ rule, which is interpreted, and wrong here, where the predicate is
  compiled to a filter); and a related record's field → denormalise it onto this
  object (formula/rollup) and test that column, since RLS cannot join (ADR-0055).

  Same construction as the sharing-rule gate (#4698): the rule does not model the
  consumer or grep for it — it calls `isSupportedRlsExpression`, the exact
  function `RLSCompiler.compileFilter` consults to decide whether a dropped policy
  earns its warning, so the two verdicts are one boolean by construction, pinned
  in both directions over a shared corpus. Measured before shipping: every RLS
  predicate declared anywhere in this repo — the `plugin-security` platform seeds,
  the examples, the dogfood fixtures, the authoring skill — is supported, so the
  gate turns nothing red that works today. Unlike the sharing-rule gate, CEL
  _syntax_ is reported here rather than deferred to `expression-invalid`:
  `validateStackExpressions` does not walk `rowLevelSecurity` at all, and could not
  judge this field correctly if it did, because `owner_id = current_user.id` is a
  CEL syntax error and a working RLS predicate at the same time.

- 4965bfa: Warn on flow-node `config` keys the node type does not declare (#4045).

  `FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
  config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
  registered cleanly, was never read, and the only symptom was a feature that quietly
  did not happen. That diagnostic vacuum is what made #3528 take three passes and two
  wrong diagnoses to resolve.

  `registerFlow` now compares each node's `config` against its descriptor's
  `configSchema` and warns on anything undeclared, located and with the declared set
  listed:

  ```
  [flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
    at config.fields[0].visibleIf — It is not declared by this node type's
    configSchema, so nothing reads it. Declared here: name, label, type, required,
    visibleWhen.
  ```

  The walk descends where the schema declares structure and **stops at free-form
  keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
  Descending matters: the #3528 typo class lives _inside_ the `screen` field
  repeater, so a top-level-only comparison would miss the exact mistake this exists
  to catch.

  **Warn, never reject.** An undeclared key is an author typo, a key the executor
  genuinely reads that its hand-written `configSchema` never declared (`notify.source`
  was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
  been audited for the second population, so hard-failing would gamble on the other
  nine. Tightening to an error is a later, per-key decision once this warning has
  measured the real distribution. Nothing about the published `configSchema` changes,
  so no consumer sees a different shape.

  `@objectstack/formula` now exports `nearestName`, the edit-distance helper already
  used for unknown-field and unknown-role suggestions, so "did you mean?"
  diagnostics share one threshold. It is deliberately a bonus rather than the
  mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
  the declared set is always listed instead of only as a fallback.

  Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
  `get_record` node carried `mode: 'records'`, which no executor reads, with a comment
  crediting it for behaviour that `limit > 1` actually produces.

### Patch Changes

- 2af1988: fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

  `@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
  write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
  bound literally. On a `datetime` post-image that meant a policy of the shape
  `{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
  the write-side twin of the read-side data loss #3777 fixed, and the last of the
  platform's filter backends that disagreed about what a bare day means as a
  bound.

  `$lte` and a `$between` max now evaluate half-open against the next calendar
  day, matching the SQL compiler, the memory and mongo drivers, and the analytics
  preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
  exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
  plain `YYYY-MM-DD` value compares identically (string ordering makes the two
  forms equivalent). The evaluator stays fail-closed on a null bound.

  **Where the rule now lives.** `nextUtcCalendarDay` moved from
  `@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
  whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
  copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
  package all six consumers already depend on, so this adds no dependency edge.

  No import changes are required: `@objectstack/core` re-exports the symbol, so
  existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
  New code should prefer `@objectstack/spec/data`.

- b230e5e: fix(formula): `classifyError` grades a CEL fault by error class + code, never by the message (#6223)

  `EvalResult.error.kind` is author-facing — `@objectstack/objectql`'s `cel-fault`
  puts it in front of the author as `` `${kind}: ${first line}` `` and
  `packages/rest` re-emits it as the HTTP body's `reason`. cel-js embeds the
  author's own **source line** in `message` (`formatErrorWithHighlight`), so a
  classifier that regex-matches that text is matching text the author writes.
  PR #6202 closed the `ParseError` arm this way and left `type` / `runtime` on the
  keyword table pending a per-code audit. This is that audit, and its verdict is
  that the table goes entirely.

  Measured on cel-js 8.0.0 — one `no such overload` **evaluation** fault, four
  field names, three wrong answers:

  ```text
  record.status        > 1  ->  runtime   (right)
  record.parse_status  > 1  ->  parse     (wrong)
  record.syntax_mode   > 1  ->  parse     (wrong)
  record.type_code     > 1  ->  type      (wrong)
  ```

  `parse` is the inverse of the #6133 misdirection: the expression is
  syntactically perfect and failed on the data, and the author was told to go fix
  an expression that has nothing wrong with it.

  `classifyError` now reads only structured contract:

  - `ParseError` -> `bounds` when `code === 'limit_exceeded'`, else `parse`
    (unchanged, from #6202);
  - `EvaluationError` -> `type` for the one declaration-class code
    (`unknown_variable`, the root identifier is not bound in this scope at all),
    else `runtime`;
  - anything that is not a cel-js error -> `runtime`.

  Two findings from the audit worth recording. First, the residual keyword arm was
  **not** dormant: `matches()` is an ObjectStack stdlib binding over `new
RegExp(...)`, so an uncompilable pattern escapes as a native `SyntaxError` whose
  message echoes the pattern — and the pattern can come off the row, not just out
  of the source. `matches(record.name, record.re)` with `re = "type("` was
  graded `type`; with `"Exceeded maxAstNodes("` it was graded `bounds`. A data
  value was picking the error kind. Second, there is deliberately no `TypeError`
  arm: cel-js raises that class only from its non-evaluating `TypeChecker`, which
  runs only inside `Environment#check`, and that method catches it and _returns_
  `{ valid: false, error }`. The check-time `TypeError -> type` mapping already
  lives in `celEngine.compile`, which reads that object.

  Six evaluate-time codes change verdict from `type` to `runtime`
  (`int_conversion_error`, `uint_conversion_error`, `double_conversion_error`,
  `invalid_index_type`, `heterogeneous_list_element`,
  `invalid_comprehension_range`). Each is a fault decided against the row; every
  one of them was graded `type` only because cel-js happens to use the word "type"
  in its prose (`int() type error: cannot convert to int`). Every evaluate-time
  code the engine can reach now has a fixture pinning its `kind`.

- 5d24f4b: fix(formula): the ADR-0032 §1c retry rewrites only the operands that faulted (#7098)

  **A CEL expression could return a silently wrong boolean.** No fault, no log
  line, no failing test — `{ ok: true }` with the wrong answer. If you have
  compound CEL that mixes a numeric comparison with a string equality over
  string-serialized fields, read the "which expressions change answer" list below:
  those expressions answer differently after this fix, and the new answer is the
  right one.

  ## What was wrong

  When a comparison faults on a string-serialized numeric or date field
  (`record.rating >= 4` where `rating` reads back as `"5.0"` — #1530 / #1534),
  ADR-0032 §1c hydrates and retries. The retry hydrated the **entire scope** and
  re-ran the **entire expression**, justified by a docblock claim that it

  > can never change a comparison that already evaluated cleanly — it only rescues
  > one that already faulted.

  That claim was false, and it was load-bearing: it was the stated reason the
  hydration was allowed to be unconditional and scope-wide. The retry knows only
  that the _whole expression_ faulted, not that each sub-comparison did. So:

  ```text
  record.n >= 4 && record.s == "5.0"    with { n: "7", s: "5.0" }
    before -> { ok: true, value: false }        after -> { ok: true, value: true }
  ```

  `record.n >= 4` faults and is correctly rescued. But `record.s` was hydrated to
  the number `5` as well, so the author's deliberate string equality — **true**
  when it was evaluated the first time — became `5 == "5.0"`, which CEL answers
  `false` across types. The expression returned `false`, and nothing reported that
  a clean answer had been overruled.

  ## Which expressions change answer

  Only expressions that **already reached the §1c retry** — i.e. some operand
  faulted `no such overload`. Everything that evaluates without faulting is
  untouched. Within that set, an expression changes answer when it also contains:

  - **a string equality / inequality on a numeric-looking or ISO-date field** —
    `record.n >= 4 && record.s == "5.0"`, and the `!=` and ternary forms. Now
    answers on the string the author wrote.
  - **a string membership test** — `record.s in ["5.0", "x"]`.
  - **the same field compared as a number in one place and as a string in
    another** — `record.n >= 4 && record.n == "7"`. Both answers are now correct
    at once; previously the second was collateral damage from the first.
  - **a numeric-looking string the expression RETURNS rather than compares** —
    `record.n >= 4 ? record.s : "none"` returned the number `5`; it now returns
    the string `"5.0"`. A `Field.formula` of type text was storing a different
    value than the record held.

  One class becomes a **loud fault where it used to be silently rescued**: an
  operand whose value the rewrite cannot read before deciding — bound by a
  comprehension (`record.items.exists(i, i.price > 100)`), or behind a computed
  index. That is the deliberate trade of this fix. Rescuing an operand we cannot
  prove faulted is exactly the defect being closed, so those report the original
  `no such overload` instead of guessing. The reported error is unchanged in shape
  and message.

  ## What replaces it

  The coercion is now **per operand position** — the same discipline
  `rewriteTemporalEquality` already documents ("no field-wide trade-off"), one
  step stricter. The scope is never rewritten; the faulting operand is wrapped in
  `double(…)` or `date(…)` in place. An operand is rewritten only when all three
  hold, which makes the docblock's guarantee true by construction rather than by
  assertion:

  1. the operator **raises** on a string-versus-number/Timestamp pair instead of
     answering one, so the comparison cannot have produced an answer;
  2. the counterpart is a number or a Timestamp **in this scope**, read off the
     values in hand rather than off a static type (every field is `dyn` under
     `unlistedVariablesAreDyn`);
  3. the operand's own value is a §1c serialization artifact — an entirely-numeric
     string or an ISO-8601 date. A zip like `"02134"`, or free text, still faults
     loudly.

  Measured per operator on cel-js 8.0.0 and pinned in the new tests: `<` `<=` `>`
  `>=` `+` `-` `*` `/` `%` **fault** on a mixed pair and are eligible. `==`, `!=`
  and `in` **answer** across types — CEL equality is total — so they already had
  an answer and are never rewritten. That measurement is the root of the defect:
  the string equality above never faulted at all.

  `Field.date` strings not matching a Timestamp under `==` remains owned by
  `rewriteTemporalEquality`, which wraps them statically on the clean path, where
  both sides are known from the source instead of inferred from an unrelated
  conjunct's fault.

  ## Reach

  `celEngine.evaluate` — the only home of this retry — does **not** reach RLS.
  Row-level security compiles its `using` / `check` predicates through
  `compileCelToFilter` (SQL pushdown) and `matchesFilterCondition` (write-side
  post-image), and declared sharing rules do the same; neither calls this
  evaluator. No access-control decision could be inverted by this.

  It does reach write-gating decisions, which is why the behaviour was not
  acceptable as documented: validation-rule predicates and `when` conditionals,
  `readonlyWhen`, hook `condition`s, automation/flow conditions, and formula
  fields and default values. A validation rule is **fail-closed** on a fault
  (#4649) — but a silently flipped boolean is not a fault, so a rule that should
  have rejected a write instead read as "not violated" and let it through.

- 29b94ed: fix(formula): the CEL hydration retry arms off cel-js's structured code, not the phrase "no such overload" (#6679)

  `celEngine.evaluate` catches a fault and asks `isNumericOverloadError` whether to
  hydrate string-serialized numeric / date fields and re-evaluate once — the
  ADR-0032 §1c accommodation for `Field.rating` → `"5.0"` and `Field.date` →
  `"2026-06-20"` (#1530, #1534). That question was answered by
  `/no such overload/i.test(err.message)`: the last message-text read in
  `cel-engine.ts` that armed behaviour after #6223 / PR #6677 closed the same hole
  in `classifyError`. It now reads
  `err instanceof EvaluationError && err.code === 'no_such_overload'`, the same
  class-and-code rule `classifyCelFault` already follows one function below.

  The phrase was reachable from a **native** throw, not only from cel-js. Our
  `matches()` stdlib binding is `new RegExp(String(re)).test(...)`, so an
  uncompilable pattern escapes cel-js unwrapped as a `SyntaxError` echoing the
  pattern verbatim — `Invalid regular expression: /no such overload(/` — which
  matched. The pattern can be written in the source or read off a row via
  `matches(record.name, record.re)`.

  The filing recorded this as observation-class, expecting the consequence to be
  nil because the retry re-throws the original error. Measuring it for the fix
  found one case where it is not nil, so this ships as a fix rather than a
  tolerance removal: when hydration lets the expression short-circuit around the
  throwing call, the spurious retry **succeeds** and returns a value where the
  fault was the right answer.

  ```text
  record.s == "5.0" ? matches(record.name, "no such overload(") : false
    { s: "5.0", name: "x" }   ->  was: ok, false        now: the regex fault
  record.s == "5.0" ? matches(record.name, "(") : false
    { s: "5.0", name: "x" }   ->  the regex fault       (unchanged)
  ```

  Evaluation 1 takes the `matches(...)` branch and throws natively; the phrase
  armed the retry; hydration made `record.s` the number `5`, so `5 == "5.0"` went
  false, the ternary took the other branch, and `matches` was never called. Two
  expressions that differ only in whether a regex literal happens to contain the
  phrase no longer disagree about whether they fault.

  The behaviour change is one-directional and narrow. A genuine cel-js
  `no_such_overload` still arms the retry and every §1c hydration behaves exactly
  as before; only a native throw whose message merely contains the phrase stops
  arming it. Faults are otherwise unchanged — a native throw carries no cel-js
  contract, so it is still reported as `runtime` (#6223).

- 07c68b0: fix(formula): 括号/引号/转义等 parse 期错误不再被误报为 `runtime`

  `celEngine` 的错误分类此前完全靠**错误文案关键词**判定,而 cel-js 8.0.0 的 parse 期错误有约 19 种措辞,只有 3 种含 `parse` / `unexpected` / `syntax`。其余整类 —— 最典型的括号/方括号/花括号不配对(`Expected RPAREN, got EOF`)、未闭合字符串、非法转义、保留字 —— 全部落到默认值 `runtime`。

  `kind` 不是内部字段:它被原样拼进作者可见的写入拒绝文案(`@objectstack/objectql` 的 `rule-validator` / `cel-fault`)与 REST 错误响应体的 `reason`。少写一个右括号的校验规则,作者读到的是 `(runtime: …)` —— 指向数据与求值期,而真正该改的是表达式本身,与 ADR-0032 D1d 的"消息面向自纠"相悖。

  改为按 cel-js 抛出的**错误类**判定:`ParseError` → `parse`(其中 `code: 'limit_exceeded'` 仍 → `bounds`,cel-js 的越界一律由 parser 抛出)。这一层不再读文案,因此也修掉了关键词方案无法修的一格:cel-js 会把**作者自己的源码行**嵌进 `message`(`formatErrorWithHighlight`),于是字段名能决定错误分类 —— 实测 `((record.type_id)` 这条普通的括号不配对,此前被判为 `type`,只因回显的源码里含子串 "type"。

  `type` / `runtime` 两支暂仍走原关键词表:cel-js 的 `TypeChecker` 按**阶段**而非按故障选择错误类(`isEvaluating ? evaluationError : typeError`),同一个 `unknown_variable` 在 check 期是 `TypeError`、在 eval 期是 `EvaluationError`,整体结构化会改变这些既有判定。审计见 #6133。

  kind 词表本身(`parse` / `type` / `runtime` / `bounds` / `dialect`)未变,消费方未改。

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

- e9b5265: fix(formula,lint): `current_user` becomes a declared root, and its field-level rejection becomes a real rule (#6290)

  `@objectstack/formula` told two stories about one root. `introspectScope` handed
  `current_user` to authors as a legal namespace and `checkRoleCatalog`'s four
  position-membership regexes all lead with it — both correct, because ADR-0068 D1
  makes `current_user` THE canonical spelling and `buildScope` really does mount
  the same `EvalUser` under it. Only `cel-engine.ts`'s `SCOPE_ROOTS` disagreed, so
  the strict environment read the blessed spelling as a BARE FIELD REFERENCE while
  its two aliases (`user`, `ctx`) passed unremarked.

  Three things change.

  **1. `SCOPE_ROOTS` declares `current_user`.** That list is a "never faults"
  baseline, not a per-surface contract, and it now advertises exactly what the
  package advertises elsewhere. A new pin asserts the property directly: every
  root `introspectScope` reports must resolve in the strict env.

  **2. The wrong prescription is gone.** Because the rejection used to fall out of
  the baseline's omission, the author got the GENERIC bare-field diagnostic —
  "Write `record.current_user`". That shape binds on no layer of the platform, so
  an author who followed the message ended up with something strictly worse than
  what they started with, still silent. The field-level verdict now comes from a
  rule of its own in `@objectstack/lint`, which names the real failure (unbound ⇒
  fault ⇒ visibility falls back to `true` ⇒ the field a `current_user` test was
  meant to hide stays visible for everyone, #6146) and prescribes surfaces that
  exist: move the predicate to the option's own `visibleWhen`, declare field-level
  security on a permission set (`fields: { '<object>.<field>': { readable: false } }`),
  or rewrite it against `record`. It covers `visibleWhen`, `readonlyWhen` and
  `requiredWhen`, which share the one evaluator.

  **3. Per-option `visibleWhen` is validated at all.** `validate-expressions.ts`
  walked field-level conditional rules and stopped there, so `SelectOption.visibleWhen`
  — an authorable CEL slot the client filters on AND the server enforces — reached
  compile, validate and run time checked by nobody. A bare field reference, a
  reference to a field that does not exist, a syntax error or a template-dialect
  predicate in an option all shipped in silence, and the option simply never
  offered itself. Options are now walked, located by option value, on the same
  `record` scope as their host field.

  The two surfaces deliberately give opposite verdicts on `current_user`, because
  their evaluators differ: field-level rules go through `evalFieldPredicate`
  (`record` + `previous` + `parent`, never a user), options through
  `resolveCascadingOptions` against the host's predicate scope, which does bind it
  (ADR-0068 / objectui#2284). The showcase's role-gated option
  (`'admin' in current_user.positions`) had never met this rule before and is now
  pinned as the legal usage it is.

  Sweep: `objectstack validate` is clean on all three example apps
  (`app-showcase`, `app-crm`, `app-todo`) with the option walk active — zero new
  findings, including the showcase object that carries both a record-scoped
  cascade and the role-gated option.

- d5e9f6e: 字段级 `*When` 的未绑定根检查:黑名单翻成白名单,并把因果句按槽位分档

  同一段诊断上的两条**正交**分档轴,一次设计通过 —— 分开做会把这段文案写两遍,
  且第二遍推翻第一遍。

  ## 轴一:根集合从 3 项黑名单翻成 3 项白名单(#6713)

  字段级 `visibleWhen` / `readonlyWhen` / `requiredWhen` 实测只绑 `record`、
  `previous`、`parent` 三个根,三处独立证据一致:服务端
  `rule-validator.ts` 的两处绑定(`readonlyWhen` 绑
  `{ record, previous, extra: { parent } }`,`requiredWhen` 绑
  `{ record, previous, ...parentScope }`);客户端 `evalFieldPredicate` 绑
  `record` + `previous` + 调用方 `scope`,而 objectui 全部五个字段级调用点
  (`form.tsx` ×3、`WizardForm.tsx`、`GridField.tsx`)传的 `scope` 只可能是
  `undefined` 或 `{ parent }`;作者端 objectui 的
  `FIELD_RULE_ROOTS = ['record', 'previous', 'parent']`,注释明写 "nothing else"。

  而检查此前是一张**黑名单** —— #6584 一项、#6711 三项
  (`current_user` / `user` / `ctx`)。黑名单在这个面上结构性地追不上
  `SCOPE_ROOTS`:每新增一个根都要有人记得抄过来(`current_user` 自己就是 #6290
  加进去、#6584 才被发现的)。实测有 **21 个根**落在这条缝里,它们同样未绑定、
  同样 fault、而且同样**静默** —— 都在 `SCOPE_ROOTS` 里,所以裸引用检查也从不
  报它们。其中两个是高可信度的作者笔误而非理论成员:

  - `os.user.id` —— ADR-0068 D1 的**第四种**用户拼写(`buildScope` 把同一个
    `EvalUser` 挂在 `current_user` / `user` / `ctx.user` / `os.user` 下),#6711
    收了三种,`os` 这一支没收;
  - `data.status == 'x'` —— `data` 是**元数据表单**里同一个 `visibleWhen` 键的
    **合法**根(`view.zod.ts`:"Root: `record` … in runtime forms, or `data` in
    metadata forms"),两种表单同一个键名、不同的根。

  判定改为 `SCOPE_ROOTS` 成员减去白名单,列表直接从 `@objectstack/formula` 取,
  不在消费端重述 —— 因此 `SCOPE_ROOTS` 将来新增的成员自动被覆盖。

  处方随之**按根分档**:用户根(`current_user` / `user` / `ctx` / `os`)保留原有
  的选项级 `visibleWhen` 与权限集 FLS 两条用户向处方;`data` 给出元数据表单 vs
  运行期表单的解释;其余根给出通用的「改写成 `record` 谓词」。此前只有用户向处方,
  对写了 `data.type == 'select'` 的作者是答非所问。

  ## 轴二:因果句按槽位分档(#6716)

  三个槽位此前共用一句「falls back to VISIBLE … showing for everyone」,而这句话
  只对其中一个精确。三格全部**实测**,每格量了两端:

  - **`visibleWhen` —— 仅客户端、fail-OPEN,原文案正确。** 服务端根本不评估字段级
    `visibleWhen`(`ConditionalFieldDef` 无此成员,`fieldsNeedPrior` 只看
    `requiredWhen || readonlyWhen ||` 选项可见性),唯一裁决来自渲染端,
    `resolveFieldRuleState` 对可见性传 `fallback: true`。
  - **`readonlyWhen` —— 两端方向相反,服务端说了算,原文案是反的。** 服务端
    `isReadonlyWhenLocked` 命中 `unknownVariableOf` 后返回 `true`(#4889 的
    carve-out,其触发条件正是未绑定根这一类),`stripReadonlyWhenFields` 随即把该
    字段从 payload 中删除;客户端 `resolveFieldRuleState` 传 `fallback: false`,
    表单仍渲染为可编辑。按 ADR-0057 D10(server enforces, client is courtesy)以
    服务端为准:作者改了字段、保存报成功、值静默不落库。原文案告诉作者「对所有人
    可见」—— 失败方向与排障方向都相反。
  - **`requiredWhen` —— 两端都 fail-OPEN,且与可见性无关。** 服务端记日志后
    `continue`(#4977 明确没有采用 #4889 的 carve-out),客户端 `fallback: false`,
    两端都不强制,记录带着空字段保存成功。原文案在这里不只是不精确,而是说错了
    字段的哪个属性。

  `conditionalRequired` 在 `FieldSchema` 里是 `retiredKey`(按名字拒绝),解析后的
  编译路径上该分支是惰性的,因此给它一条与槽位无关的通用句,而不是编造第四格测量。

  ## `@objectstack/formula`

  `SCOPE_ROOTS` 改为公开导出。一个绑定**封闭**根集合的面,必须能说出它**不**绑定
  的那些根,而那个补集就是 `SCOPE_ROOTS` 减去该面自己的白名单;消费端手抄的列表
  追不上这张表。注意它不能用 `firstUndeclaredReference` 替代:严格环境同时声明了
  CEL 的**类型名**,`type(record.x) == string` 里的 `string` 会被判成「能解析的根」
  —— 实测按可解析性判定会误杀这条合法谓词(1 例),按 `SCOPE_ROOTS` 成员判定不会。

- cafec0a: `validateExpression`: give an over-budget expression a SIZE prescription instead of the dialect trailer (#7073)

  ADR-0032's shared validator appended one trailer to every `celEngine.compile`
  refusal, byte for byte — `— predicates are bare CEL (e.g. \`record.rating >= 4\`).`
  That sentence is right for a dialect mistake and actively wrong for a **bounds**
  refusal: an 80-clause conjunction is already bare CEL, perfectly good syntax, and
  merely over the platform's parse budget. The author was told to change the one
  thing that was never wrong; an AI author, which obeys the last sentence it was
  handed, rewrites the dialect and regresses. Reported by #6833's measurement.

  The refusal is unchanged — same inputs refused, same `Exceeded maxAstNodes (256)`
  front half from cel-js. Only the prescription is now class-aware: a `bounds`
  verdict (read off the engine's own `error.kind`, with the exceeded bound named by
  `parseCelToAstWithReason`) produces

  > invalid CEL predicate: Exceeded maxAstNodes (256) … — this is valid CEL that
  > exceeds the `maxAstNodes` budget (limit 256) — a SIZE fault, not a dialect
  > mistake, so re-spelling the expression will not fix it. Shrink it (fewer
  > clauses, shallower nesting, fewer list elements), or precompute the heavy part
  > into a stored field and reference that field instead. …

  while a genuine dialect/syntax fault keeps the old trailer verbatim. Fixed once at
  the producer, so all ~10 expression slots benefit — build, metadata registration,
  lint's `validateStackExpressions`, and the `validate_expression` tool. The
  remedies are deliberately slot-generic: the slots' combination semantics differ,
  so PR #6831's RLS-specific "splitting the top-level `&&` widens the grant" is not
  portable and splitting is offered only with a caveat.

  Also documents, text-only, the completeness gap in `cel-pushdown-limits.ts`'s
  "nothing else needs to move at GA": a third lint gate (`validateStackExpressions`)
  covers the same `sharingRules[].condition` and is mode-agnostic, so during the
  rc grace window lint is stricter than the runtime — benign, tightening-direction,
  and self-healing at GA. No behaviour change there.

- 07f1822: fix(formula): `matchesFilterCondition` 的 `$exists` 改读「有值」,与 `$null` 成严格互补

  **行为变更,影响 RLS 写侧 `check` 的判定。** `{ x: { $exists: true } }` 对
  `{ x: null }` 以前答 `true`(键存在),现在答 `false`(没有值)。

  `matchesFilterCondition` 是 RLS `check` 子句(insert/update 的 post-image)的求值器 ——
  写路径上没有查询可以下推,只能逐记录判定。它此前把 `$exists` 读成「键是否存在」
  (`actual !== undefined`),而 `driver-sql` 一直把同一个算子编译成 `IS NOT NULL`。
  于是同一条规则里的 `$exists`,写侧放行的记录读侧看不见。

  2026-08-06 裁定取「有值」,理由是另一种读法在最要紧的地方**无法兑现**:SQL 里列
  **就是** schema,一行不可能「缺一个键」,所以 `driver-sql` 除了 `IS NOT NULL` 别无
  可编译的东西。字段的存在性是 **schema** 的属性,不是**记录**的属性;spec 若声明
  「键是否存在」,就是在承诺两个后端永远交付不了的语义。因此 `driver-sql` 的发射器
  一字未动,移动的是本求值器。

  对齐之后 `$exists` 与 `$null` 在每个后端上都是严格互补:
  `$exists: true` ≡ `$null: false`,`$exists: false` ≡ `$null: true`。
  「键缺失」与「值为 null」在这里是同一个事实 —— 这也正是 `getPath` 对两者本来就
  返回同一个 `undefined` 的原因。

  `$ne` / `$nin` / `$notContains` / `$null` 四个算子本来就是本次裁定的目标语义,
  一字未改。

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

- 078e28b: fix(formula): `==` / `!=` between a date STRING field and a Date-valued binding no longer answers a silent `false` (#7168)

  A mixed-provenance comparison — the shape a hook or validation predicate writes
  every day — returned the wrong boolean with no fault and no log line:

  ```text
  record.due == previous.due
    with { record: { due: "2026-06-20" }, previous: { due: Date(2026-06-20T00:00:00Z) } }
    ->  { ok: true, value: false }        // same field, same instant
  ```

  `previous` arrives from the driver hydrated as a `Date`; `record` arrives from a
  JSON payload as a `"YYYY-MM-DD"` string. cel-js compares a `string` against a
  `google.protobuf.Timestamp` and never matches, so the predicate answered `false`
  — and `!=` on the same pair answered `true`. Nothing errored, so nothing pointed
  at it. This is the failure class that hurts most in an AI-authored filter: the
  wrong answer is shaped exactly like a legitimate one.

  `rewriteTemporalEquality` already fixed this for a temporal **call** counterpart
  (`record.due == today()`, #3183) by coercing the string operand with `date(...)`.
  It now covers a Date-valued **binding** counterpart as well. A binding's runtime
  type is not visible in the AST, so this arm is decided per row against the values
  in the evaluation scope, and its verdict is deliberately never cached against the
  expression source.

  **Comparisons that change answer** — one operand an ISO-8601 date/date-time
  string, the other a binding holding a `Date`:

  - `record.due == previous.due` (same instant) — was `false`, now `true`
  - `record.due != previous.due` (same instant) — was `true`, now `false`
  - either operand order, and a `"…T14:33:00Z"` string against the same instant

  **Comparisons that deliberately do NOT change** — the coercion requires the
  counterpart to be a real `Date` _and_ this operand to be an ISO-8601 string that
  parses, so everything below answers exactly as it did before:

  - two strings — `"2026-06-20" == "2026-06-20"` stays STRING equality
  - two `Date`s — already compared as instants
  - a different calendar day — stays `false`
  - a non-date string against a `Date` (`"hello"`) — stays `false`
  - a **numeric** string against a `Date` (`"5"`) — stays `false`. Load-bearing:
    `new Date("5")` and `new Date("05")` both parse to 2001-05-01, so coercing here
    would invent an equality between two different strings
  - a date-ONLY string against a `Date` carrying wall-clock time — stays `false`.
    `date()` parses, it does not truncate to a calendar day, and those are
    genuinely different instants; truncating both sides would turn a correct
    `false` into a wrong `true` for real datetime comparisons
  - ordering (`<` / `>=`) is untouched — that path is ADR-0032 §1c's retry
  - a string LITERAL counterpart is untouched — it is not a binding

  Cross-type `in` membership (`record.n in [1, 7]` with `n: "7"`) is a separate
  clean-path question and is unchanged, deferred by maintainer ruling on #7168
  pending a measured victim.

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
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
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
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
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
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
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
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
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
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
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
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
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
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
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
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
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
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
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
- Updated dependencies [361bd5b]
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
  - @objectstack/spec@17.0.0

## 17.0.0-rc.6

### Minor Changes

- f6cd635: fix(formula): the CEL pushdown compiler parses through the canonical front end, so `DEFAULT_LIMITS` finally apply to RLS/sharing predicates (#6132)

  `cel-to-filter.ts` — the ONE canonical CEL → `FilterCondition` pushdown compiler
  (ADR-0058 D1/D2/D6), consumed by the RLS path (`plugin-security`'s
  `RLSCompiler`), the sharing seeder (`plugin-sharing`), and the analytics SQL
  backend — kept a **private, limitless** parse environment of its own:

  ```ts
  new Environment({ unlistedVariablesAreDyn: true, enableOptionalTypes: true });
  ```

  no `limits`, no stdlib, no `rewriteNullableTernary`. That made the pushdown path
  the one place on the platform that answered a _different_ question from
  `celEngine.compile()` about what parses. Measured: a 300-term addition, a
  60-level parenthesis nest and a 200-element list literal all parsed there while
  the interpreter refused each one outright (`Exceeded maxAstNodes (256)` /
  `maxDepth (32)` / `maxListElements (64)`). Escalated: an 80-term conjunction, a
  40-level nest and a 200-element `$in` all reached **real pushdown SQL**,
  silently — and `isSupportedRlsExpression`, the ADR-0056 D4 authoring gate, was a
  thin wrapper over the same limitless environment, so it was no independent check
  either.

  It now parses through `parseCelToAstWithReason` — #4812's canonical entry, with
  `DEFAULT_LIMITS`, the stdlib and the #3306 null-guard rewrite. "What parses" has
  one answer again.

  **Within the limits nothing moves, and that is measured, not asserted.** Across
  the 710 sources of the pushdown corpus that both front ends accept, the only AST
  difference is `rewriteNullableTernary`'s `dyn(…)` wrap on the three null-guard
  ternaries — and a ternary faults on its own `?:` node before the lowerer
  descends into a branch, so verdict _and_ detail come out byte-identical. Pinned
  in `cel-to-filter-parse-convergence.test.ts`, which rebuilds the old environment
  to compare against.

  **Over the limits, behaviour changes — in two dated steps.**

  - **Now, during `17.0.0-rc.x` (`rc-grace`):** an over-limit predicate **still
    compiles** — nothing that enforces today stops enforcing on this upgrade — and
    emits one WARN per predicate naming the bound that was exceeded
    (`maxAstNodes` / `maxDepth` / `maxListElements` / …), the platform's value for
    it, and what the predicate itself measures (cel-js's own accounting: the
    smallest bound it parses under), plus what will happen at GA.
  - **At v17.0.0 GA (`fail-closed`):** the same predicate is **refused** —
    `{ ok: false, reason: 'parse-error', detail: 'Exceeded maxAstNodes (256)' }` —
    and the RLS path turns that into `RLS_DENY_FILTER`, i.e. zero rows, fail
    closed. A sharing rule with such a condition is not seeded.

  **The flip is one line.** `CEL_PUSHDOWN_LIMITS_MODE` in
  `packages/formula/src/cel-pushdown-limits.ts` — the single dated switch,
  shipping as `'rc-grace'`, to be set to `'fail-closed'` at the v17.0.0 GA release
  (i.e. when this package's version leaves `17.0.0-rc.x`). Both positions are
  exercised in CI today, in `@objectstack/formula` and in
  `@objectstack/plugin-security` (where the `RLS_DENY_FILTER` outcome lives), so
  the GA half is proven before it ships rather than after. Two tests are written
  to go red on that line so the flip cannot be silent.

  **If you author RLS or sharing predicates:** a predicate over any of these
  bounds is already refused everywhere else on the platform (`os build`,
  `os validate`, the interpreter). Split it, or move the logic into a hook/action
  body (`ScriptBody { language: 'js' }`), before upgrading past the rc line. The
  WARN names the predicate and its measure so you can find them.

  **New public surface**, for consumers that must _report_ a refusal rather than
  merely react to one:

  - `parseCelToAstWithReason(source, opts?)` — the reason-carrying sister entrance
    to `parseCelToAst`. Same front end, same verdict, but it distinguishes
    `'parse'` (not valid CEL) from `'bounds'` (valid CEL, over budget) and names
    the exceeded limit, its platform value, and the source's measure. Graded by
    the same by-class/by-code classifier `celEngine.compile` uses (#6223) — never
    by error prose. `parseCelToAst` is unchanged and still collapses every refusal
    to `null`.
  - `CelParseResult`, `CelBoundsOverrun`, `CelLimitKey`, `ParseCelToAstOptions`.
  - `CEL_PUSHDOWN_LIMITS_MODE`, `celPushdownLimitsMode()`,
    `setCelPushdownLimitsModeForTests()`, `CelPushdownLimitsMode`.

  `@objectstack/lint` needs no change, at either position of the switch. Its two
  enforceability gates read `isSupportedRlsExpression` and `compileCelToFilter`,
  both downstream of this switch, and both suites pin "the lint verdict IS the
  consumer's verdict" in both directions — so authoring-time reporting flips with
  the runtime by construction. An over-limit sharing `condition` is in fact
  already an authoring **error** today (`expression-invalid`, from the general
  expression rule, quoting `Exceeded maxAstNodes (256)`), because that rule has
  always gone through the canonical front end.

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

- 6965160: feat(lint): view/page 可见性谓词的裸标识符构建期闸门 —— 坏谓词发不出去(#6128)

  新增 **error 级** 规则 `visibility-bare-identifier`:view/page 的可见性谓词
  (`visibleWhen` 及其两个已弃用别名 `visibleOn` / `visibility`)里引用了任何绑定根都解析不到的
  顶层标识符时,`os validate` / `os build` / `os lint` 一律拒收。写成 `status == 'active'`
  而不是 `record.status == 'active'` 的谓词,从此发不出去。

  按 #5149 维护者 2026-08-06 裁决的构建期半边落地(运行时 warn-once 半边已由 objectui#3541 合入)。
  本仓传统的准确表述是:fail-open 或 fail-closed 都可以裁,**静默不可以**。谓词失败仍然 fail-open
  (已发货 app 行为不变),但坏谓词不再能进入产物。

  **为什么现有两道闸都放行**(#5149 Repro 1 实测,已写进规则注释,防后人误并):
  ADR-0032 的标识符闸(`validate-expressions.ts`)解析 record 作用域的裸引用,但它的遍历只覆盖
  objects / flows / actions / sharingRules / hooks,**从不走 views 与 pages**;ADR-0089 D3b
  只判**有根**的谓词根错层(runtime 面的 `data.`、metadata 面的 `record.`),**无根**的谓词两边都不匹配。
  两闸之间正好漏掉「作者按文档示例写了裸字段名 → 谓词永远解析失败 → 控制台 fail-open 静默显示」。

  **判定由两个既有 oracle 合成,本包不自建 CEL 环境**(#4812 的教训):声明性判定取
  `@objectstack/formula` 的 `firstUndeclaredReference`(即 `validateExpression` 给 record 作用域
  裸引用定罪的同一个严格环境),AST 取规范入口 `parseCelToAst`。AST 先收集所有处于**接收者位置**
  的标识符(`a.b` / `a?.b` / `a['b']` / `a.exists(…)`)并在检查前声明它们,于是只剩「当作裸值引用」
  的标识符会被判 —— 未知**根**(`my_record.x`)交还给 ADR-0089 D3b,不在本规则射程内。

  **与 #4953(全量 vs 稀疏绑定)的边界**:#4953 实测同一求值器在两种绑定下语义相反
  (`has(record.a)` 全量 true / 稀疏 false;`record.a != null` 全量 false / 稀疏 FAULT)。本规则
  **按构造与该分叉无关** —— 它从不追问某个 KEY 在已绑定的根上是否存在,只追问标识符有没有根,
  而无根标识符在两种绑定下都解析不到。`has(record.x)` / `record.x != null` 等守卫写法在本闸门下
  一律绿,无论 #4953 最终怎么裁;已加测试钉住这条边界。

  **遍历按实测修正,否则规则生来即死**:`os build` 跑 `examples/app-showcase` 得到的唯一一条
  view 表单谓词落在 `views[0].formViews.edit.sections[0].fields[6].visibleWhen` —— 运行时 app 形状下
  `views[]` 条目是**视图容器**(`ViewSchema` 声明的自有键就是 `list` / `form` / `listViews` /
  `formViews`),`sections` 在下一层。原遍历只读 `views[].sections`,在这份 stack 上报告「干净」。
  现在覆盖容器的 `form` 与每个 `formViews.<key>`,以及仍然直接携带 `sections` 的 `defineForm` 形状;
  pages 改走共享的 `walkPageComponents`(regions、slotted 页的 `slots`、以及 `properties` 里的
  `page:tabs` / `page:accordion` / `page:card` 子树都随之覆盖,source-authored 页按其既有语义跳过)。
  `objects[].views` 明确不读 —— 该键已被 schema 立碑拒绝,读它只会造出一条永不触发的幽灵检查。
  两条既有 ADR-0089 D3b advisory 随遍历一并变得真正可达。

  注册表 tier `advisory` → `gating`(#5762 的先例):tier 声明并非自述,
  `authoring-rule-wiring.test.ts` 会读规则源码核对。

  已知盲点(已钉测试、方向安全):字段名与 CEL **类型名**相同时(`type` / `int` / `string` / `list`
  / `map` / `timestamp` …)不判 —— CEL 自身声明这些标识符,`type == 'grid'` 到检查器那里是类型
  overload 错误而非未知变量;改读 overload 消息会误杀合法的 `type(record.x) == string`。语法不通过
  的谓词同样不判,交还给拥有该判定的闸门。两者都是漏判,永远不会变成误红。

  仓内 `app-todo` / `app-crm` / `app-showcase` 三个示例 `os validate` 全部通过、零 visibility finding,
  无需修改任何示例内容。

  `@objectstack/formula` 侧:公开导出 `firstUndeclaredReference`(理由与既有的
  `collectCelRootIdentifiers` 一致 —— 绑定根集合不同的消费方需要的是同一个答案,替代方案是在消费方
  自建严格 `Environment`,而那正是 #4812 从本包消费方手里拿掉的私有前端)。

### Patch Changes

- b230e5e: fix(formula): `classifyError` grades a CEL fault by error class + code, never by the message (#6223)

  `EvalResult.error.kind` is author-facing — `@objectstack/objectql`'s `cel-fault`
  puts it in front of the author as `` `${kind}: ${first line}` `` and
  `packages/rest` re-emits it as the HTTP body's `reason`. cel-js embeds the
  author's own **source line** in `message` (`formatErrorWithHighlight`), so a
  classifier that regex-matches that text is matching text the author writes.
  PR #6202 closed the `ParseError` arm this way and left `type` / `runtime` on the
  keyword table pending a per-code audit. This is that audit, and its verdict is
  that the table goes entirely.

  Measured on cel-js 8.0.0 — one `no such overload` **evaluation** fault, four
  field names, three wrong answers:

  ```text
  record.status        > 1  ->  runtime   (right)
  record.parse_status  > 1  ->  parse     (wrong)
  record.syntax_mode   > 1  ->  parse     (wrong)
  record.type_code     > 1  ->  type      (wrong)
  ```

  `parse` is the inverse of the #6133 misdirection: the expression is
  syntactically perfect and failed on the data, and the author was told to go fix
  an expression that has nothing wrong with it.

  `classifyError` now reads only structured contract:

  - `ParseError` -> `bounds` when `code === 'limit_exceeded'`, else `parse`
    (unchanged, from #6202);
  - `EvaluationError` -> `type` for the one declaration-class code
    (`unknown_variable`, the root identifier is not bound in this scope at all),
    else `runtime`;
  - anything that is not a cel-js error -> `runtime`.

  Two findings from the audit worth recording. First, the residual keyword arm was
  **not** dormant: `matches()` is an ObjectStack stdlib binding over `new
RegExp(...)`, so an uncompilable pattern escapes as a native `SyntaxError` whose
  message echoes the pattern — and the pattern can come off the row, not just out
  of the source. `matches(record.name, record.re)` with `re = "type("` was
  graded `type`; with `"Exceeded maxAstNodes("` it was graded `bounds`. A data
  value was picking the error kind. Second, there is deliberately no `TypeError`
  arm: cel-js raises that class only from its non-evaluating `TypeChecker`, which
  runs only inside `Environment#check`, and that method catches it and _returns_
  `{ valid: false, error }`. The check-time `TypeError -> type` mapping already
  lives in `celEngine.compile`, which reads that object.

  Six evaluate-time codes change verdict from `type` to `runtime`
  (`int_conversion_error`, `uint_conversion_error`, `double_conversion_error`,
  `invalid_index_type`, `heterogeneous_list_element`,
  `invalid_comprehension_range`). Each is a fault decided against the row; every
  one of them was graded `type` only because cel-js happens to use the word "type"
  in its prose (`int() type error: cannot convert to int`). Every evaluate-time
  code the engine can reach now has a fixture pinning its `kind`.

- 5d24f4b: fix(formula): the ADR-0032 §1c retry rewrites only the operands that faulted (#7098)

  **A CEL expression could return a silently wrong boolean.** No fault, no log
  line, no failing test — `{ ok: true }` with the wrong answer. If you have
  compound CEL that mixes a numeric comparison with a string equality over
  string-serialized fields, read the "which expressions change answer" list below:
  those expressions answer differently after this fix, and the new answer is the
  right one.

  ## What was wrong

  When a comparison faults on a string-serialized numeric or date field
  (`record.rating >= 4` where `rating` reads back as `"5.0"` — #1530 / #1534),
  ADR-0032 §1c hydrates and retries. The retry hydrated the **entire scope** and
  re-ran the **entire expression**, justified by a docblock claim that it

  > can never change a comparison that already evaluated cleanly — it only rescues
  > one that already faulted.

  That claim was false, and it was load-bearing: it was the stated reason the
  hydration was allowed to be unconditional and scope-wide. The retry knows only
  that the _whole expression_ faulted, not that each sub-comparison did. So:

  ```text
  record.n >= 4 && record.s == "5.0"    with { n: "7", s: "5.0" }
    before -> { ok: true, value: false }        after -> { ok: true, value: true }
  ```

  `record.n >= 4` faults and is correctly rescued. But `record.s` was hydrated to
  the number `5` as well, so the author's deliberate string equality — **true**
  when it was evaluated the first time — became `5 == "5.0"`, which CEL answers
  `false` across types. The expression returned `false`, and nothing reported that
  a clean answer had been overruled.

  ## Which expressions change answer

  Only expressions that **already reached the §1c retry** — i.e. some operand
  faulted `no such overload`. Everything that evaluates without faulting is
  untouched. Within that set, an expression changes answer when it also contains:

  - **a string equality / inequality on a numeric-looking or ISO-date field** —
    `record.n >= 4 && record.s == "5.0"`, and the `!=` and ternary forms. Now
    answers on the string the author wrote.
  - **a string membership test** — `record.s in ["5.0", "x"]`.
  - **the same field compared as a number in one place and as a string in
    another** — `record.n >= 4 && record.n == "7"`. Both answers are now correct
    at once; previously the second was collateral damage from the first.
  - **a numeric-looking string the expression RETURNS rather than compares** —
    `record.n >= 4 ? record.s : "none"` returned the number `5`; it now returns
    the string `"5.0"`. A `Field.formula` of type text was storing a different
    value than the record held.

  One class becomes a **loud fault where it used to be silently rescued**: an
  operand whose value the rewrite cannot read before deciding — bound by a
  comprehension (`record.items.exists(i, i.price > 100)`), or behind a computed
  index. That is the deliberate trade of this fix. Rescuing an operand we cannot
  prove faulted is exactly the defect being closed, so those report the original
  `no such overload` instead of guessing. The reported error is unchanged in shape
  and message.

  ## What replaces it

  The coercion is now **per operand position** — the same discipline
  `rewriteTemporalEquality` already documents ("no field-wide trade-off"), one
  step stricter. The scope is never rewritten; the faulting operand is wrapped in
  `double(…)` or `date(…)` in place. An operand is rewritten only when all three
  hold, which makes the docblock's guarantee true by construction rather than by
  assertion:

  1. the operator **raises** on a string-versus-number/Timestamp pair instead of
     answering one, so the comparison cannot have produced an answer;
  2. the counterpart is a number or a Timestamp **in this scope**, read off the
     values in hand rather than off a static type (every field is `dyn` under
     `unlistedVariablesAreDyn`);
  3. the operand's own value is a §1c serialization artifact — an entirely-numeric
     string or an ISO-8601 date. A zip like `"02134"`, or free text, still faults
     loudly.

  Measured per operator on cel-js 8.0.0 and pinned in the new tests: `<` `<=` `>`
  `>=` `+` `-` `*` `/` `%` **fault** on a mixed pair and are eligible. `==`, `!=`
  and `in` **answer** across types — CEL equality is total — so they already had
  an answer and are never rewritten. That measurement is the root of the defect:
  the string equality above never faulted at all.

  `Field.date` strings not matching a Timestamp under `==` remains owned by
  `rewriteTemporalEquality`, which wraps them statically on the clean path, where
  both sides are known from the source instead of inferred from an unrelated
  conjunct's fault.

  ## Reach

  `celEngine.evaluate` — the only home of this retry — does **not** reach RLS.
  Row-level security compiles its `using` / `check` predicates through
  `compileCelToFilter` (SQL pushdown) and `matchesFilterCondition` (write-side
  post-image), and declared sharing rules do the same; neither calls this
  evaluator. No access-control decision could be inverted by this.

  It does reach write-gating decisions, which is why the behaviour was not
  acceptable as documented: validation-rule predicates and `when` conditionals,
  `readonlyWhen`, hook `condition`s, automation/flow conditions, and formula
  fields and default values. A validation rule is **fail-closed** on a fault
  (#4649) — but a silently flipped boolean is not a fault, so a rule that should
  have rejected a write instead read as "not violated" and let it through.

- 29b94ed: fix(formula): the CEL hydration retry arms off cel-js's structured code, not the phrase "no such overload" (#6679)

  `celEngine.evaluate` catches a fault and asks `isNumericOverloadError` whether to
  hydrate string-serialized numeric / date fields and re-evaluate once — the
  ADR-0032 §1c accommodation for `Field.rating` → `"5.0"` and `Field.date` →
  `"2026-06-20"` (#1530, #1534). That question was answered by
  `/no such overload/i.test(err.message)`: the last message-text read in
  `cel-engine.ts` that armed behaviour after #6223 / PR #6677 closed the same hole
  in `classifyError`. It now reads
  `err instanceof EvaluationError && err.code === 'no_such_overload'`, the same
  class-and-code rule `classifyCelFault` already follows one function below.

  The phrase was reachable from a **native** throw, not only from cel-js. Our
  `matches()` stdlib binding is `new RegExp(String(re)).test(...)`, so an
  uncompilable pattern escapes cel-js unwrapped as a `SyntaxError` echoing the
  pattern verbatim — `Invalid regular expression: /no such overload(/` — which
  matched. The pattern can be written in the source or read off a row via
  `matches(record.name, record.re)`.

  The filing recorded this as observation-class, expecting the consequence to be
  nil because the retry re-throws the original error. Measuring it for the fix
  found one case where it is not nil, so this ships as a fix rather than a
  tolerance removal: when hydration lets the expression short-circuit around the
  throwing call, the spurious retry **succeeds** and returns a value where the
  fault was the right answer.

  ```text
  record.s == "5.0" ? matches(record.name, "no such overload(") : false
    { s: "5.0", name: "x" }   ->  was: ok, false        now: the regex fault
  record.s == "5.0" ? matches(record.name, "(") : false
    { s: "5.0", name: "x" }   ->  the regex fault       (unchanged)
  ```

  Evaluation 1 takes the `matches(...)` branch and throws natively; the phrase
  armed the retry; hydration made `record.s` the number `5`, so `5 == "5.0"` went
  false, the ternary took the other branch, and `matches` was never called. Two
  expressions that differ only in whether a regex literal happens to contain the
  phrase no longer disagree about whether they fault.

  The behaviour change is one-directional and narrow. A genuine cel-js
  `no_such_overload` still arms the retry and every §1c hydration behaves exactly
  as before; only a native throw whose message merely contains the phrase stops
  arming it. Faults are otherwise unchanged — a native throw carries no cel-js
  contract, so it is still reported as `runtime` (#6223).

- 07c68b0: fix(formula): 括号/引号/转义等 parse 期错误不再被误报为 `runtime`

  `celEngine` 的错误分类此前完全靠**错误文案关键词**判定,而 cel-js 8.0.0 的 parse 期错误有约 19 种措辞,只有 3 种含 `parse` / `unexpected` / `syntax`。其余整类 —— 最典型的括号/方括号/花括号不配对(`Expected RPAREN, got EOF`)、未闭合字符串、非法转义、保留字 —— 全部落到默认值 `runtime`。

  `kind` 不是内部字段:它被原样拼进作者可见的写入拒绝文案(`@objectstack/objectql` 的 `rule-validator` / `cel-fault`)与 REST 错误响应体的 `reason`。少写一个右括号的校验规则,作者读到的是 `(runtime: …)` —— 指向数据与求值期,而真正该改的是表达式本身,与 ADR-0032 D1d 的"消息面向自纠"相悖。

  改为按 cel-js 抛出的**错误类**判定:`ParseError` → `parse`(其中 `code: 'limit_exceeded'` 仍 → `bounds`,cel-js 的越界一律由 parser 抛出)。这一层不再读文案,因此也修掉了关键词方案无法修的一格:cel-js 会把**作者自己的源码行**嵌进 `message`(`formatErrorWithHighlight`),于是字段名能决定错误分类 —— 实测 `((record.type_id)` 这条普通的括号不配对,此前被判为 `type`,只因回显的源码里含子串 "type"。

  `type` / `runtime` 两支暂仍走原关键词表:cel-js 的 `TypeChecker` 按**阶段**而非按故障选择错误类(`isEvaluating ? evaluationError : typeError`),同一个 `unknown_variable` 在 check 期是 `TypeError`、在 eval 期是 `EvaluationError`,整体结构化会改变这些既有判定。审计见 #6133。

  kind 词表本身(`parse` / `type` / `runtime` / `bounds` / `dialect`)未变,消费方未改。

- e9b5265: fix(formula,lint): `current_user` becomes a declared root, and its field-level rejection becomes a real rule (#6290)

  `@objectstack/formula` told two stories about one root. `introspectScope` handed
  `current_user` to authors as a legal namespace and `checkRoleCatalog`'s four
  position-membership regexes all lead with it — both correct, because ADR-0068 D1
  makes `current_user` THE canonical spelling and `buildScope` really does mount
  the same `EvalUser` under it. Only `cel-engine.ts`'s `SCOPE_ROOTS` disagreed, so
  the strict environment read the blessed spelling as a BARE FIELD REFERENCE while
  its two aliases (`user`, `ctx`) passed unremarked.

  Three things change.

  **1. `SCOPE_ROOTS` declares `current_user`.** That list is a "never faults"
  baseline, not a per-surface contract, and it now advertises exactly what the
  package advertises elsewhere. A new pin asserts the property directly: every
  root `introspectScope` reports must resolve in the strict env.

  **2. The wrong prescription is gone.** Because the rejection used to fall out of
  the baseline's omission, the author got the GENERIC bare-field diagnostic —
  "Write `record.current_user`". That shape binds on no layer of the platform, so
  an author who followed the message ended up with something strictly worse than
  what they started with, still silent. The field-level verdict now comes from a
  rule of its own in `@objectstack/lint`, which names the real failure (unbound ⇒
  fault ⇒ visibility falls back to `true` ⇒ the field a `current_user` test was
  meant to hide stays visible for everyone, #6146) and prescribes surfaces that
  exist: move the predicate to the option's own `visibleWhen`, declare field-level
  security on a permission set (`fields: { '<object>.<field>': { readable: false } }`),
  or rewrite it against `record`. It covers `visibleWhen`, `readonlyWhen` and
  `requiredWhen`, which share the one evaluator.

  **3. Per-option `visibleWhen` is validated at all.** `validate-expressions.ts`
  walked field-level conditional rules and stopped there, so `SelectOption.visibleWhen`
  — an authorable CEL slot the client filters on AND the server enforces — reached
  compile, validate and run time checked by nobody. A bare field reference, a
  reference to a field that does not exist, a syntax error or a template-dialect
  predicate in an option all shipped in silence, and the option simply never
  offered itself. Options are now walked, located by option value, on the same
  `record` scope as their host field.

  The two surfaces deliberately give opposite verdicts on `current_user`, because
  their evaluators differ: field-level rules go through `evalFieldPredicate`
  (`record` + `previous` + `parent`, never a user), options through
  `resolveCascadingOptions` against the host's predicate scope, which does bind it
  (ADR-0068 / objectui#2284). The showcase's role-gated option
  (`'admin' in current_user.positions`) had never met this rule before and is now
  pinned as the legal usage it is.

  Sweep: `objectstack validate` is clean on all three example apps
  (`app-showcase`, `app-crm`, `app-todo`) with the option walk active — zero new
  findings, including the showcase object that carries both a record-scoped
  cascade and the role-gated option.

- d5e9f6e: 字段级 `*When` 的未绑定根检查:黑名单翻成白名单,并把因果句按槽位分档

  同一段诊断上的两条**正交**分档轴,一次设计通过 —— 分开做会把这段文案写两遍,
  且第二遍推翻第一遍。

  ## 轴一:根集合从 3 项黑名单翻成 3 项白名单(#6713)

  字段级 `visibleWhen` / `readonlyWhen` / `requiredWhen` 实测只绑 `record`、
  `previous`、`parent` 三个根,三处独立证据一致:服务端
  `rule-validator.ts` 的两处绑定(`readonlyWhen` 绑
  `{ record, previous, extra: { parent } }`,`requiredWhen` 绑
  `{ record, previous, ...parentScope }`);客户端 `evalFieldPredicate` 绑
  `record` + `previous` + 调用方 `scope`,而 objectui 全部五个字段级调用点
  (`form.tsx` ×3、`WizardForm.tsx`、`GridField.tsx`)传的 `scope` 只可能是
  `undefined` 或 `{ parent }`;作者端 objectui 的
  `FIELD_RULE_ROOTS = ['record', 'previous', 'parent']`,注释明写 "nothing else"。

  而检查此前是一张**黑名单** —— #6584 一项、#6711 三项
  (`current_user` / `user` / `ctx`)。黑名单在这个面上结构性地追不上
  `SCOPE_ROOTS`:每新增一个根都要有人记得抄过来(`current_user` 自己就是 #6290
  加进去、#6584 才被发现的)。实测有 **21 个根**落在这条缝里,它们同样未绑定、
  同样 fault、而且同样**静默** —— 都在 `SCOPE_ROOTS` 里,所以裸引用检查也从不
  报它们。其中两个是高可信度的作者笔误而非理论成员:

  - `os.user.id` —— ADR-0068 D1 的**第四种**用户拼写(`buildScope` 把同一个
    `EvalUser` 挂在 `current_user` / `user` / `ctx.user` / `os.user` 下),#6711
    收了三种,`os` 这一支没收;
  - `data.status == 'x'` —— `data` 是**元数据表单**里同一个 `visibleWhen` 键的
    **合法**根(`view.zod.ts`:"Root: `record` … in runtime forms, or `data` in
    metadata forms"),两种表单同一个键名、不同的根。

  判定改为 `SCOPE_ROOTS` 成员减去白名单,列表直接从 `@objectstack/formula` 取,
  不在消费端重述 —— 因此 `SCOPE_ROOTS` 将来新增的成员自动被覆盖。

  处方随之**按根分档**:用户根(`current_user` / `user` / `ctx` / `os`)保留原有
  的选项级 `visibleWhen` 与权限集 FLS 两条用户向处方;`data` 给出元数据表单 vs
  运行期表单的解释;其余根给出通用的「改写成 `record` 谓词」。此前只有用户向处方,
  对写了 `data.type == 'select'` 的作者是答非所问。

  ## 轴二:因果句按槽位分档(#6716)

  三个槽位此前共用一句「falls back to VISIBLE … showing for everyone」,而这句话
  只对其中一个精确。三格全部**实测**,每格量了两端:

  - **`visibleWhen` —— 仅客户端、fail-OPEN,原文案正确。** 服务端根本不评估字段级
    `visibleWhen`(`ConditionalFieldDef` 无此成员,`fieldsNeedPrior` 只看
    `requiredWhen || readonlyWhen ||` 选项可见性),唯一裁决来自渲染端,
    `resolveFieldRuleState` 对可见性传 `fallback: true`。
  - **`readonlyWhen` —— 两端方向相反,服务端说了算,原文案是反的。** 服务端
    `isReadonlyWhenLocked` 命中 `unknownVariableOf` 后返回 `true`(#4889 的
    carve-out,其触发条件正是未绑定根这一类),`stripReadonlyWhenFields` 随即把该
    字段从 payload 中删除;客户端 `resolveFieldRuleState` 传 `fallback: false`,
    表单仍渲染为可编辑。按 ADR-0057 D10(server enforces, client is courtesy)以
    服务端为准:作者改了字段、保存报成功、值静默不落库。原文案告诉作者「对所有人
    可见」—— 失败方向与排障方向都相反。
  - **`requiredWhen` —— 两端都 fail-OPEN,且与可见性无关。** 服务端记日志后
    `continue`(#4977 明确没有采用 #4889 的 carve-out),客户端 `fallback: false`,
    两端都不强制,记录带着空字段保存成功。原文案在这里不只是不精确,而是说错了
    字段的哪个属性。

  `conditionalRequired` 在 `FieldSchema` 里是 `retiredKey`(按名字拒绝),解析后的
  编译路径上该分支是惰性的,因此给它一条与槽位无关的通用句,而不是编造第四格测量。

  ## `@objectstack/formula`

  `SCOPE_ROOTS` 改为公开导出。一个绑定**封闭**根集合的面,必须能说出它**不**绑定
  的那些根,而那个补集就是 `SCOPE_ROOTS` 减去该面自己的白名单;消费端手抄的列表
  追不上这张表。注意它不能用 `firstUndeclaredReference` 替代:严格环境同时声明了
  CEL 的**类型名**,`type(record.x) == string` 里的 `string` 会被判成「能解析的根」
  —— 实测按可解析性判定会误杀这条合法谓词(1 例),按 `SCOPE_ROOTS` 成员判定不会。

- cafec0a: `validateExpression`: give an over-budget expression a SIZE prescription instead of the dialect trailer (#7073)

  ADR-0032's shared validator appended one trailer to every `celEngine.compile`
  refusal, byte for byte — `— predicates are bare CEL (e.g. \`record.rating >= 4\`).`
  That sentence is right for a dialect mistake and actively wrong for a **bounds**
  refusal: an 80-clause conjunction is already bare CEL, perfectly good syntax, and
  merely over the platform's parse budget. The author was told to change the one
  thing that was never wrong; an AI author, which obeys the last sentence it was
  handed, rewrites the dialect and regresses. Reported by #6833's measurement.

  The refusal is unchanged — same inputs refused, same `Exceeded maxAstNodes (256)`
  front half from cel-js. Only the prescription is now class-aware: a `bounds`
  verdict (read off the engine's own `error.kind`, with the exceeded bound named by
  `parseCelToAstWithReason`) produces

  > invalid CEL predicate: Exceeded maxAstNodes (256) … — this is valid CEL that
  > exceeds the `maxAstNodes` budget (limit 256) — a SIZE fault, not a dialect
  > mistake, so re-spelling the expression will not fix it. Shrink it (fewer
  > clauses, shallower nesting, fewer list elements), or precompute the heavy part
  > into a stored field and reference that field instead. …

  while a genuine dialect/syntax fault keeps the old trailer verbatim. Fixed once at
  the producer, so all ~10 expression slots benefit — build, metadata registration,
  lint's `validateStackExpressions`, and the `validate_expression` tool. The
  remedies are deliberately slot-generic: the slots' combination semantics differ,
  so PR #6831's RLS-specific "splitting the top-level `&&` widens the grant" is not
  portable and splitting is offered only with a caveat.

  Also documents, text-only, the completeness gap in `cel-pushdown-limits.ts`'s
  "nothing else needs to move at GA": a third lint gate (`validateStackExpressions`)
  covers the same `sharingRules[].condition` and is mode-agnostic, so during the
  rc grace window lint is stricter than the runtime — benign, tightening-direction,
  and self-healing at GA. No behaviour change there.

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
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
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

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

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

- 58f3220: 新增规范 parse-to-AST 入口 `parseCelToAst(source)`,并 re-export AST 节点类型 `CelAstNode`(#4812)。

  `parseCelToAst` 与 `compile` / `evaluate` / `collectCelRootIdentifiers` 共用同一条前端链路
  ——#3306 的 `rewriteNullableTernary` 重写、`DEFAULT_LIMITS` 边界、以及注册了 stdlib 的
  `unlistedVariablesAreDyn: true` 环境 —— 因此全仓对「什么能解析」只有一个答案。此前消费方
  若自建 `new Environment(...)`,拿到的是一份**不带 limits** 的答案:它会解析、并进而推理
  `compile()` 直接拒绝的表达式。

  `parseCelToAst` 只做 parse,不做 check(后者是 `compile()` 的职责):解析成功但类型检查失败的
  表达式(大量 `dyn` 操作数的谓词即是)仍然会拿到 AST。解析失败返回 `null` 而不抛错。

  `CelAstNode` 的 re-export 补上了一个既有缺口:`lowerCelAst` 一直接收 cel-js 的 `ASTNode`,
  而该类型从未导出,消费方只能越过本包直接依赖 `@marcbachmann/cel-js` —— 这正是第二个解析入口
  的成因。

- bf1edef: feat(formula,lint): wire ADR-0056 D4's RLS authoring gate, from the runtime's own predicate (#4983)

  `isSupportedRlsExpression` has carried the same docblock since ADR-0056 D4:
  "exposed so an authoring-time gate (`objectstack compile`) can REJECT a
  predicate the runtime would silently drop … A `false` here means 'this
  predicate will never enforce'." It had **no non-test consumer anywhere** — the
  function written to fix declared-but-never-read was itself declared and never
  read. This lands the consumer, in two steps that had to happen in this order.

  **1. `sqlPredicateToCel` and `isSupportedRlsExpression` move FROM
  `@objectstack/plugin-security` (`src/rls-compiler.ts`) TO `@objectstack/formula`
  (`src/rls-predicate.ts`), and are exported from its root.** Executable code
  unchanged — a change of address, not of behaviour; `plugin-security` now imports
  them from `@objectstack/formula` and keeps no copy, so there is still exactly
  one definition. No import path outside the two packages changes: neither symbol
  was ever exported from `@objectstack/plugin-security`'s entry point. The move is
  what makes step 2 possible at all — `@objectstack/lint` may depend on
  `@objectstack/spec` and never on a runtime, so with the predicate living in a
  runtime the gate's only other door was copying the SQL→CEL bridge, whose
  boundary conditions (quoted literals are never rewritten; canonical CEL passes
  through unchanged) _are_ the gate's red/green line. A fork drifting by one
  character rejects policies the runtime executes correctly — the false-positive
  direction, which is worse than the gap. ADR-0058 D1 asks for a single canonical
  shape gate; the bridge is part of that gate.

  **2. New `@objectstack/lint` rule `validateRlsPredicateEnforceability`,
  `error`, on all three authoring commands**, over
  `permissions[].rowLevelSecurity[].using` and `.check`:

  - **`rls-predicate-unenforceable`** — parses as CEL, outside the pushdown
    subset: a function call (`size(...)`, `has(...)`), arithmetic, a ternary, a
    cross-object path (`record.account.region`).
  - **`rls-predicate-unparseable`** — does not parse as CEL even after the legacy
    SQL bridge (`=` → `==`, `IN` → `in`): SQL `AND` / `OR` / `LIKE`, a subquery.
    Its own id because the fix is different — write CEL (`&&`, `||`), not a
    different shape.

  What the gate prevents, measured through `plugin-security` rather than inferred:
  `RLSCompiler` drops the policy and logs one request-time WARN. On the read path,
  when it is the only applicable policy, `compileFilter` returns the
  `RLS_DENY_FILTER` sentinel instead, which is AND-ed onto the where clause — so
  every select / update / delete on the object matches **zero rows**. On the
  ADR-0058 D4 write path the post-image `check` becomes that same sentinel, which
  no record satisfies, so every insert / update fails with `PermissionDeniedError`.
  The runtime fails closed, which is why this was survivable: the result is not a
  hole but a policy that reads as an authorization and behaves as a blanket
  refusal, with nothing at authoring time pointing at the line that caused it.

  Fix a flagged predicate by rewriting it inside the lowerable subset — `==` `!=`
  `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
  `startsWith` / `endsWith` / `contains` over single-column field paths (ADR-0058
  D2), against a literal or a `current_user.*` value. Two specific migrations:
  `has(x)` / `size(x) > 0` → `x != null` (a function call is correct in an object
  _validation_ rule, which is interpreted, and wrong here, where the predicate is
  compiled to a filter); and a related record's field → denormalise it onto this
  object (formula/rollup) and test that column, since RLS cannot join (ADR-0055).

  Same construction as the sharing-rule gate (#4698): the rule does not model the
  consumer or grep for it — it calls `isSupportedRlsExpression`, the exact
  function `RLSCompiler.compileFilter` consults to decide whether a dropped policy
  earns its warning, so the two verdicts are one boolean by construction, pinned
  in both directions over a shared corpus. Measured before shipping: every RLS
  predicate declared anywhere in this repo — the `plugin-security` platform seeds,
  the examples, the dogfood fixtures, the authoring skill — is supported, so the
  gate turns nothing red that works today. Unlike the sharing-rule gate, CEL
  _syntax_ is reported here rather than deferred to `expression-invalid`:
  `validateStackExpressions` does not walk `rowLevelSecurity` at all, and could not
  judge this field correctly if it did, because `owner_id = current_user.id` is a
  CEL syntax error and a working RLS predicate at the same time.

### Patch Changes

- 07f1822: fix(formula): `matchesFilterCondition` 的 `$exists` 改读「有值」,与 `$null` 成严格互补

  **行为变更,影响 RLS 写侧 `check` 的判定。** `{ x: { $exists: true } }` 对
  `{ x: null }` 以前答 `true`(键存在),现在答 `false`(没有值)。

  `matchesFilterCondition` 是 RLS `check` 子句(insert/update 的 post-image)的求值器 ——
  写路径上没有查询可以下推,只能逐记录判定。它此前把 `$exists` 读成「键是否存在」
  (`actual !== undefined`),而 `driver-sql` 一直把同一个算子编译成 `IS NOT NULL`。
  于是同一条规则里的 `$exists`,写侧放行的记录读侧看不见。

  2026-08-06 裁定取「有值」,理由是另一种读法在最要紧的地方**无法兑现**:SQL 里列
  **就是** schema,一行不可能「缺一个键」,所以 `driver-sql` 除了 `IS NOT NULL` 别无
  可编译的东西。字段的存在性是 **schema** 的属性,不是**记录**的属性;spec 若声明
  「键是否存在」,就是在承诺两个后端永远交付不了的语义。因此 `driver-sql` 的发射器
  一字未动,移动的是本求值器。

  对齐之后 `$exists` 与 `$null` 在每个后端上都是严格互补:
  `$exists: true` ≡ `$null: false`,`$exists: false` ≡ `$null: true`。
  「键缺失」与「值为 null」在这里是同一个事实 —— 这也正是 `getPath` 对两者本来就
  返回同一个 `undefined` 的原因。

  `$ne` / `$nin` / `$notContains` / `$null` 四个算子本来就是本次裁定的目标语义,
  一字未改。

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
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
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

## 17.0.0-rc.2

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
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
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

## 17.0.0-rc.1

### Minor Changes

- 4965bfa: Warn on flow-node `config` keys the node type does not declare (#4045).

  `FlowNodeSchema.config` is `z.record(z.unknown())`, so a misspelled or invented
  config key was accepted in total silence: `visibleIf` instead of `visibleWhen`
  registered cleanly, was never read, and the only symptom was a feature that quietly
  did not happen. That diagnostic vacuum is what made #3528 take three passes and two
  wrong diagnoses to resolve.

  `registerFlow` now compares each node's `config` against its descriptor's
  `configSchema` and warns on anything undeclared, located and with the declared set
  listed:

  ```
  [flow 'lead_conversion'] node 'screen_1' (screen): unknown config key `visibleIf`
    at config.fields[0].visibleIf — It is not declared by this node type's
    configSchema, so nothing reads it. Declared here: name, label, type, required,
    visibleWhen.
  ```

  The walk descends where the schema declares structure and **stops at free-form
  keyValue maps**, whose keys are author data (`filter: { status: 'stale' }`).
  Descending matters: the #3528 typo class lives _inside_ the `screen` field
  repeater, so a top-level-only comparison would miss the exact mistake this exists
  to catch.

  **Warn, never reject.** An undeclared key is an author typo, a key the executor
  genuinely reads that its hand-written `configSchema` never declared (`notify.source`
  was exactly this), or dead config. Only 4 of the 13 schema-carrying builtins have
  been audited for the second population, so hard-failing would gamble on the other
  nine. Tightening to an error is a later, per-key decision once this warning has
  measured the real distribution. Nothing about the published `configSchema` changes,
  so no consumer sees a different shape.

  `@objectstack/formula` now exports `nearestName`, the edit-distance helper already
  used for unknown-field and unknown-role suggestions, so "did you mean?"
  diagnostics share one threshold. It is deliberately a bonus rather than the
  mechanism — `visibleIf` → `visibleWhen` is distance 4 against a threshold of 3, so
  the declared set is always listed instead of only as a fallback.

  Also fixes the first real finding from the new check: `showcase_inquiry_purge`'s
  `get_record` node carried `mode: 'records'`, which no executor reads, with a comment
  crediting it for behaviour that `limit > 1` actually produces.

### Patch Changes

- 2af1988: fix(formula,spec,core): the RLS write-side `check` evaluator honours calendar-day upper bounds (ADR-0053 D-D)

  `@objectstack/formula`'s `matchesFilterCondition` — the evaluator behind RLS
  write-side `check` policies (ADR-0058 D4) — compared a bare `YYYY-MM-DD` `$lte`
  bound literally. On a `datetime` post-image that meant a policy of the shape
  `{ signed_on: { $lte: '{today}' } }` **denied every write made after 00:00**:
  the write-side twin of the read-side data loss #3777 fixed, and the last of the
  platform's filter backends that disagreed about what a bare day means as a
  bound.

  `$lte` and a `$between` max now evaluate half-open against the next calendar
  day, matching the SQL compiler, the memory and mongo drivers, and the analytics
  preview evaluator. Unchanged, per the same semantics table: full-ISO bounds keep
  exact-instant semantics, `$gte`/`$gt`/`$lt` keep their midnight anchoring, and a
  plain `YYYY-MM-DD` value compares identically (string ordering makes the two
  forms equivalent). The evaluator stays fail-closed on a null bound.

  **Where the rule now lives.** `nextUtcCalendarDay` moved from
  `@objectstack/core` to `@objectstack/spec/data` — beside `date-macros.zod.ts`,
  whose vocabulary it interprets. `formula` cannot depend on `core`, and a second
  copy of the rule is exactly the divergence #3777 catalogued; `spec` is the one
  package all six consumers already depend on, so this adds no dependency edge.

  No import changes are required: `@objectstack/core` re-exports the symbol, so
  existing `import { nextUtcCalendarDay } from '@objectstack/core'` keeps working.
  New code should prefer `@objectstack/spec/data`.

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
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
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

## 17.0.0-rc.0

### Minor Changes

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

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

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Minor Changes

- 6b51346: feat(formula): `dateField == today()` now matches — AST temporal-comparison rewrite (#3183)

  **Behavior change (the fix):** a `Field.date` compared with `==`/`!=` against a
  temporal function now matches on the calendar day. Previously it **silently
  returned the wrong answer** — `record.due_date == today()` was always `false`
  (and `!= today()` always `true`) even for a same-day record, because a
  `Field.date` reads back as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1) and
  cel-js's equality (`overloads.js` `isEqual`) treats a string and a timestamp as
  unequal without consulting any overload.

  `celEngine.evaluate` now rewrites the parsed AST: for each `==`/`!=` whose one
  operand is `today()`/`daysFromNow()`/`daysAgo()`/`now()`, the **field operand**
  is wrapped in `date(...)` (the stdlib coercion), then the expression is
  serialized and evaluated. So `record.due_date == today()` runs as
  `date(record.due_date) == today()`.

  - **Per-occurrence**, not per-field: `record.d == "2026-06-20" || record.d == today()`
    keeps the string-literal comparison intact while fixing the temporal one.
  - **Type-blind-safe**: `date()` degrades gracefully — an already-`Date`
    (`Field.datetime`) operand passes through; a non-date string or null →
    `Invalid Date` → the comparison stays `false`, exactly as before. No
    field-type information is needed, and no currently-correct result is worsened.
  - **Cheap**: the rewrite only reserializes when such a comparison is present
    (a plain-`includes` gate skips the rest), and is memoized per source string.

  Applies to every interpreter site — read-time `Field.formula`, default values,
  validation rules, hook conditions, and flow conditions — since all route through
  `celEngine.evaluate`. RLS/sharing conditions are unaffected: they compile via
  `cel-to-filter`, which already rejects function calls as a loud authoring error.

  **Supersedes the #3192 advisory lint.** That build-time warning
  (`checkTemporalDateEquality`) flagged `dateField == today()` as a silent-miss;
  with the runtime fixed it would be a false alarm, so it (and the
  `temporalEqualityFields` helper it used) is removed. Authors can now write the
  natural `record.due_date == today()` directly; the `date(...)` /
  `daysBetween(...) == 0` / range idioms all keep working.

- 80273c8: feat(formula): warn when a `date` field is compared to a temporal function with `==`/`!=` (#3183)

  A `Field.date` deserializes as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1), and
  cel-js's equality hard-codes `string == <timestamp>` to `false` — it returns
  `false` for a string left operand without ever consulting a registered overload,
  and refuses cross-type object equality (`@marcbachmann/cel-js` `overloads.js`
  `isEqual`). So the most natural "is it due today" predicate —

  ```cel
  record.due_date == today()      // silently false, even when due_date IS today
  record.due_date != today()      // silently true for a same-day record
  ```

  — compiles clean, throws nothing, and silently never matches. Same silent-miss
  family as #1928; **timezone-independent** (fails identically at UTC) and
  cross-cutting (formulas, validation, RLS, flow/action/sharing/hook predicates).

  cel-js gives no operator-layer hook to fix the comparison, so this adds a
  **build-time advisory warning** (the established ADR-0032 guardrail strategy)
  rather than a runtime behavior change. `validateExpression` reuses the shared
  `ExprSchemaHint.fieldTypes` (the same per-field type map the #1928 tier-4
  soundness check already threads through `@objectstack/lint`) to flag a `==`/`!=`
  between a `date` field (`record.`/`previous.`/bare) and
  `today()`/`daysFromNow()`/`daysAgo()`/`now()`, with a self-correcting message
  pointing at the working idioms: `date(record.d) == today()`, a range
  (`>= … && <= …`), or `daysBetween(today(), record.d) == 0`.

  Warning severity — never fails the build (the write/validation path may carry a
  real `Date`). Restricted to `type: 'date'` (unambiguously a string); `datetime`
  is excluded to avoid false positives. Ordering operators (`>=`/`<=`/`<`/`>`)
  already work — cel-js _throws_ for them, tripping the engine's existing
  string-hydration retry — so they are not flagged.

  A runtime fix (normalizing the peer of a temporal operand in the data layer)
  remains tracked in #3183; a naive "hydrate date fields to `Date`" version would
  trade this silent-miss for another (breaking `dateField == "2026-06-20"`), so it
  needs its own design.

- 7125007: **Stored `Field.formula` fields that compute dates/durations no longer silently evaluate to `null` (#3306).** Three independent CEL gaps made shipped template formulas (e.g. `hr_employee.tenure_years`, `hr_time_off_request.days`) return `null` with no parse/build/runtime error:

  1. **The null-guard idiom `cond ? <value> : null` now compiles and evaluates.** cel-js's ternary type-unifier rejects a concrete `int`/`double`/`string` branch against `null` — so even `true ? 5 : null` faulted _"Ternary branches must have the same type"_ and the whole formula nulled. A `Field.formula` is inherently nullable and the catalog blesses both ternary and `== null`, so this is the canonical "compute value, else blank" shape. An AST pre-pass (mirroring the #3183 temporal-equality rewrite) wraps the non-null branch in `dyn(...)` — value-preserving, null-branch-only, idempotent — so it type-checks and runs. Applied in `compile()`, `evaluate()`, and the build soundness check alike.

  2. **`floor(x)` / `ceil(x)` are now registered** (parallel to `round`/`abs`) and advertised in the catalog. They round toward −∞ / +∞, so `floor(-1.2) == -2` — NOT interchangeable with integer division's round-toward-zero. Previously `floor(...)` faulted `found no matching overload` and the formula nulled.

  3. **Date arithmetic is now a build-time ERROR instead of a silent runtime `null`.** `record.end_date - record.start_date + 1`, `today() + 30`, `record.date + n` type-check clean (operands are `dyn`) but always fault at runtime and never recover (a date string is not numeric, so hydration can't rescue it). The build soundness check now types `date`/`datetime` fields as `google.protobuf.Timestamp` and flags date/duration **arithmetic against a number** with a corrective message pointing at `daysBetween(a, b)` / `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)`. Sound by construction — ordering (`date < today()`, `date < "2026-01-01"` string-lex), equality (#3183), and string concatenation (`"Due: " + date`) are all runtime-tolerated and never flagged; only arithmetic against a number is. A `!= null` guard on a date field no longer masks the inner fault (`== null` no-op overloads registered in the check-only env).

  > **Heads-up for downstream:** (3) adds a NEW build-time error. A stored formula or predicate doing arithmetic on a `date`/`datetime` field (`end - start + 1`, `today() + 30`) that previously built (and nulled at runtime) will now fail `objectstack build` / `validateStackExpressions` with a message telling you to use `daysBetween` / `daysFromNow` / `addDays`. This only fires for genuinely-broken expressions that already returned `null`.

  Fixes #3306.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

### Patch Changes

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
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

## 16.0.0-rc.1

### Minor Changes

- 7125007: **Stored `Field.formula` fields that compute dates/durations no longer silently evaluate to `null` (#3306).** Three independent CEL gaps made shipped template formulas (e.g. `hr_employee.tenure_years`, `hr_time_off_request.days`) return `null` with no parse/build/runtime error:

  1. **The null-guard idiom `cond ? <value> : null` now compiles and evaluates.** cel-js's ternary type-unifier rejects a concrete `int`/`double`/`string` branch against `null` — so even `true ? 5 : null` faulted _"Ternary branches must have the same type"_ and the whole formula nulled. A `Field.formula` is inherently nullable and the catalog blesses both ternary and `== null`, so this is the canonical "compute value, else blank" shape. An AST pre-pass (mirroring the #3183 temporal-equality rewrite) wraps the non-null branch in `dyn(...)` — value-preserving, null-branch-only, idempotent — so it type-checks and runs. Applied in `compile()`, `evaluate()`, and the build soundness check alike.

  2. **`floor(x)` / `ceil(x)` are now registered** (parallel to `round`/`abs`) and advertised in the catalog. They round toward −∞ / +∞, so `floor(-1.2) == -2` — NOT interchangeable with integer division's round-toward-zero. Previously `floor(...)` faulted `found no matching overload` and the formula nulled.

  3. **Date arithmetic is now a build-time ERROR instead of a silent runtime `null`.** `record.end_date - record.start_date + 1`, `today() + 30`, `record.date + n` type-check clean (operands are `dyn`) but always fault at runtime and never recover (a date string is not numeric, so hydration can't rescue it). The build soundness check now types `date`/`datetime` fields as `google.protobuf.Timestamp` and flags date/duration **arithmetic against a number** with a corrective message pointing at `daysBetween(a, b)` / `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)`. Sound by construction — ordering (`date < today()`, `date < "2026-01-01"` string-lex), equality (#3183), and string concatenation (`"Due: " + date`) are all runtime-tolerated and never flagged; only arithmetic against a number is. A `!= null` guard on a date field no longer masks the inner fault (`== null` no-op overloads registered in the check-only env).

  > **Heads-up for downstream:** (3) adds a NEW build-time error. A stored formula or predicate doing arithmetic on a `date`/`datetime` field (`end - start + 1`, `today() + 30`) that previously built (and nulled at runtime) will now fail `objectstack build` / `validateStackExpressions` with a message telling you to use `daysBetween` / `daysFromNow` / `addDays`. This only fires for genuinely-broken expressions that already returned `null`.

  Fixes #3306.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 6b51346: feat(formula): `dateField == today()` now matches — AST temporal-comparison rewrite (#3183)

  **Behavior change (the fix):** a `Field.date` compared with `==`/`!=` against a
  temporal function now matches on the calendar day. Previously it **silently
  returned the wrong answer** — `record.due_date == today()` was always `false`
  (and `!= today()` always `true`) even for a same-day record, because a
  `Field.date` reads back as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1) and
  cel-js's equality (`overloads.js` `isEqual`) treats a string and a timestamp as
  unequal without consulting any overload.

  `celEngine.evaluate` now rewrites the parsed AST: for each `==`/`!=` whose one
  operand is `today()`/`daysFromNow()`/`daysAgo()`/`now()`, the **field operand**
  is wrapped in `date(...)` (the stdlib coercion), then the expression is
  serialized and evaluated. So `record.due_date == today()` runs as
  `date(record.due_date) == today()`.

  - **Per-occurrence**, not per-field: `record.d == "2026-06-20" || record.d == today()`
    keeps the string-literal comparison intact while fixing the temporal one.
  - **Type-blind-safe**: `date()` degrades gracefully — an already-`Date`
    (`Field.datetime`) operand passes through; a non-date string or null →
    `Invalid Date` → the comparison stays `false`, exactly as before. No
    field-type information is needed, and no currently-correct result is worsened.
  - **Cheap**: the rewrite only reserializes when such a comparison is present
    (a plain-`includes` gate skips the rest), and is memoized per source string.

  Applies to every interpreter site — read-time `Field.formula`, default values,
  validation rules, hook conditions, and flow conditions — since all route through
  `celEngine.evaluate`. RLS/sharing conditions are unaffected: they compile via
  `cel-to-filter`, which already rejects function calls as a loud authoring error.

  **Supersedes the #3192 advisory lint.** That build-time warning
  (`checkTemporalDateEquality`) flagged `dateField == today()` as a silent-miss;
  with the runtime fixed it would be a false alarm, so it (and the
  `temporalEqualityFields` helper it used) is removed. Authors can now write the
  natural `record.due_date == today()` directly; the `date(...)` /
  `daysBetween(...) == 0` / range idioms all keep working.

- 80273c8: feat(formula): warn when a `date` field is compared to a temporal function with `==`/`!=` (#3183)

  A `Field.date` deserializes as a `YYYY-MM-DD` **string** (ADR-0053 Phase 1), and
  cel-js's equality hard-codes `string == <timestamp>` to `false` — it returns
  `false` for a string left operand without ever consulting a registered overload,
  and refuses cross-type object equality (`@marcbachmann/cel-js` `overloads.js`
  `isEqual`). So the most natural "is it due today" predicate —

  ```cel
  record.due_date == today()      // silently false, even when due_date IS today
  record.due_date != today()      // silently true for a same-day record
  ```

  — compiles clean, throws nothing, and silently never matches. Same silent-miss
  family as #1928; **timezone-independent** (fails identically at UTC) and
  cross-cutting (formulas, validation, RLS, flow/action/sharing/hook predicates).

  cel-js gives no operator-layer hook to fix the comparison, so this adds a
  **build-time advisory warning** (the established ADR-0032 guardrail strategy)
  rather than a runtime behavior change. `validateExpression` reuses the shared
  `ExprSchemaHint.fieldTypes` (the same per-field type map the #1928 tier-4
  soundness check already threads through `@objectstack/lint`) to flag a `==`/`!=`
  between a `date` field (`record.`/`previous.`/bare) and
  `today()`/`daysFromNow()`/`daysAgo()`/`now()`, with a self-correcting message
  pointing at the working idioms: `date(record.d) == today()`, a range
  (`>= … && <= …`), or `daysBetween(today(), record.d) == 0`.

  Warning severity — never fails the build (the write/validation path may carry a
  real `Date`). Restricted to `type: 'date'` (unambiguously a string); `datetime`
  is excluded to avoid false positives. Ordering operators (`>=`/`<=`/`<`/`>`)
  already work — cel-js _throws_ for them, tripping the engine's existing
  string-hydration retry — so they are not flagged.

  A runtime fix (normalizing the peer of a temporal operand in the data layer)
  remains tracked in #3183; a naive "hydrate date fields to `Date`" version would
  trade this silent-miss for another (breaking `dateField == "2026-06-20"`), so it
  needs its own design.

- ea32ec7: feat(formula,lint): advisory type-soundness warnings for formula/predicate expressions (#1928 tier 4)

  Closes the last open guardrail from #1928. A `Field.formula` or record-scoped
  predicate that uses a **text or boolean field with an arithmetic (`+ - * / %`)
  or ordering (`< > <= >=`) operator against a number** faults the runtime
  overload and silently evaluates to `null` (e.g. `record.title * 2`,
  `record.is_active + 1`). The build now surfaces this as a **non-blocking
  warning** with the offending field and a corrective message.

  Honours the ADR-0032 design law — the checker only flags what the runtime
  would also fail:

  - Number / currency / percent / date / datetime fields are declared `dyn`, so
    the cases the runtime rescues never warn — `record.amount / 100` (the #1930
    `registerOperator` fix), `record.due == today()` and numeric-string / ISO-date
    values (the string-hydration retry), and numeric-coded `select` option values.
  - Equality (`==` / `!=`) is excluded: a heterogeneous equality is runtime-safe
    (evaluates to `false`), never a fault.

  New `firstTypeMismatch(source, fieldCelTypes, scope)` export in
  `@objectstack/formula` (and an optional `fieldTypes` hint on
  `validateExpression`); `@objectstack/lint`'s `validateStackExpressions` threads
  each object's field types into every checked site:

  - **record-scoped** sites (`record.<field>`) — formula fields, validation rules,
    action / hook / sharing predicates;
  - **flattened** flow / automation conditions (bare `field`) — where flow
    variables stay `dyn` and are never flagged, and equality stays runtime-safe.

  Warnings are advisory in `objectstack build` / `validate` (fatal only under
  `--strict`), matching the tier-3 channel.

### Patch Changes

- e0859b1: fix(formula): retire the `js` expression dialect and fix the `hasDialect` false-positive (#3278)

  The `js` **expression** dialect was declared in `ExpressionDialect` but never
  shipped — it existed only as a registry stub with no engine and no author helper
  (`cel`/`F`/`P` → CEL, `tmpl` → template, `cron` → cron; nothing ever emitted
  `js`). Per ADR-0049 (enforce-or-remove) it is removed from the enum; the set is
  now `{cel, cron, template}`.

  Procedural JavaScript is unaffected: it remains the **L2** authoring surface —
  the sandboxed, capability-gated `ScriptBody { language: 'js' }` in hook/action
  bodies — which is a separate enum (`hook-body.zod.ts`), not an expression
  dialect.

  Also fixes a latent bug in `hasDialect`: it detected stubs via
  `dialect.startsWith('stub:')`, but stubs were registered under their real name,
  so the check was dead code and `hasDialect('js')` returned a false-positive
  `true`. With the stub removed, `hasDialect` reports only registered real
  engines, and the registry test now asserts the negative case (`hasDialect('js')
=== false`) so the gate can actually go red.

  No runtime behavior changes for any valid persisted artifact — no producer ever
  emitted `dialect: 'js'`. See the ADR-0058 addendum.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
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

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

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

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

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

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

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

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

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

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- ef3ed67: Formula field typing: `inferExpressionType()` + a declared `returnType`.

  - `@objectstack/formula`: new `inferExpressionType()` (and lower-level `inferCelType()`) surfaces the cel-js type-checker's result for a CEL value/formula expression, mapped to `number | text | boolean | date | unknown`. Conservative — two `dyn` operands stay `unknown`; typed literals/stdlib returns pin a concrete type.
  - `@objectstack/spec`: `FieldSchema` gains an optional `returnType` (`number|text|boolean|date`) so a formula field can carry its declared value type (the way Salesforce/Airtable do), letting consumers (dataset measures, formatting, validation) read a declared type instead of re-parsing the expression.

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
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Minor Changes

- cfd86ce: ADR-0058 — expression & predicate surface unification. Adds the canonical
  CEL→FilterCondition pushdown compiler in `@objectstack/formula`
  (`compileCelToFilter`, `isPushdownableCel`, `lowerCelAst`) plus an in-memory
  `matchesFilterCondition` backend (one AST, three backends). `plugin-security`
  (RLS `using`, via a SQL bridge) and `plugin-sharing` (`celToFilter`) cut over to
  it, retiring the bespoke regex/field-equality front-ends. Compound sharing
  conditions now compile and enforce end-to-end (closes #1887). The RLS `check`
  clause is now enforced on the write post-image (insert/by-id update), fail-closed.
  Non-pushdownable predicates (arithmetic, functions, subqueries, cross-object) are
  an authoring compile error, never silently dropped (ADR-0049/0055).

### Patch Changes

- 48a307a: build: validate UI action `visible` / `disabled` predicates at compile time

  Extends the ADR-0032 build-time expression check to cover action `visible` and
  `disabled` predicates (stack-level and object-attached), evaluated record-scoped
  like validation rules. A record-header / row action's `visible` is evaluated by
  `ActionEngine` against `{ record, recordId, objectName, user, … }` with
  fail-closed semantics, so a **bare** field reference (`!done` instead of
  `!record.done`) throws at runtime and the action is **silently hidden on every
  record** — the trap behind the #2183 "Mark Done never hides" debugging hunt.
  `os build` now reports it as an error with the corrective `record.<field>`
  message instead of letting it ship.

  `@objectstack/formula`: `ctx` and `features` are added to the record-scope
  namespace roots (alongside the existing `user`, `data`, `context`, …) so the
  ambient globals real action predicates use (`record.id == ctx.user.id`,
  `features.multiOrgEnabled`) are not false-positives. Verified against the full
  monorepo build (every example + platform bundle still compiles clean).

- 25fc0e4: build: extend ADR-0032 predicate validation to all flat record-scoped sites

  Builds on the action-predicate guard. `os build` now also validates these
  record-scoped predicates for bare field references (`status` instead of
  `record.status`), which otherwise evaluate to nothing at runtime and silently
  mis-behave:

  - **field conditional rules** — `requiredWhen`, `readonlyWhen`,
    `conditionalRequired`, `visibleWhen` (server-enforced; a broken one is
    fail-open — the required/readonly rule just never fires);
  - **sharing-rule `condition`** (security-critical — decides which rows a
    principal sees);
  - **lifecycle hook `condition`** (skips the handler when false);
  - **nested `when`** on `conditional` validation rules (previously only the
    top-level rule predicate was checked).

  `@objectstack/formula`: adds `parent` to the record-scope namespace roots —
  master-detail inline grids inject the header record as `parent` for a child
  field's `readonlyWhen`/`requiredWhen` (ADR-0036, #1581), so `parent.status` is
  legitimate, not a bare ref. Verified against the full monorepo build (76 tasks
  clean).

  Not yet covered (separate follow-up — needs a recursive view/page tree walker
  and per-node scope classification): deeply-nested UI visibility predicates
  (`view` element/section `visibleOn`/`condition`, `page` component `visibility`),
  object field-group `visibleOn`, and app-nav `visible` (user/feature-scoped, not
  record-scoped).

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

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

## 9.10.0

### Minor Changes

- 1f88fd9: Add `addDays(date, n)` and `addMonths(date, n)` to the CEL standard library — shift an arbitrary date by a (possibly negative) number of days or months. Unlike `daysFromNow`, these operate on a _given_ date (the "next service date = last service + cycle" shape). `addMonths` clamps to the target month's last day (`addMonths(date('2026-01-31'), 1)` → Feb 28, never overflowing into March). Both coerce their inputs (Date | ISO string | epoch) and type `n` as `dyn` so a record number field arriving as a `double` doesn't fault `no such overload` (#1928).

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

## 9.9.0

### Minor Changes

- d99a75a: feat(formula): timezone-aware `today()` / `daysFromNow()` / `daysAgo()` (ADR-0053 Phase 2)

  These are now **calendar-day** functions resolved in a reference timezone, threaded from `ExecutionContext.timezone` (#1978) through `EvalContext.timezone` into the CEL stdlib. Each returns the reference-tz calendar day expressed as a **UTC-midnight `Date`** (ADR-0053 decision D1) — the one representation consistent with how `Field.date` strings hydrate, how the SQL driver normalizes date filters, and how Phase 1 stores dates. So `record.close_date == daysFromNow(30)` now matches in-memory too, not just at the storage boundary. The timezone calculation uses `Intl.DateTimeFormat` (DST-safe; no hand-rolled offset math).

  **⚠️ Behavior change:** `daysFromNow(n)` / `daysAgo(n)` previously kept the wall-clock time of `now` (e.g. `daysFromNow(30)` at `10:00Z` → `…T10:00:00Z`). They now drop the time and return the calendar day at **midnight** (`…T00:00:00Z`) — the ADR-0053 "defect #3" fix. `today()` is unchanged at UTC (it already truncated to start-of-day). For a genuine sub-day offset use the documented escape hatch `now() + duration("Nh")`.

  With no reference timezone configured the zone resolves to `UTC`, so `today()` is byte-for-byte unchanged; only the `daysFromNow`/`daysAgo` midnight-truncation differs from before. `objectql` threads `execCtx.timezone` into read-time formula evaluation (`applyFormulaPlan`) and default-value expressions (`applyFieldDefaults`).

  Part of #1980. (Consuming a non-UTC reference timezone end-to-end also needs the `localization` settings manifest noted in #1978.)

- 575448d: feat(formula,email): render `datetime` in a reference timezone (ADR-0053 Phase 2)

  `datetime` template holes now render in a reference timezone's wall-clock when one is supplied, at the presentation boundary — storage stays UTC.

  - **Formula template engine** — the `datetime` formatter takes the reference timezone from `EvalContext.timezone` (threaded in #1980) and passes it to `Intl.DateTimeFormat`. `{{ ts | datetime }}` renders in that zone; `{{ ts | datetime:iso }}` stays UTC (machine-readable). Calendar-day `date` rendering is intentionally **unchanged** (tz-naive — a `Field.date` has no zone). New exported `formatValue(name, value, arg, { locale, timeZone })` makes the whitelisted formatters reusable outside the full CEL template engine.
  - **Email pipeline** — `plugin-email`'s renderer previously bypassed the formatter pipeline (`String()` only), so a datetime went out as raw ISO. Email holes now accept the shared formula formatters — `{{ order.total | currency }}`, `{{ ts | datetime }}` — reusing `formatValue` (single source of truth), while keeping the engine's HTML-escaping and `{{{ }}}` raw-output semantics. `SendTemplateInput.timezone` (mirroring the existing `locale`) flows into rendering so an email's datetime shows the recipient's wall-clock.

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

## 9.8.0

### Minor Changes

- c17d2c8: feat(formula): register the CEL functions the authoring catalog advertises (daysBetween, abs, round, min, max, upper, lower, contains, startsWith, endsWith, matches, len, isEmpty, date, datetime)

  `introspectScope` / `CEL_STDLIB_FUNCTIONS` advertised 25 functions to authors
  (incl. AI), but only 8 were registered — 14 faulted at runtime (`daysBetween`,
  `abs`, `round`, `min`, `max`, `upper`, `lower`, `len`, `isEmpty`, `contains`,
  `startsWith`, `endsWith`, `matches`, plus `date`/`datetime`). Authors were told
  to call functions that don't exist (e.g. `daysBetween` for "days remaining").

  Register the genuinely-useful set in `registerStdLib` with dyn-lenient signatures
  (so a `Field.date` arriving as a string still works) and internal coercion, and
  reconcile the catalog so every advertised entry resolves — guarded by a test that
  evaluates every `CEL_STDLIB_FUNCTIONS` entry. Pure additions; no behavior change
  to existing expressions.

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Minor Changes

- ff0a87a: feat(validate): flag bare field references in record-scoped CEL sites at build time

  > **Heads-up for downstream:** this adds a NEW build-time error. A `Field.formula`
  > or validation predicate that references a field bare (`amount` instead of
  > `record.amount`) now fails `objectstack compile`. These expressions were already
  > silently broken at runtime (they evaluated to `null` / never fired), so this is a
  > fix that surfaces a latent bug — but a stack carrying one will go from
  > "builds, silently wrong" to "fails the build" on upgrade. The error message
  > states the exact correction (`write record.<field>`).

  A `Field.formula` and an object validation predicate evaluate against the
  `record` namespace only — there is no field flattening — so a bare top-level
  identifier (`amount`, `status`) resolves to nothing and the expression silently
  evaluates to `null` / never fires. This is the silent-at-runtime class behind
  the broken example-crm formulas (#1927) and is exactly what AI authors get wrong.

  `validateExpression` now takes an evaluation `scope` and, for `scope: 'record'`,
  reports a bare reference with the corrective form (`write record.<field>`). The
  check is schema-free and acts only on cel-js's `Unknown variable` fault, so it
  cannot false-positive on arithmetic/comparison/null-guard type overloads. Flow
  and automation conditions keep the default `scope: 'flattened'` — the record's
  fields ARE spread to top-level there (alongside flow variables), so bare refs
  are correct and are NOT flagged. `objectstack compile` wires `record` scope for
  field formulas and validation predicates; flow conditions stay flattened.

### Patch Changes

- 82c7438: fix(formula): register mixed `double <op> int` arithmetic overloads so number-field formulas compute

  cel-js types a record field number as `double` and a bare integer literal as
  `int`, and ships overloads only for matching numeric pairs. So an everyday
  formula like `record.amount / 100` or `record.price * 2` faulted at runtime
  (`no such overload: dyn<double> / int`); the engine caught the fault and the
  formula silently evaluated to `null` — passing build, empty at runtime (#1928).

  The CEL engine now registers the missing `double <op> int` / `int <op> double`
  overloads for `+ - * / %`, computing the result as a `double` (CEL's mixed-numeric
  promotion). Pure `int op int` is untouched, so integer division (`7 / 2 == 3`)
  keeps its semantics — the overloads fire only when the operands are genuinely a
  `double` and an `int`. Authors no longer need the `/ 100.0` float-literal workaround.

- 417b6ac: feat(validate): advisory did-you-mean warnings for likely field typos in flow conditions

  Adds a non-blocking warning channel to build-time expression validation (#1928
  tier 3). Flow / automation conditions flatten the record's fields to top-level,
  so a bare `status` is correct — but a bare NON-field identifier is either a flow
  variable or a typo. When it is a near-miss of a known field (edit distance), the
  build now emits a `did you mean \`status\`?`warning instead of staying silent,
WITHOUT failing the build (a genuine flow variable won't be close to a field
name, so it stays quiet).`ExprValidationResult`gains a`warnings`array and`ExprIssue`a`severity`; `objectstack compile` prints warnings and only fails on
  errors. This closes the silent-skip gap for misspelled trigger-condition fields
  (the #1877 family) without the false-positive risk of a hard gate.

  - @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- bb00a50: fix(formula): catch unknown functions in CEL conditions at build (#1877)

  `compile()` discarded cel-js's type-check verdict because `check()` returns a `TypeCheckResult` object (`{ valid, error }`), not an array — so the `Array.isArray(checkErrors)` guard never matched. A condition calling an unknown function (`PRIOR(status)`, a typo'd `isBlnk(...)`) type-checks as `found no matching overload`, but that result never surfaced, so `objectstack compile`, `registerFlow`, and the `validate_expression` tool all accepted the predicate, which then silently no-op'd the flow at runtime. Now reads the documented `{ valid, error }` shape, closing the gap for flow conditions, validation rules, and field formulas at once.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

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

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- f01f9fa: fix(formula): hydrate ISO date/datetime strings on CEL `no such overload` fault (#1530)

  Date-typed formula fields and date predicates always evaluated to `null`:
  `Field.date`/`Field.datetime` serialize to ISO strings, and cel-js compared the
  raw string against the `google.protobuf.Timestamp` from `today()`/`now()`/
  `daysFromNow()`, raising `no such overload` (swallowed to null). The existing
  numeric-string fault-retry (#1534) is now extended to also coerce strict ISO-8601
  date/date-time strings to `Date` before retrying once, fixing every caller
  (formula fields, flow conditions, validation/workflow predicates). Hydration runs
  only after a fault, so clean expressions are never re-interpreted and genuine
  non-temporal strings still fault loudly.

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- 825ab06: fix(formula): hydrate string-serialized numeric fields in CEL comparisons (#1534)

  Numeric fields that serialize as strings — `Field.rating(allowHalf)` → `"5.0"`, `Field.currency(scale)` → `"250000.00"`, `Field.percent` — made comparisons like `record.rating >= 4` fault under strict CEL with `no such overload: dyn >= int`. In flow decision/edge conditions this silently dead-ended the run (no edge matched), and in objectql `applyFormulaPlan` it swallowed to `null`.

  The CEL engine now retries an evaluation **once** with purely-numeric strings hydrated to numbers, but only after a `no such overload` fault — so a comparison that already type-checks is never re-interpreted (a zip like `"02134"` stays a string in `record.zip == "02134"`). Because both the automation condition path (`service-automation` `evaluateCondition`) and the objectql formula path route through `ExpressionEngine.evaluate`, both are fixed consistently. A genuinely non-numeric operand (e.g. `record.rating >= 4` where `rating` is `"high"`) still faults loudly rather than being silently rescued.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

### Minor Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
