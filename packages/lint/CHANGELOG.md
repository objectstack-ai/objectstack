# @objectstack/lint

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/sdui-parser@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- 28ad90e: feat(types,cloud-connection,lint,cli): ADR-0120 17.x 收尾 —— `isolated` 安装期姿态硬门(D5e)、D5c 重拼写 advisory、成文契约扫荡与三姿态 conformance (#5081)

  ADR-0120 17.x 波的第三块,也是最后一块。前两块已在 main 上:#5212(driver 侧
  D3+D4 —— `COALESCE(organization_id, '__global__')` 物化、drift 两侧同步、重复预检)
  与 #5208(spec 词汇 `'organization'` + D5a/D5b lint)。本次补齐三件事:安装期的
  姿态决策点、剩余的成文契约、以及把「一个 app 包跑遍三种姿态」从假设变成测试。

  **D5e —— 装进 `isolated` 环境时的硬门。** 词汇本身是姿态无关的:作者说的是业务
  边界(`'organization'` 一个组织一份 / `'global'` 整个安装一份),没有任何索引形状
  读姿态。唯一的残留在一个方向上:`isolated` 下组织就是**不同客户**,此时 app 业务
  对象上的 `'global'` 唯一既跨客户过度约束,又变成跨客户的存在性预言机(S10/S14)。
  维护者裁定这是**硬门而非 advisory**:把带 `'global'` 唯一(非 `sys` 对象)的 app
  装进 `isolated` 环境会**停下来并逐索引列出**,安装者(通常是 AI agent)要么确认它
  确实是平台级的,要么改写为 `'organization'`;确认按 ADR-0104 attestation 风格
  留痕在安装清单里(`InstalledManifestEntry.globalUniqueAttestation` —— 确认了什么、
  谁确认的、何时、在哪个姿态下问的),**之后不复问**。

  - 停下的安装**什么都不留**:先于 hot-register 和任何 ledger 写入,所以作者改完
    元数据可以直接重试,不需要先卸载。
  - 逐索引确认是有牙齿的:`confirmGlobalUniques` 收 `true` 或明确的 id 数组,只确认
    其中一条仍会在剩下的那条上停住。
  - 升级引入的**新**约束会被问,老的答案继续算数。
  - 另一个姿态下给出的确认**不算同意** —— `isolated` 那个问题在 `single` 下从未被
    问过,所以按「未确认」处理(唯一不会静默放行跨客户约束的方向)。
  - ⛔ **永不做成启动期告警**(#4884 纪律)。boot 时的 rehydrate 不评估此门;门够不到
    的两类存量 —— 门禁上线前的安装、装后姿态变更的环境 —— 由 `os doctor` 与
    `os migrate plan` 的 advisory 形态覆盖。

  判定里有三条是承重的,别「简化」掉:声明索引上的裸 `unique: true` **算**(D1 说它
  就是 `'global'` 的位置式拼写,排除它等于让整个 17.x 可以靠拼写绕过);字段级
  `true` **不算**(它是 `'organization'`,永久合法);`sys_`/`base_` 对象**不算**
  (S5 那批引擎幂等键天然就是平台级的,每次安装都问一遍就是 #4884 的误报类)。

  CLI: `os package install` 新增 `--confirm-global-uniques`,并把 409 渲染成可读的
  逐条清单而不是一句 "Install failed (409)"。

  **D5c —— 遗留手写组织复合索引的 advisory。** 新规则
  `unique/legacy-organization-composite`:声明的唯一索引自己列出了组织列
  (`{ fields: ['name','organization_id'], unique: true }`)—— 这是词汇出现之前手写
  per-organization 的写法。它读起来像「每组织唯一」,物化出来却是普通复合索引,而
  SQL UNIQUE 是 NULL-distinct 的:组织列为 NULL 的行上它**什么都不约束**(#5030),
  在单组织部署上那就是每一行。改写成 `unique: 'organization'`(`fields` 原样保留,
  driver 会把已列出的组织列**就地**变成 NULL-safe 形式)正是补上这个洞的动作。
  **永远只是 advisory,永远不自动修**:老拼写永久合法、零强制 drift,而 opt-in 是
  真实的物理收紧,要走 D4 的 `recreate_index` + 重复预检。

  **D6 —— 成文契约扫荡。** `content/docs/data-modeling/indexing.mdx` 的
  §Two ways to say "unique" 全节按新词汇重写(含 `os:check` 代码块);
  `content/docs/protocol/objectql/schema.mdx` 的 §Uniqueness and tenancy 重写为
  §Uniqueness and scope —— 其中那句「单租户部署不受影响,租户列是常量,复合索引
  退化为单列索引」是 #5030 **证伪过的原话**,现已替换为 D3 的 NULL-safe 事实;
  `content/docs/deployment/cli.mdx` 的 `replace_unique_index` / `recreate_index`
  条目补上 NULL-safe 形状与重复预检;`content/docs/references/**` 经
  `gen:schema && gen:docs` 再生成,未手改。

  按 ADR-0120 Resolved #2 的非规范性引导(官方示例/脚手架/生成器在新代码中输出
  显式拼写),`skills/objectstack-data/**` 的索引与校验规则整体扫过:声明索引一律
  说清 scope,并新增一节完整讲 `'organization'` 的 NULL-safe 语义与「永远不写姿态」。
  顺带修掉那里长期使用的 `tenant_id` —— 平台的列叫 `organization_id`。
  `examples/**`、`create-objectstack` 模板与 `os generate` 经核查**根本没有声明任何
  唯一约束**,故无可扫;这是核查结论,不是遗漏。

  **三姿态 conformance(ADR §Acceptance tests)。** 同一个 fixture app 在
  `single | group | isolated` 三姿态下启动,逐 S 行用**真实的违规插入**断言 enforcement
  (S1/S2/S3/S4/S5/S6/S7/S8/S9/S11/S12),并逐姿态捕获物化出的索引键,断言三者
  **逐字节相同** —— 「没有任何索引形状读姿态」这句话一旦有两者不同就是假的。相同性
  断言配了一条正向断言(对着期望的键形状),这样「三次都什么都没建」不会读成「一致」。
  外加 ADR 只要的那一条 transition smoke:在 `single` 下建库、`isolated` 下重新打开,
  drift op 为零。

  对既有部署的影响:除新增的安装期确认外,本次不改变任何已有物化行为。字段级
  `unique: true` 一如既往合法。

- ddc2527: fix(approvals): the ADR-0044 revise window is a service-owned node type, not a bare `wait` (#3823)

  #3801 gated `POST /api/v1/automation/:name/runs/:runId/resume` on the **node type**
  that produced the suspension: an `approval` pause declares
  `resumeAuthority: 'service'`, so it continues only through `ApprovalService`.
  ADR-0044's **revise window** was the same trust boundary in a shape that key
  could not see. Send-back parked the run on an ordinary `wait` node the flow
  author placed — correctly `resumeAuthority: 'any'`, because a signal wait is
  _meant_ to be resumable by an external producer — and `ApprovalService.resubmit`
  was the only thing that checked anything about continuing it.

  Demonstrated (not reasoned) against the real engine: a raw `resume(runId)` with
  an **empty body**, from any caller, walked the `resubmit` back-edge into the
  approval node and opened round N+1 with **no submitter check and no `resubmit`
  audit row** (`['submit','revise']` — no third row, ever). Worse, when another
  request was already pending on the record — the exact case `resubmit` refuses
  with `DUPLICATE_REQUEST` _specifically to keep the run alive_ — the raw resume
  went around that guard: the approval node's re-entry failed **after** the engine
  consumed the suspension, and the run was **permanently destroyed** with its
  round-N request stuck `returned` and no resubmit able to reach it.

  The revise pause is therefore its own node type:

  - **`approval_revise`** (`APPROVAL_REVISE_NODE_TYPE`), registered by
    `@objectstack/plugin-approvals` alongside the `approval` node, declaring
    `resumeAuthority: 'service'`. It stays a first-class box on the canvas, in the
    run log and in the suspended-run store — only the _reuse_ of `wait` was wrong.
    It takes **no config**: the window ends on the submitter's explicit resubmit,
    never on a signal or timer. The `resumeAuthority` gate itself is unchanged.
  - `sendBack` refuses a `revise` edge whose target is not an `approval_revise`
    node, **before any mutation** (like the existing missing-`revise`-edge check),
    so no run can be parked in a window something else can advance.
  - New gating lint `flow-approval-revise-target-not-service-owned`
    (severity `error`, on `os build` / `os validate` / `os lint` and the runtime
    metadata publish gate) rejects the old shape at authoring time.

  **Upgrading a flow authored against the original ADR-0044 D3.** One token:

  - **FROM:** `{ id: 'wait_revision', type: 'wait', waitEventConfig: { eventType: 'signal', … } }`
  - **TO:** `{ id: 'wait_revision', type: 'approval_revise' }` — drop
    `waitEventConfig` / any `config`; the window has no event to wait on.

  Until you do, such a flow keeps registering and running and its approvals stay
  decidable (`approve` / `reject` / `recall` / `reassign` are untouched), but
  **send-back is refused** with a message naming the node and this fix, and
  re-publishing it reports the lint error. A run _already parked_ in a legacy
  revise window keeps its recorded node type (a republish never re-types a live
  pause) and is drained by `resubmit` or `recall` as usual.

  ADR-0044's 2026-07-28 amendment records the reversal of its D3 and of its
  `Alternatives` rejection of a service-owned revise pause, with the evidence
  above; the implementation section there records what shipped, why the approval
  node does not re-suspend itself instead, and why no ADR-0087 conversion was
  added for the old shape.

- 0161c7f: feat(spec,lint): declare the chart segment drill — `ChartDrillDownSchema`, on the react tier where it is actually read (#5022)

  `drillDown` has driven a real capability since long before this release: click a
  bar or a slice on an `<ObjectChart>` and objectui opens the underlying records,
  filtered by the clicked category, in a drawer. The protocol declared it
  **nowhere**. objectui read it as `(schema as any).drillDown`, so every key inside
  it — right, wrong, or misspelled — reached the renderer unchecked, and a typo was
  simply ignored at click time. This is Prime Directive #10 inverted: not declared
  without being delivered, but delivered without ever being declared.

  It is declared now, as `ChartDrillDownSchema`, and it is **additive** — nothing
  that parsed before stops parsing.

  ## What you can write

  `drillDown` is a prop on the react-tier `<ObjectChart>` block:

  ```jsx
  <ObjectChart
    objectName="opportunity"
    aggregate={{ function: "sum", field: "amount", groupBy: "stage" }}
    drillDown={{ columns: ["name", "amount"], maxRows: 50 }}
  />
  ```

  | key       | type                      | meaning                                                                                                                                            |
  | --------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `enabled` | `boolean`                 | Only needed to force the drill OFF — the block being present already means on, so `drillDown={{}}` enables it                                      |
  | `filter`  | `Record<string, unknown>` | Filter for the drilled list; values support `${event.*}`. Omit it and the filter is derived from `aggregate.groupBy` equal to the clicked category |
  | `title`   | `string`                  | Drawer/dialog heading; supports `${event.*}`                                                                                                       |
  | `target`  | `'drawer' \| 'dialog'`    | In-place side sheet (default), or a centered modal when the chart is already inside a drawer                                                       |
  | `columns` | `string[]`                | Column whitelist for the drilled list                                                                                                              |
  | `maxRows` | `number`                  | Rows per page in the drilled list                                                                                                                  |

  Every one of those six is a key objectui's `ObjectChart` was measured to read.
  The renderer's own drill type is wider — it is shared with the table / pivot /
  metric widgets — and the extra keys are **deliberately not declared**, because a
  chart reads none of them:

  - **`mode`** (`'filter'`/`'record'`) is a table/pivot/metric key. A chart segment
    is always an aggregate, so there is nothing to discriminate.
  - **`report`** (drill into a report instead of a record list) is a metric/pivot
    capability.
  - **`view`** and **`sort`** are read by _no_ renderer at all (objectui#3354).
  - **`target: 'navigate'`** is implemented for the other widgets but not for a
    chart, which falls back to the drawer.

  Writing any of them is now a loud rejection that says which surface owns it,
  rather than a value that silently does nothing.

  ## Where it is NOT declared, and why that is deliberate

  **Not on `ChartConfigSchema`, and not a dashboard widget key.** A dashboard
  widget has no per-widget drill configuration, by design: an ADR-0021
  dataset-bound widget drills through the semantic layer, deriving the target
  object and filter from the dataset row that was clicked. That is what
  `content/docs/ui/dashboards.mdx` has said all along, and it is what the renderer
  does — `DashboardRenderer` never reads `chartConfig`, and `DatasetWidget`
  forwards exactly one key out of it (`showLegend`). Declaring the drill there
  would have produced authorable metadata that parses clean and never reaches a
  renderer — the failure this campaign removes elsewhere.

  So the three places an author might reach for it now answer instead of shrugging:

  - `widget.chartConfig.drillDown` → rejected, pointing at the react-tier prop.
  - `widget.drillDown` / `widget.drilldown` → rejected, explaining that dashboard
    drill-through is **automatic**, and naming both configurable drills.
  - `report.drillDown` → rejected, pointing back at the chart prop.

  ## `drillDown` is not `drilldown`

  Two capabilities, one letter apart, and they are now disambiguated in both
  directions at the schema gate:

  |          | `drillDown`                | `drilldown`                                     |
  | -------- | -------------------------- | ----------------------------------------------- |
  | spelling | camelCase                  | all lowercase                                   |
  | type     | configuration object       | boolean                                         |
  | surface  | react `<ObjectChart>` prop | `ReportSchema` key (ADR-0021 D2, on by default) |

  Edit distance alone gets this wrong — the two spellings are a distance of 1, so a
  plain "did you mean" would happily send an author writing `drillDown` on a report
  to `drilldown`, where their config object then fails a second time as a boolean.
  Both gates name the **type** difference, not just the spelling.

  ## Enforced, not just declared

  `@objectstack/lint`'s react-page publish gate now **parses** the schema
  (`react-chart-drilldown-invalid`) against a static `drillDown={{…}}` literal,
  rather than re-deriving the rules. Unknown keys, the wrong `target`, and the
  near-key spelling all fail the build with the schema's own prescription. A value
  assembled from React state is skipped, unchanged: an unresolvable binding is not
  a wrong one (ADR-0072 D1).

- eaaf03c: refactor(spec,lint)!: retire the dashboard widget action trio + `aria` — and the build gate that enforced a button nobody renders (#5010, ADR-0049)

  `DashboardWidgetSchema` let an author declare a per-widget action **button**
  (`actionUrl` / `actionType` / `actionIcon`) and per-widget ARIA attributes
  (`aria`). None of the four reached a renderer. Re-measured 2026-08-04 across both
  repos on a closed call graph:

  - **the action trio** — all 14 `actionUrl` reads in objectui's
    `DashboardRenderer.tsx` are scoped to `schema.header.actions[]`, which is
    `DashboardHeaderAction`, a _different_ schema. Nothing anywhere reads
    `widget.actionUrl`. `actionIcon` is the starkest: zero references in either
    repo outside its own declaration — not even the lint looked at it.
  - **`aria`** — no consumer of `widget.aria` anywhere. The `aria-*` attributes in
    `DashboardRenderer` / `DatasetWidget` are the renderer's own DOM attributes,
    and objectui's single `.aria` read (`plugin-view/ObjectView.tsx:989`) is a
    **view**'s. This is the dashboard-level `aria` that #3896 removed, one level
    down — an accessibility guarantee an author could declare and nothing honoured.

  These four survived the #3896 sweep for the same reason `widgets[].responsive`
  did, and it is not "we looked and they were live": the liveness ledger declared
  no `children` on `dashboard.widgets`, so **no widget-level key had ever been
  classified**. #4956 fixed that instrument and gave all 22 keys their first per-key
  verdicts; this change acts on four of the six it found dead.

  ## The second-order cost this settles

  `packages/lint`'s `validate-dashboard-action-refs` enforced **ERROR-severity**
  reference integrity on `widgets[].actionUrl` — a dangling target failed the
  build. Its docblock called the key _"the per-widget button"_ and claimed to
  mirror the objectui runtime dispatch. It did not, because that button does not
  exist. So an author could be blocked from shipping because a control that cannot
  render pointed at an action that also did not.

  A rule written to delete false affordances was sustaining one. That is why the
  keys were retired rather than the check merely relaxed: the widget branch is
  deleted, with a pin test asserting it stays silent and a second pin proving
  header actions are still checked in the same stack.

  FROM → TO:

  | Removed                          | Replacement                                                                                            |
  | :------------------------------- | :----------------------------------------------------------------------------------------------------- |
  | `dashboard.widgets[].actionUrl`  | `dashboard.header.actions[].actionUrl`                                                                 |
  | `dashboard.widgets[].actionType` | `dashboard.header.actions[].actionType`                                                                |
  | `dashboard.widgets[].actionIcon` | `dashboard.header.actions[].icon` (the header spelling)                                                |
  | `dashboard.widgets[].aria`       | **none** — delete it; author `title`/`description`, which the renderer really does label the card with |

  For a per-**row** affordance, reach for a dataset-bound `table`/`pivot` widget:
  its rows are clickable and drill through the semantic layer already (no
  per-widget drill config exists, by design — #5022).

  **The `AriaProps` shape is NOT removed — only this embed.** `AriaPropsSchema` /
  `AriaProps` stay exported and stay live on `app.aria` and
  `page.components[].aria`. Nothing importing the shape breaks.

  The retirement kit:

  - **Tombstones.** `retiredKey()` on all four, matching `responsive` in this same
    schema. `DashboardWidgetSchema` _is_ `.strict()`, so a plain delete would still
    be loud — but only as a generic "unrecognized key". The tombstone keeps the key
    declared so the rejection carries the **prescription**, and types it `never` so
    authoring it fails `tsc` first. Pins assert the message _is_ the prescription
    and is _not_ `Unrecognized key`. The action trio shares one prescription that
    names all three, so an author who deletes the one key they were told about does
    not hit the same error twice more.
  - **ADR-0087 D2 conversion + D3 chain step**
    (`dashboard-widget-action-aria-removed`, `retiredFromLoadPath`):
    `os migrate meta --from 16` strips the four from author sources, and stored
    dashboards replay clean instead of meeting a tombstone at load. Lossless
    deletes — none of the keys had an effect to lose. Its own entry rather than
    more keys on `dashboard-inert-keys-removed`, whose identity is the #3896 sweep.
  - **Liveness rows stay** (`status: dead`, `verifiedAt`, a REMOVED note) because
    a tombstone keeps the key in the walked shape — the `rls.priority` precedent.
    `authorWarn`/`authorHint` are dropped from all four: the parse owns them now.
  - Baselines moved at KEY level only, as the shape's survival implies:
    `authorable-surface.json` gains four `… [RETIRED]` lines;
    `json-schema.manifest.json`, `api-surface.json` and
    `api-surface-signatures.json` are unchanged by construction — no def stopped
    being emitted and no export was removed.

  No runtime behaviour changes — that impossibility is the reason for the removal.
  The one behaviour that _does_ change is a build that used to fail and now does
  not.

  ## Not in this change

  `widgets[].colorVariant`, the fifth dead key #5010 lists, is **deliberately
  untouched**. The rewrite target its triage assumed — `options.colorVariant` —
  measured dead as well: `options` only reaches a renderer through the inline
  `componentSchema` path, and `dataset` is _required_ on this schema, so every
  spec-authorable widget is dataset-bound and renders through `DatasetWidget`,
  which has no colour affordance at all. Moving the key would relocate 16 authored
  sites (7 in `platform-objects`, 9 in `app-showcase`) from one dead slot to
  another and mint a second inert key. Returned for adjudication.

- 06ffad3: fix(lint): 字段公式校验首次对 spec 合法元数据生效 —— `f.formula` 收敛为 `f.expression` (#5026)

  `validate-expressions.ts` 的字段公式校验(`validateStackExpressions` 里的
  field-formula pass)一直读 `f.formula`。`FieldSchema` 声明的是 `expression`,而
  `formula` 恰是 `field.zod.ts:333` **按名拒绝**的别名之一
  (`aliases: { formula: 'expression', calculation: 'expression', compute: 'expression' }`)。
  该规则以 `input: 'parsed'` 注册,compile/build/validate 路径上看到的是
  `ObjectStackSchema` 的解析产物,所以 `f.formula` 恒为 `undefined` ——
  **整段检查对任何 spec 合法 stack 从未执行过一次**。

  这不是删死代码,是**启用一条从未跑过的检查**。字段公式从此真正受
  ADR-0032 §1a/1b 的三条判决管辖:CEL 语法、`record.<field>` 字段存在性、
  以及 #1928 的裸引用 / 类型健全性。对 AI 生成的元数据这一条最要紧 ——
  `amount * probability`(而不是 `record.amount * record.probability`)正是公式槽位
  最常见的错法,它在 CEL 里静默求值为 null,过去没有任何门拦得住。

  **覆盖面扩大,但对现有元数据零新红。** 激活后在仓库全部真实元数据上实测过:
  `examples/app-showcase`(3 个 `expression` 槽)、`examples/app-crm`(5 个)、
  `examples/app-todo`(0 个)全部 `ObjectStackSchema` 解析通过,新增判决 0 条;
  `platform-objects`、`plugin-security` 的 default-permission-sets 不含公式字段;
  `skills/` 里的公式样例全部已是 canonical 拼法。

  **Authoring impact.** 之前拼 `formula:` 的字段本来就无法解析,schema 会按名拒绝
  并给出 `Did you mean \`formula\` → \`expression\`?`——该行为不变,本规则不再对同一个键
  给出第二套说法。诊断定位串同步改名以免继续传播错拼法:

  ```
  FROM  object 'X' · field 'Y' formula
  TO    object 'X' · field 'Y' expression
  ```

  `validate-null-guards.ts` 的 surface ledger 相应把该行从 `Field.formula` 正名为
  field `expression`(`Field.formula({ expression: … })` 写入的槽)。null-guard 判决
  **仍然**排除该 surface(公式是 `value` 角色、天然可空,`guard ? value : null` 是祝福
  写法),排除的只是 null-guard 这一条,语法 / 字段存在性 / 裸引用判决从此生效。

  `validate-expressions.test.ts` 的 `TRACKED_UNDECLARED_READS` 记账随之清空 —— 这
  份"只缩不长"的清单现在是零条,规则读的每一个键都是 spec 声明的键。

- 123067c: fix(cli): the i18n walker collects `objects.<o>._sections` — section headings are gated and scaffolded like every other label (#5405)

  An object's SECTION headings were the one declared, resolved, rendered
  translation surface the shared i18n walker had no kind for.
  `ExpectedEntry['source']` listed `object | field | option | view | action |
globalAction | app | navigation | dashboard | widget | page` plus two
  `metadataForm*` kinds — and those two cover **Studio metadata forms**
  (`metadataForms.<type>.sections.*`, hidden behind `--include-platform`), not app
  objects. So `objects.<o>._sections.<s>.label` was structurally unreachable in
  both directions: `os i18n extract` never scaffolded a heading, and
  `os lint` could not report one missing.

  The surface itself was never in doubt. `ObjectTranslationDataSchema` declares
  `_sections` (with `sections` as an authoring alias), and `@object-ui/i18n`'s
  `sectionLabel` resolves it for `record:details`, for `ObjectForm`/`ModalForm`
  and for the field-group designer. Only the walker disagreed — which is exactly
  the drift `collectExpectedEntries` was consolidated to prevent (#3370).

  Measured downstream before this landed: 85 sections across 15 objects, **2 of
  85** translated in `ja-JP` and in `es-ES` — English headings on essentially
  every record page and form — with `objectstack lint` reporting **zero** i18n
  warnings for both locales.

  **What is collected.** A `section` kind, from the two independent surfaces that
  both resolve to the same key — a heading is expected if _either_ declares it,
  and one heading is one expected key however many declare it:

  - **`fieldGroups` × field `group`** — the fields decide which sections exist and
    `fieldGroups[].label` supplies the source text. Membership is read through
    `deriveFieldGroupLayout` (ADR-0085 §5), the same shared derivation the
    renderers consume, so a group nothing visible references — or a `group:` no
    `fieldGroups` entry declares — produces no heading and therefore no expected
    key. The trailing ungrouped bucket renders without chrome and is skipped.
  - **A named `sections[]`** on a form view (including a view container's default
    `form`) or inside a record page's component tree.

  A section with no `name` is skipped: every renderer guards the lookup on it
  (`s?.name ? sectionLabel(…) : s?.label`), so it is untranslatable by
  construction and demanding a bundle entry for it would be noise. A group that
  declares no `label` still yields a scaffold key seeded from its own name, but no
  coverage finding — nobody authored that text.

  **What you get.** `os lint` gains an `i18n/missing-section` category — user
  metadata, so it is reported without `--include-platform` — and `os i18n
extract` scaffolds the headings for free, because the gate and the extractor
  read the one walker. A project that declares no locales still reports nothing;
  the gate stays opt-in.

  **`@objectstack/lint`** now exports its shared page traversal
  (`walkPageComponents`, `isSourceAuthoredPage`, `WalkedComponent`) so the CLI
  consumes it instead of growing a private copy — that walk exists precisely
  because duplicating it produced a dead rule once already (#3583). Reusing it is
  also what makes the page half correct rather than merely present: it reaches
  `slots.<slot>` and the untyped nesting a record page really uses
  (`page:tabs` → `properties.items[].children[]` → `record:details`), skips
  source-authored pages whose `regions` are a derived cache, and resolves each
  component's OWN binding (`dataSource.object` → `properties.object` → the page's
  `object`) — so a re-bound `record:details` keys its headings under the object it
  actually shows.

- 5582e18: never-fire 族三条 lint 规则 warning → error:声明了触发器却确定不会运行的 flow 现在被拒收

  `validateFlowTriggerReadiness` 里的规则此前一律是 warning。族内复审(#5762)后按**一个**标准重新定级 ——
  「仅凭这份 stack 是否已经足够断定这个 flow 不会运行」—— 三条规则答「是」,升为 `error`:

  - **`flow-time-relative-descriptor-invalid`**(#5496)—— `config.timeRelative` 描述符
    `TimeRelativeTriggerSchema` 判不过。判它的正是 trigger 在 bind 时 `safeParse` 的同一个 schema,
    所以 schema 拒的描述符在运行时同样被拒:sweep 永不安装,flow 声明了 time-relative 触发器却永不运行。
  - **`flow-time-relative-descriptor-unroutable`**(#5647)—— `config.timeRelative` 不是对象
    (`timeRelative: 'daily'` 是典型)。判据就是引擎自己的路由谓词 `typeof … === 'object'`,
    所以这个值不会被任何部署路由到 time-relative trigger —— 全族里最硬的判定,也是唯一连
    bind 时那一行 warn 都没有的一条。
  - **`flow-trigger-unknown-event`**(#3427/#3457/#3481)—— `record-*` token 落在文法之外
    (`record-after-updated` 拼错、`record-change` 缺相位、数组形式)。引擎用硬编码前缀把任何
    `record-` 开头的 token 路由给 record-change trigger(不查注册表,所以装任何包都无法声明新
    `record-*` token),该 trigger 再用 `triggerTypeToHookEvents` 的封闭文法映射 —— 文法外就是零
    hook event,即绑不上任何东西。

  **两条对照规则维持 warning,这正是本次定级不是「整个文件都升 error」的原因:**

  - `flow-trigger-unknown-object` —— 本 stack 没定义的对象名**可能由另一个已安装包提供**,
    规则看不见那个包的对象。免责是真的,所以继续 advisory(它自己的 hint 就这么写)。
  - `flow-draft-status-ambiguous` —— draft flow **确实会**触发,这是意图歧义而非死 flow。

  ## 影响面:P1 运行时发布门(`surfaces: CLI_AND_RUNTIME`)

  注册表 tier 同步 `advisory` → `gating`。除 `os validate` / `os build` / `os lint` 之外,本规则也跑在
  元数据写入路径的 publish 门上,`error` 会让 `state: 'active'` 的写入被拒(422)。**边界值得写清,因为
  直觉猜错的方向恰好对租户有利**:该门交给规则的快照里 `flows` 只装**正在写入的那一个** item
  (`runtime-gate.ts`:`candidate = { objects, [stackKey]: [item] }`),并且会减掉 baseline 已产出的
  finding。所以:

  - 发布 flow A **不会**因为已存储的 flow B 是死 flow 而被拒;租户既有的死 flow 继续被读取和服务
    (ADR-0087 读路径不对称);
  - 被拒的是**死 flow 自己的发布**(含再次发布),以及 CLI 侧 —— stack 里含死 flow 的包
    `os validate` / `os build` / `os lint` 转红;
  - draft 保存从不过门(#4463 D1),只有发布才过。

  ## 迁移

  修死 flow,不要降级规则:

  - 描述符判不过 → 按 finding 里 `TimeRelativeTriggerSchema` 的原文改(它会点名该写的键);
    描述符要 `{ object, dateField, 且 withinDays | offsetDays 恰好其一 }`。
  - `timeRelative` 写成了 `'daily'` 这类节奏值 → 节奏是**同级兄弟键** `config.schedule`
    (默认每日 08:00 UTC,通常可省),`timeRelative` 只描述扫哪些记录。
  - `record-*` token 落在文法外 → 用 `record-{before,after}-{create,insert,update,delete,write}`;
    「创建或更新」用 `record-after-write` 一条 flow 覆盖(#3427);多事件数组仍未支持(#3457),
    按事件各写一条 flow。

  仓内三个示例 app(showcase / CRM / todo)`os validate` 升级前后输出逐字一致、均通过,
  本次升级不需要修改任何示例。

- 2f1e2a5: feat(lint): null-guard 闸门覆盖 `requiredWhen`,其余各面按"绑定是否全量"逐一定案 (#4811)

  #4763 的 null-guard 闸门只接了两面(对象校验规则、生命周期 hook `condition`),
  其余各面留作"待定"。本次把"待定"收敛成一条**可判定的判据**,并按它逐面定案 ——
  一个只覆盖部分面、又没有任何东西说出这件事的闸门,正是这一族缺陷本身的形状。

  ## 判据:记录绑定是否对已声明字段**全量**

  这不是口味问题,也不是"这个谓词是不是 CEL"。实测 `@marcbachmann/cel-js`,两种绑定
  下的语义**恰好相反**:

  | 谓词                  | 全量绑定 `{a: null}`     | 稀疏绑定 `{}`          |
  | :-------------------- | :----------------------- | :--------------------- |
  | `has(record.a)`       | `true` ← 陷阱            | `false` ← 真守卫       |
  | `record.a < record.b` | FAULT `no such overload` | FAULT `No such key: a` |
  | `record.a != null`    | `false` ← **修法有效**   | FAULT `No such key: a` |

  即:全量绑定下 `has()` 恒真而无用、`!= null` 是解药;稀疏绑定下 `has()` 恰恰是正确的
  守卫,而 `!= null` **自身就会 fault**。把闸门指向一个稀疏绑定的面,等于判红正确的元数据、
  并给出一个会把它改坏的"修法" —— 比不覆盖更糟。所以:**只有绑定全量的面才可以接入。**

  ## 纳入:字段 `requiredWhen`

  议题没有列出这一面,而它恰恰是唯一满足判据的:`evaluateValidationRules` 用与对象校验
  规则**同一个** `materializeDeclaredFields` 合并记录来求值 `requiredWhen`。

  它也是几个已覆盖面里失败得最安静的一个:`requiredWhen` 谓词 fault 时是 **fail-open** ——
  `rule-validator.ts` 记一行 `failed to evaluate — skipped` 就跳过,字段于是**从未真正必填**,
  写入照常通过。校验规则至少自 #4761 起是 fail-closed 的拒绝。因此报错文案按面区分后果:
  "被跳过、字段从未必填"与"写入被 fail-closed 拒绝"是两个相反的故障,作者需要知道自己
  碰到的是哪一个。

  ## 排除,且各自留下可引用的理由

  - **action `visible` / `disabled`**:谓词确实走真 CEL(裸串经 `ExpressionInputSchema`
    规范成 `{dialect:'cel'}` 信封,渲染器保留它),fault 也确实 fail-closed —— 陷阱在这一面
    是真的。但绑定是客户端已取到的那条记录(详情读取,或只带列表视图投影列的一行),
    `objectui` 这条路径上不存在任何物化步骤。稀疏绑定下 `!= null` 是错的修法。要覆盖它,
    得先决定是否把该绑定做成全量 —— 那是平台契约改动,不是 lint 改动。
  - **flow / edge `condition`**:议题记的理由(扁平作用域下裸标识符可能是 flow 变量)对本
    模块**不成立** —— 它只解析 `record.<f>` / `previous.<f>`,从不解析裸标识符,而引擎无
    条件绑定这两个根。真正的阻碍还是全量性:`record-change-trigger.ts` 把记录播种为
    `{ ...inputDoc, ...after }`,没有 `materializeDeclaredFields`,所以写入未提及的已声明列
    是**缺键**而非 null,`!= null` 会和它本要守卫的比较一样 fault。
  - **字段 `readonlyWhen`**:与 `requiredWhen` 同一个字段、相反的结论 —— 它由
    `stripReadonlyWhenFields` 求值,那里合并的是 `{ ...previous, ...data }`,从不物化。
  - **`Field.formula`**:按产品判断排除,而非按本判据。formula 是 `value` 角色、天然可空,
    `guard ? value : null` 是被祝福的写法(#3306)。是否强制守卫会改变"作者被允许写什么",
    该由维护者决定,不是一个接线缺口。

  判据、实测表与逐面台账写在 `validate-null-guards.ts` 的模块注释里,每条排除在它对应的
  调用点也留了注释,并各配一条断言钉住。

  ## 顺带修正:`field '?'`

  诊断的字段名此前走 `Object.values(fields)`,把**名字键**丢掉了 —— 而名字键正是
  `Field.text({…})` 这种(最常见的)写法产生的形状,于是这类对象上的每条字段级诊断都定位在
  `field '?'`。名字只出现在 `where` 里时还能忍;现在报错正文要告诉作者改哪个字段,就不能忍了。

- af96af6: fix(lint): `validateOrgAxisRedLines` reads the sharing-rule keys the spec declares — the ADR-0105 D6 red lines fired on nothing before (#4984)

  The two ADR-0105 D6 red lines are declared `error` and gate `os validate` /
  `os build` / `os lint`. On the sharing-rule path neither of them could fire.

  `validateOrgAxisRedLines` read `rule.criteria ?? rule.filter` and
  `rule.sharedTo ?? rule.recipient`. `SharingRuleSchema` is `.strict()` and its
  declared keys are `condition` and `sharedWith`; all four names it was reading
  exist only as **rejected aliases** in `sharingRuleUnknownKeyError`, the
  prescription attached to the refusal message. The rule runs on the post-parse
  stack (`input: 'parsed'`), so for every spec-valid stack those four properties
  were `undefined`, `JSON.stringify(undefined ?? '')` was `'""'`, and the
  `parent_organization_id` test was constantly false.

  **This is a behaviour change: the rule previously never triggered.** Both red
  lines are now live on the sharing-rule path:

  | Authored shape                                                               | Before | After                                                                     |
  | :--------------------------------------------------------------------------- | :----- | :------------------------------------------------------------------------ |
  | `condition` reading `parent_organization_id`                                 | passed | `error` `org-axis-permission-inheritance` at `sharingRules[i].condition`  |
  | `sharedWith` reading `parent_organization_id`                                | passed | `error` `org-axis-permission-inheritance` at `sharingRules[i].sharedWith` |
  | `sharedWith: { type: 'business_unit' }` on a `tenancy.enabled: false` object | passed | `error` `org-axis-cross-org-bu-grant` at `sharingRules[i].sharedWith`     |

  A stack that ships today keeps building unless it contains one of those three —
  the shapes D6 forbids and the gate was meant to have been refusing all along.
  The rejected aliases are deliberately **not** read: a rule spelling `criteria`
  or `sharedTo` is refused by the schema's own parse with the canonical key
  named, and a consumer must not tolerate what the producer's contract rejects.

  `condition` is an `ExpressionInput`, so all three of its shapes are scanned —
  the authored bare string, the parsed `{ dialect, source }` envelope, and the
  compiled `{ dialect, ast }` form.

  The rule's own tests were the reason this survived review: their fixtures used
  the same rejected aliases, so the suite was green while the gate was dead. Every
  sharing-rule fixture now goes through `SharingRuleSchema` before the lint sees
  it, and every object fixture through `ObjectSchema` — a fixture that drifts from
  the spec surface fails at the fixture instead of silently exercising a shape no
  author can write.

- 5b8f95b: fix(objectql,lint): enforce parent-scoped `readonlyWhen` on the server (#4889)

  `readonlyWhen: P\`parent.status == 'paid'\``— the documented "once the header
invoice is Paid, its lines are frozen" lock — was enforced **only in the client
grid**. The server-side strip bound`record`and`previous`and had no`parent`at all, so every parent-scoped predicate faulted, took the fail-open branch, and
the write landed anyway. On the reference app that meant one`PATCH` rewrote the
  quantity and unit price of a settled invoice's line: HTTP 200, value persisted,
  the grid still drawing the cell read-only. ADR-0057 D10 puts enforcement on the
  server and makes the client courtesy; here only the courtesy layer enforced.

  **`parent` is now bound on the write path.** For a detail object — one declaring
  exactly one `master_detail` relationship — the engine resolves the master record
  and binds it as `parent` before the strip runs, on both the single-id and the
  bulk (`multi: true`) update paths. A repointing write is judged against the
  master it _lands on_, not the one it leaves. The read is gated on the payload
  actually touching a parent-scoped predicate (decided from the parsed CEL AST, so
  a field named `parent_id` costs nothing), and the bulk path batch-reads the
  distinct headers in one query rather than one per row.

  **An unbindable scope no longer waives the lock.** A `readonlyWhen` that names a
  root the operation could not bind now resolves to **locked** — the field is
  stripped — instead of "not locked". "The platform could not check this" must not
  mean "allowed" on a field the author declared frozen. This is deliberately the
  narrowest possible carve-out from the fail-open policy the strip has always had:
  a predicate that is merely _broken_ on the record (undeclared key, `null`
  ordering overload, parse error, engine throw) still fails open exactly as
  before, and `requiredWhen` / option `visibleWhen` are untouched. Recorded as an
  addendum to ADR-0058's D5 fail-policy matrix, alongside the same narrowing
  already made for validation predicates (#4649) and hook conditions (#4775).

  **And the runtime branch is a backstop, not the plan.** `objectstack compile`
  now **rejects** a `parent`-scoped `readonlyWhen` on an object that declares no
  `master_detail` relationship, or two of them (where the metadata does not say
  which one is "the parent" and picking by declaration order would make a
  data-integrity lock depend on field ordering). The common authoring mistake is
  caught where it is cheap to fix, so it never reaches a runtime that has to judge
  it — declared, not guessed.

  No metadata changes are required: an app whose parent-scoped locks were already
  correct simply starts having them enforced. If you authored one on an object
  with no single master, the build now names it.

- 73580e7: feat(lint): the react-page publish gate PARSES `ChartAggregateSchema` instead of re-deriving it (#5020)

  `<ObjectChart aggregate={{…}}>` is judged at publish time by
  `validate-react-page-props`. That gate used to RE-DERIVE the aggregate's
  declaration: a local `CHART_FUNCTIONS` copy of the function vocabulary and a
  hand-written twin of the schema's count/field refinement. Two implementations of
  one contract, each free to drift — and, because unknown-key handling is a
  property of a **parse** rather than of a list of `if`s, a gate with no
  unknown-key check at all. The rule now calls `ChartAggregateSchema.safeParse()`
  on a statically resolvable literal, exactly as #5022 did for
  `ChartDrillDownSchema` beside it, and both hand-derived copies are deleted:
  `@objectstack/spec` is the single source of the vocabulary and the refinement
  again.

  **Newly reported (all `error`, all previously silent).** These are shapes the
  schema, the published react-blocks type and objectui's renderer already agreed
  were wrong; the old gate simply could not see them:

  | authored                                                            | before   | after                                                                                                            |
  | ------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
  | `aggregate={{ field: 'total', groupBy: 'status' }}` (no `function`) | accepted | `aggregate.function: Invalid option: expected one of "count"\|"sum"\|"avg"\|"min"\|"max" (nothing is set there)` |
  | `aggregate={{ field: 42, function: 'sum', groupBy: 'status' }}`     | accepted | `aggregate.field: Invalid input: expected string, received number`                                               |
  | `aggregate={{ function: 'count', groupBy: 42 }}`                    | accepted | `aggregate.groupBy: Invalid input (received 42) — no accepted form matched: (1) … (2) …`                         |
  | `aggregate="count"` / `aggregate={[]}`                              | accepted | `aggregate must be a configuration object, not string.`                                                          |

  **Re-worded, same verdict.** Two messages now arrive from the schema rather than
  from this rule's own copy. If you match on lint output, update the text:

  - FROM `aggregate.function "median" is not an aggregation this chart can run.`
    (hint: `Use one of: count, sum, avg, min, max.`)
    TO `aggregate.function: Invalid option: expected one of "count"|"sum"|"avg"|"min"|"max" (received "median")`
    — the vocabulary is the enum's own, and the author's value is echoed back from
    the input (the one part zod does not put in the message).
  - FROM `aggregate.function "sum" has no "field" to aggregate.`
    TO `aggregate.field: aggregate.function "sum" needs a "field" to aggregate (only "count" may omit it).`
    — verbatim from the schema's refinement.

  The rule id (`react-chart-aggregate-invalid`) and the severity are unchanged for
  both.

  **`aggregate.groupBy` missing is a NEW `warning`, deliberately not an error.**
  It is the one violation the platform does not agree with itself about:
  `ChartAggregateSchema` and the published react-blocks type both declare `groupBy`
  **required**, while objectui's `ObjectChart` honours its absence
  (`schema.aggregate?.groupBy || schema.xAxisKey`) and this protocol's own
  `chartAggregateCategoryKey` documents the ungrouped single-row result. Gating it
  would break a working authoring shape to enforce a declaration the platform does
  not keep, so the finding explains the situation and does not fail
  `os lint`/`validate`/`compile`. Whether the schema loosens or the renderer
  tightens is decided on #5583.

  **What this does NOT fix yet.** `ChartAggregateSchema` and `ChartGroupBySchema`'s
  object arm are still STRIP-posture, so the parse this gate now runs **drops** an
  unknown key rather than reporting it: `groupby` for `groupBy` and
  `dateGranularty` for `dateGranularity` still degrade a chart to one ungrouped
  point with the build green. Wiring the parse is the precondition for closing
  that, not the closing — `.strict()` is a property of a parse, and until now there
  was no parse to make strict. The spec-side tightening is **#5583**; the tolerance
  is pinned by name in this rule's tests so a wired gate cannot be mistaken for a
  closed one (#4583).

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

- 73e576f: feat(lint,spec): SDUI 组件 props 接上解析闸门 —— `ComponentPropsMap` 不再是「声明了、从不被 parse」(#5068)

  `PageComponent.properties` 是 `z.record(z.string(), z.unknown())` 这个开放口袋。
  `PageComponentSchema` 自 ADR-0089 D3a 起是 `.strict()`,但**严格性不递归**:它守住
  component 节点自己的键,`properties` 里面一个字都没人看。于是 `ComponentPropsMap`
  里 31 个 typed props schema 从来没有被任何东西 parse 过(#4001 批 17 的 `no gate`
  判定:载体活着、parse 缺席)。后果不是无害的 —— objectui 的 `SchemaRenderer` 会把
  `properties` 整个 hoist 到节点上,再把 deny-list 之外的每个键 spread 成 React prop,
  所以一个拼错的键既不被拒绝也不被丢弃:它一路走到渲染器,在那里被忽略,而作者拿到
  的是一张成功回执。这正是 ADR-0078 要消灭的形状。

  **新规则(两个诊断 id,均为 warning 级)**,落在 `@objectstack/lint`,按维护者对
  #5068 的裁定走方向 A —— 在载体自己的授权门上分派解析,而不是改 `page` 协议的形状:

  - **`component-props-unknown-key`** —— props schema 未声明的键,包括 props 包自身
    这一层和它底下每一个 strip 姿态的对象。走的是 `lintUnknownKeysAgainstSchema`
    (本次从 `@objectstack/spec` 导出,即 `lintUnknownAuthoringKeys` 用在每个 metadata
    集合上的同一个 walker),所以 strip/strict/passthrough 的姿态规则与改名建议都是
    单一实现,这里不重新推导一遍。
  - **`component-props-invalid`** —— props schema 拒绝的值:类型不对、必填缺失、枚举
    越界。

  配套的一条契约细节:走到第二层。`readonly`(#5176)挂在 `RecordHighlightsField`
  联合体的对象成员上,即 `fields[]` 数组项里面 —— authorable-surface walk 严格一层、
  到不了那里(#5607 的更正)。本闸门到得了,并且两个方向都钉了测试:声明过的
  `readonly` 必须静默,拼错的 `readOnly` 必须报出来并指名正确拼法。

  **未注册 type 一律跳过**,这是必须语义而不是宽松:`PageComponentSchema.type` 是
  `z.union([PageComponentType, z.string()])`,光是仓内 example 语料就授权了 10 种本
  map 不承载的类型、共 87 个节点(`flex`、`grid`、`object-metric`、`object-chart`、
  `record:line_items` …),它们的契约在 objectui 注册表和 ADR-0080 manifest 里。拿一个
  不存在的 schema 去审判它们,只会把每一个都报成坏的。

  **为什么本步只落 warning。**接上 parse 是执法的前置条件,不是执法本身(#5020 在隔壁
  表面上的同一课)。闸门落在真实语料上会报 52 条:其中 34 条是三个已发布平台页把
  `{ en, 'zh-CN' }` 内联多语言 map 写进了声明为纯 `z.string()` 的 `I18nLabelSchema`
  (#5728,裁定中),另有 8 条是 `element:text.content` 上同一形状。今天就 gate 掉它们,
  等于用平台自己都不遵守的声明去否掉平台自己的页面。warning 期的违例清单就是 error
  升级的验收基线,升级本身是独立一步。

  作者侧不变:`properties` 仍然照原样解析、原样保留,没有任何东西开始被拒绝 ——
  `os validate` / `os build` / `os lint` 多了一类建议性诊断而已。存储路径(`saveMetaItem`
  / REST `/meta`)仍然不校验 props 包,这一点被如实记录、未在本次修复。

- ddd6650: feat(lint): reject a sharing-rule condition the runtime can only skip (#4698)

  #4698 reported the same failure shape three times in one app in one day: a key
  that is authored, is schema-valid, reads as meaningful — and is never consumed
  by the runtime. Every check verifies that what is declared is _well-formed_,
  never that it is _read_. The issue's third measured instance is a sharing rule
  whose CEL `condition` uses `has(...)`: the seeder cannot lower it, skips the
  rule, and the only signal is one WARN line at boot. The rule exists in
  metadata, is absent from `sys_sharing_rule`, and grants nothing.

  **New rules, both `error`, on all three authoring commands:**

  - **`sharing-rule-unlowerable-condition`** — the condition is outside the
    pushdown subset: a function call (`has(...)`, `size(...)`), arithmetic, a
    ternary, or a cross-object path (`record.account.region`).
  - **`sharing-rule-runtime-variable-condition`** — the condition reads
    `current_user.*`. Criteria sharing rules are materialised (one static
    `criteria_json` per rule, from which grants are written), so there is no
    "current user" at compile time. The fix is a different mechanism, not a
    different spelling, which is why it has its own id.

  Fix each by rewriting the predicate inside the lowerable subset — `==` `!=`
  `>` `<` `>=` `<=`, `in`, `&&` `||` `!`, `== null` / `!= null`, and
  `startsWith` / `endsWith` / `contains` over single-column `record.<field>`
  paths (ADR-0058 D2). Two specific migrations: `has(record.x)` → `record.x !=
null` (`has()` is correct in an object _validation_ rule, which is
  interpreted, and wrong here, where the condition is compiled); and a related
  record's field → denormalise it onto this object (formula/rollup) and test
  that column, or share the related object instead. For per-user access, use an
  RLS policy (`rowLevelSecurity[].using`), where `current_user.*` _is_ resolved.

  **Why this one surface and not "unread keys" in general.** "Is this key read?"
  is only a lint question when the answer is computable from the authored
  metadata alone, and usually it is not — a repo-wide grep for a reader is not
  evidence of absence, and a consumer may live in another package, another repo,
  or an uninstalled plugin. A sharing rule's `condition` is the case where the
  predicate is exact: its one runtime consumer
  (`bootstrapDeclaredSharingRules`) does exactly one thing with the key —
  `compileCelToFilter(condition, { variables: {} })` — and a condition that does
  not lower means the rule is skipped outright. So the lint calls that same
  compiler, from the same package, with the same options, instead of modelling
  the consumer; the verdict is identical to the seeder's by construction and is
  pinned in both directions by a test over a shared corpus.

  `error` rather than advisory, per the ADR-0078 claim `SharingRuleSchema`'s own
  docblock makes ("the whole authorable surface is enforced — nothing here
  validates and then silently does nothing"): there is no reading under which an
  unlowerable condition does what it says. It fails closed, which is why it was
  survivable, not why it was acceptable. Measured before shipping: every
  sharing-rule condition declared anywhere in this repo lowers cleanly, so the
  gate turns nothing red that works today.

  CEL _syntax_ errors are deliberately left to `expression-invalid`, which
  already gates this same field with a message written about syntax.

- 1e6ab15: feat(lint): uniqueness-scope rules speak the ADR-0120 vocabulary (#4986, D5a/D5b)

  - **New rule `unique/unscoped-declared-index`** (warning, advisory): a declared
    index with bare `unique: true` — the spelling whose scope is unstated, the
    #4986 trap. Fires on the spelling alone (no tenancy/posture inference —
    `organization_id` is kernel-injected at registration, so an authoring-time
    guess would be wrong half the time; see #4698). The fix names both words:
    `'global'` (installation-wide — exactly today's behavior) or
    `'organization'` (one holder per organization). Protocol 18 rejects the
    spelling (#5082). Exported as `lintUnscopedDeclaredIndexes` +
    `UNIQUE_UNSCOPED_DECLARED_INDEX`, registered as its own AUTHORING_RULES
    entry (validate/build) and called by `lintDataModel` for `os lint`, so all
    three commands report it — each finding exactly once.
  - **R10 `unique/double-declaration` rewritten as the four-quadrant scope
    matrix** (ADR-0120 D5b): field `true`/`'organization'` × declared `'global'`
    (or bare `true`, its deprecated spelling) on the same single column =
    CONTRADICTION (the installation-wide index wins physically; the
    per-organization intent is silently dead) — and the mirror, field `'global'`
    × declared `'organization'`, likewise; same scope on both sides = REDUNDANCY
    (the same index declared twice). The old field-`'global'` exemption is gone
    (now reported as redundancy), and the fix text replaces the hand-written
    `fields: ['organization_id', …]` advice with the `'organization'` spelling —
    the hand-written composite is not NULL-safe (#5030).

### Patch Changes

- c1e67e0: fix(lint): 扩 ADR-0105 D6 ② 的收件人词表至 ADR 原文范围 —— `unit_and_subordinates`
  也判红

  `org-axis-cross-org-bu-grant`(D6 ②)此前只对 `sharedWith.type ===
'business_unit'` 判红,而授权面**更大**的另一个业务单元收件人
  `unit_and_subordinates`(一个 BU **加上其全部后代单元**,ADR-0057 D5 子树扩张)
  直接放行。两者的缺陷完全相同:平台级对象(`tenancy.enabled: false` /
  `systemFields.tenant: false`)没有 organization 列可供 Layer 0 收口,BU 子树没有
  任何 organization 可供解析,授权因而跨到库里每一个 organization —— 正是 ADR 拒绝
  的"跨 org BU 巨树",从后门到达。

  漏掉的恰恰是 ADR-0105 D6 ② 自己点名的那一个:

  > Every BU mechanism — `unit_and_subordinates` sharing, `adminScope`
  > delegation, depth scopes — operates within one organization. There is no
  > cross-org tree.

  判定改为收件人类型 ∈ `{ business_unit, unit_and_subordinates }`,诊断信息里点名
  **实际写下的**类型并说明其触及范围(子树那一个额外写明 "AND every descendant
  unit"),修复建议改为指向三个扁平收件人。

  词表与 spec 枚举 `ShareRecipientType` 的差集不再是隐式的:规则里以表格逐条写明
  拦截二者、放行 `user` / `team` / `position` 的理由(它们的运行时展开都不经
  `BusinessUnitGraphService`,是 `tenancy.enabled: false` 平台级目录**被设计用来**
  共享的方式),并附一条测试断言两半恰好划分 `ShareRecipientType` —— 将来枚举加成员
  会在词表处失败,而不是无声地落进没人选过的那一桶。#4991 正是这条断言缺席的产物。

  这是 error 级门禁的扩张,因此复核了真实元数据:`examples/app-showcase` /
  `app-crm` 是仓库里仅有的已声明 sharing rule(共 11 条),全仓无任何对象关掉
  tenancy,扩张后 org-axis 红线数为 **0** —— 不产生新红。

- 641363a: fix(docs,lint): 修正两处裸引用公式样例,并给公式样例补一道 CEL 语义门 (#5116)

  #5026 把字段公式校验从 `f.formula`(spec 按名拒绝的别名)收敛到声明的
  `f.expression`,**激活了一条从未跑过的检查**。它的真实元数据扫描顺带发现文档和博客
  里有两处公式样例写的是**裸引用**:

  - `content/docs/data-modeling/fields.mdx` — `'quantity * price * (1 - discount / 100)'`
  - `content/blog/context-window-is-the-constraint.mdx` — `` cel`amount * probability`  ``

  裸引用在 CEL 里不报错,而是**静默求值为 null**:公式表达式把记录绑定在 `record`
  命名空间下,顶层的 `quantity` 什么也解析不到。照这两行写出来的元数据,在 #5026
  之后会被 `os build` / `os validate` 判红 —— 文档教的写法和平台的门直接矛盾。两处
  都已改成 canonical 的 `record.` 前缀形式。

  **新增 `@objectstack/lint` 的 `check:doc-formula-expressions`**,堵住让这两条长期
  存活的那个洞。`check:doc-authoring` 看的是字面量的**形状**,`check:skill-examples`
  对标记块跑 `tsc --noEmit` —— 两者之间,"能编译但 CEL 写错"的样例没有任何门:
  `expression` 的类型就是 `string`,`'quantity * price'` 和
  `'record.quantity * record.price'` 编译得一样好,而只有后者能用。

  判决直接 import `@objectstack/formula` 的 `validateExpression` —— 和 `os build`
  走的是同一个调用,不是仿制品。于是文档是被**规则本身**把关,而不是被规则的一种方言
  把关(Prime Directive #12)。

  门的难点不在判决而在**判据**:同一个 `expression:` 键在语料里承载至少三种互不相干的
  契约 —— 记录作用域的 CEL 公式、flow 的扁平作用域谓词(那里裸引用是**对的**)、以及
  `schedule` 下压根不是 CEL 的 cron 串。按键名匹配会把后两类全部误判为红。所以它只认
  **解析后的结构**,且只认两种不可能有歧义的形状:`Field.*({ expression })`,以及
  `type: 'formula'` 与 `expression` 并列的对象字面量。无法提取的块**报错而不是跳过**
  ("absence must be loud")。

  覆盖面是明说的,不含糊:只看 TS/TSX 代码块、只看能静态取出的表达式源、不做字段存在性
  校验(文档片段没有对象声明)、flow / action / validation 谓词**刻意不在范围内**。

- d4edb5d: fix(lint): the flow rule family now descends into `loop` bodies and every other nested region (#5383)

  The flow anti-pattern rules read a flow's `nodes` / `edges` **flat off the top
  level**, so every rule in the family was blind to anything authored inside an
  ADR-0031 container — a `loop` body, a `parallel` branch, a `try_catch`
  try/catch. Loop bodies are where a lot of real branching lives (a per-item gate
  inside a sweep is the standard shape for a scheduled flow), so this was a large
  share of authorable flow metadata that no flow rule inspected.

  Measured in a real app: 8 `decision` nodes carried the inert singular
  `config.condition` that `flow-inert-node-condition` exists to catch, all 8
  inside a `loop` body, and `pnpm lint` reported none of them. The identical key
  on a **top-level** decision in the same repo fired immediately — same key, same
  node type, only the nesting depth differed. The blind spot also explains its own
  survival: the gate visibly worked where it could see, so the top-level copies
  got cleaned up while the nested ones read as approved.

  Rules now reported at every depth: `flow-inert-node-condition`,
  `flow-decision-unconditional-branch`, `flow-branch-label-unmatched`,
  `flow-default-edge-with-condition`, `flow-multiple-default-edges`,
  `flow-double-brace-interpolation`, `flow-bare-dollar-reference`,
  `flow-date-equality-filter`, `flow-phantom-aggregation`,
  `flow-error-label-not-fault`, and the `flow-approval-revise-*` family. Note the
  severity asymmetry this closes: `flow-default-edge-with-condition` is a
  build-stopping `error` that until now could not see a contradiction authored one
  level down.

  A finding inside a region carries the region scope in its `where`, so the
  message still points at exactly one node — `flow 'x' · loop 'sweep' body ·
node 'y' (decision)`, matching the scope vocabulary the engine's registration
  pass already uses. Findings on a flow's own graph are unchanged, byte for byte.

  Two details worth knowing if you consume these findings:

  - Each region is scanned against **its own** `edges`. The branch-routing rules
    reason about a node together with its out-edges, and a region is a
    self-contained sub-graph, so a nested decision's out-edges live in the
    region's own edge list.
  - `flow-double-brace-interpolation` / `flow-bare-dollar-reference` scan a node's
    config recursively, and a container's config physically contains its
    descendants'. A nested hit was therefore already _visible_ before this change
    — but attributed to the enclosing `loop` rather than the node carrying the
    string. Such a finding now names the right node, and is still reported exactly
    once.

  `flow-runas-unscoped` deliberately keeps looking at top-level nodes only:
  widening a build-gating rule is its own change with its own blast radius, and is
  tracked separately.

- eb26126: fix(lint): `flow-runas-unscoped` now sees data nodes nested in a `loop` body / `parallel` branch / `try_catch` region (#5633)

  **This widens the coverage of a build-GATING rule.** `flow-runas-unscoped` is
  `severity: 'error'`, so a flow it newly catches goes from a green build to a
  failed one. That is the correct outcome — those flows cannot run at all — but it
  is a real blast radius and the reason this shipped as its own change rather than
  riding along with #5383.

  **What was wrong.** #5383 gave the flow anti-pattern family a per-region walk and
  deliberately left this one rule reading the flow's **top-level** `nodes` only. Its
  data-node search is the rule's evidence that the flow _performs a data operation
  at all_ — and a data node inside a `loop` body is exactly as unscoped as one at
  the top level. So a scheduled flow that queried a set, looped it, and wrote per
  item passed `os build` / `os validate` clean and was then **refused at run time**:
  since #3760 a user-less run really does refuse the data operation rather than
  running it unscoped. Passing the build and then being unable to run is precisely
  what promoting this rule to `error` was for, and the shape it was missing —
  query, loop, write per item — is _the_ standard shape for a scheduled flow, so
  the write is almost always the nested node.

  Measured, same flow with only the node's position changed:

  ```
  update_record at TOP level     -> 1 finding [error]
  update_record INSIDE loop body -> 0 findings   (now: 1 finding [error])
  ```

  **What changed.** The data-node search runs across `collectFlowGraphs(flow)` —
  every ADR-0031 region, at any depth — while the finding itself stays **flow-level**
  exactly as before: one per flow, `where` = `flow 'x' · runAs`, because `runAs`
  is a flow property and the region only supplies the evidence. The region is named
  in the **message** so you can find the node:

  ```
  flow 'nightly_sweep' · runAs: schedule-triggered flow runs under `runAs:'user'`
  (the default when none is declared), but a schedule run has no trigger user — so its
  data node 'touch' (update_record), in loop 'loop_rows' body, has no identity to scope
  to and will be REFUSED at run time.
  ```

  (The sentence's opening was re-worded by #5693 in this same release window; the
  sample above is the wording that actually ships.)

  **Nothing about the top-level case moved.** A flow whose evidence is a top-level
  data node produces the same message with no region clause, and when a flow has
  data nodes at both altitudes the top-level one is still the node cited —
  `collectFlowGraphs` yields the flow's own graph before it descends. Both are
  pinned by tests.

  **If this newly fails your build:** the flow was already broken at run time. Add
  `runAs: 'system'` to declare the elevation the sweep needs (a schedule /
  time-relative / API run has no user to scope to — there is none). See ADR-0049,
  ADR-0073 D5, #1888, #3760.

  The repo's three example apps (`app-showcase`, `app-crm`, `app-todo`) are
  unaffected — `os validate` output is line-for-line identical before and after.

- be59695: fix(lint): `flow-runas-unscoped` stops telling an author they declared a `runAs` they never wrote (#5693)

  The rule's message branched on whether `runAs` was **authored** or **defaulted**:

  ```ts
  typeof flow.runAs === "string" ? `runAs:'user'` : `the default runAs:'user'`;
  ```

  That distinction is real and useful — "you wrote something incoherent" is not
  "you inherited a default that does not fit a user-less trigger" — but the rule
  cannot observe it, and which arm an author got depended on the **surface** rather
  than on their file.

  **On the CLI, only the explicit arm was reachable.** `FlowSchema.runAs` carries
  `.default('user')` and the registry wires this rule `input: 'parsed'`, so
  `flow.runAs` is the string `'user'` whether the author wrote it or not. `os lint`
  does not Zod-parse, and would have escaped that — except `defineStack` /
  `defineFlow` parse at _definition_ time, so the config module hands even the
  non-parsing command a stack with the default already filled in.

  Measured on `examples/app-todo`, `overdue_escalation` with its `runAs` line
  deleted — the author declared nothing:

  ```
  BEFORE — os validate
    flow 'overdue_escalation' · runAs: schedule-triggered flow runs as `runAs:'user'`, but a
    schedule run has no trigger user — so its data node 'get_overdue_tasks' (get_record) …

  BEFORE — os lint
    ✗ flow 'overdue_escalation' · runAs: schedule-triggered flow runs as `runAs:'user'`, but a
    schedule run has no trigger user — so its data node 'get_overdue_tasks' (get_record) …
  ```

  Both commands told someone who had written no `runAs` that their flow "runs as
  `runAs:'user'`" — which invites _"I never wrote that, the tool is confused"_ at
  exactly the moment the tool is right and the fix is one line away.

  Meanwhile the **runtime publish gate** (#4463) judges the verbatim authored body,
  so it really did reach the other arm — the same flow was told two different
  things by two shipped surfaces.

  **What changed.** One sentence, true of both authoring inputs, on every surface:

  ```
  AFTER — os validate and os lint, identical
    flow 'overdue_escalation' · runAs: schedule-triggered flow runs under `runAs:'user'`
    (the default when none is declared), but a schedule run has no trigger user — so its
    data node 'get_overdue_tasks' (get_record) has no identity to scope to and will be
    REFUSED at run time.
  ```

  The parenthetical is a statement about the **value**, not an accusation about the
  author, so it stays true for someone who did write `runAs:'user'`. This is the
  house pattern rather than a new one: `flow-draft-status-ambiguous` says `has
status 'draft' (the default when none is authored)` for the same reason, on the
  same mechanism.

  Only the wording moved: the same flows are flagged, with the same
  `severity: 'error'`, the same `where`, the same `hint`, and the same region
  clause when the evidence node is nested.

- b2e1057: fix(lint): report a `config.timeRelative` descriptor the sweep will refuse, at authoring time (#5496)

  A flow start node declaring `config.timeRelative` got **zero** authoring-time
  diagnostics when its descriptor could not parse. The two rules that look at the
  slot each looked at something else: `lint-flow-patterns` decides "this is a
  time-relative flow" from `timeRelative != null` alone (never the shape), and
  `validate-flow-trigger-readiness`'s existing check reads only
  `timeRelative.object`, to compare it against the stack's objects. So

  ```ts
  config: { timeRelative: { object: 'task', field: 'due_at', offsetDays: -1 } }
  ```

  — three separate schema violations: `dateField` missing, `offsetDays` declared
  as an int **array** and written as a scalar, and `field` an unrecognized key —
  passed `os validate` silently. `TimeRelativeTriggerSchema` does reject it, but
  the only place that schema ran was **bind time**, inside
  `TimeRelativeTriggerPlugin.start()`, which warns and returns: the sweep is never
  installed, the flow reports itself armed, and the author's sole feedback is one
  line in a server log. For an AI author that line is outside the feedback loop
  entirely; `os validate` is what it reads.

  **New rule — `flow-time-relative-descriptor-invalid` (warning).** A start node
  whose `config.timeRelative` is present runs that same schema at authoring time,
  and a failure is reported naming `config.timeRelative` with the schema's own
  issue list forwarded — so the diagnostic carries the missing key, the wrong type,
  and, for an unrecognized key, the "did you mean" the schema already computes
  (`field` → `dateField`) plus its wrong-layer guidance (a `schedule` written
  _inside_ the descriptor is told it belongs beside it). The list is rendered
  exactly as the bind-time warning renders it, so the two channels tell one story.

  Nothing is shifted except **when** the schema runs. No shape knowledge is
  re-implemented in the rule and no consumer-side tolerance is added: the verdict
  and every word of its wording remain `TimeRelativeTriggerSchema`'s, so the rule
  tracks the descriptor's contract as it evolves instead of drifting from a second
  copy of it.

  The rule and the existing object-name check decide different facts and cannot
  report the same one twice — only the stack knows whether an object name exists,
  and only the schema knows the descriptor's shape. A descriptor wrong in both ways
  gets both findings, at their own paths. Canonical descriptors are unaffected:
  every one shipped in the repo (the showcase `Task Due Reminder`, the
  `content/docs` examples) parses, so this adds no diagnostic to existing apps.

- ec6fad8: feat(lint): warn when a `multi: true` delete/update is bounded by nothing — the declared whole-object write (#5482)

  A `delete_record` / `update_record` node that declares `multi: true` with no
  `filter` (or an empty one) writes the **whole object**: the executor forwards
  `where: {}` plus the bulk intent, the data engine classifies that as a legal
  `multi` call, and it lands on `driver.deleteMany` / `driver.updateMany` with no
  predicate. Every row, every run.

  That path only became authorable with #5393, which gave these nodes a bulk
  declaration at all — before it the executor never passed `options.multi`, so the
  engine refused every predicate write (`Delete requires an ID or
options.multi=true`) and "empty filter + bulk intent" was not a reachable shape.
  Since then it has been reachable and **silent**: `filter` is optional, `multi` is
  optional, nothing related the two, and the author's only feedback was the step's
  `acted` row count — reported after the rows were gone. The common way to get
  here is not malice but an omission: declaring the bulk intent and forgetting the
  constraint.

  `os validate` / `os build` now report `flow-multi-write-unfiltered` for it:

  ```
  flow 'nightly_purge' · node 'purge' (delete_record)
    declares `multi: true` with no `filter` key — this is a WHOLE-OBJECT write,
    by declaration: every row of 'lead' is deleted on every run. …
  ```

  **A warning, not a gate.** An explicit whole-object purge is something the
  platform grants on purpose — the data engine's own dispatch case-set lists "bulk
  intent with no predicate at all" as a valid call — so the shape has a legitimate
  reading and the run-time path stays open. What was missing was only that the
  author hears about it _before_ the rows go. For the same reason the fix is not a
  schema `refine`: forbidding the shape would delete an intent the engine grants.

  Two ways to satisfy the warning: write the constraint you mean into `filter`
  (the bounded-bulk reference shape is app-showcase's `showcase_inquiry_purge`), or
  confirm that emptying the object is the intent and keep it.

  **It does not duplicate the #3810 run-time guard, which judges a different
  fact.** That guard refuses a node when a condition the author _wrote_
  interpolated to nothing (`{record.ownr}` — a typo — leaving `{}`), and it is
  deliberately keyed on "a written condition is gone" rather than on "the filter is
  empty", because losing one of two conditions also widens the blast radius. So:

  | fact                          | judged by          | when      | verdict |
  | ----------------------------- | ------------------ | --------- | ------- |
  | a written condition vanished  | #3810 filter guard | run time  | refuse  |
  | no condition was ever written | this rule          | authoring | warn    |

  A node with `filter: { owner: '{record.ownr}' }` is silent for this rule (a
  condition _is_ written) and refused by that one; a node with no `filter` at all
  is warned about here and — correctly — allowed there. The diagnostic names the
  run-time guard so the two are not mistaken for one check.

  Reported at every nesting depth, which matters because a scheduled sweep whose
  per-item work sits in a `loop` body is the standard janitor shape: a finding
  inside a region carries the region scope (`flow 'x' · loop 'sweep' body · node
'purge' (delete_record)`), on the traversal #5383/#5635 added to this family.

  Deliberately out of range: an empty **combinator** array (`{ $and: [] }`,
  `{ $or: [] }`). #5322/#5134 ruled those and every driver implements the ruling —
  empty `$and` is TRUE (so it _is_ a whole-object write), empty `$or` is FALSE (so
  it matches nothing and must never be warned about) — but telling them apart
  requires the boolean-identity reduction, which already exists producer-side in
  each driver. A hand-written fourth copy inside a linter is how a scan and a
  validator come to answer with two different predicates, so that case is tracked
  separately instead.

- 7f1a635: fix(lint,spec,objectql): 编写期表达式与 `highlightFields` 校验识别注册表注入的系统列 (#5378)

  平台在每个业务对象上注入 `owner_id` / `created_at` / `organization_id` 等系统列,
  文档也把 `ownership: 'user'` 写作 "injects reassignable owner_id"。但编写期的两处
  校验只读**作者声明的** `fields`,于是注入列一律当作不存在:

  - `validate-expressions.ts` 的 `buildFieldIndex` 让 `has(record.owner_id)` 直接
    报错 `unknown field owner_id`;
  - `highlightFields` 存在性检查对 `['owner_id']` 发出 "is not a field on this
    object — it is silently skipped by every consumer"。

  也就是平台自己的 linter 否认平台自己的契约。结果是应用被迫**重声明系统列**才能通过
  编写期校验:hotcrm#548 为此在全部 12 个业务对象上显式声明了 `owner_id`(6 个对象曾
  报 `highlightFields` 警告,`contact_welcome` 触发器的 `has(record.owner_id)` 被硬
  拒)。这正是本项目视为缺陷的形状:能力已声明(列确实注入且有文档),但执行层不认。

  **权威来源只有一份。** 新增纯派生 `resolveInjectedSystemColumns()`
  (`@objectstack/spec/data`)回答"这个对象带哪些系统列",并由 registry 的
  `applySystemFields()` **消费**它——沿用 #3786 为审计字段族确立的分工:spec 声明
  **有哪些**列,registry 拥有**每列长什么样**。lint 通过同一派生取答案,因此编写期
  判断与运行时注入不可能不一致(`@objectstack/lint` 的包契约是"只依赖 spec,绝不依赖
  运行时",此前它根本无法读到权威)。两个消费面共用同一判定,不各写一份。

  **并入是按对象有条件的**,不是无条件放行整张系统列名单:`ownership: 'org' | 'none'`
  的对象没有 `owner_id`,那里的 `record.owner_id` 仍然是真错误并继续报;
  `tenancy.enabled: false` 无 `organization_id`;`systemFields: { audit: false }` 无
  审计四列;`systemFields: false` / `managedBy: 'better-auth'` 什么都不注入(只剩驱动
  提供的主键 `id`)。真正拼错的字段照旧被拒,并且注入列现在也进入 "did you mean?" 候选
  (`record.ownerid` → 提示 `owner_id`)。

  被解析的注入列在诊断与补全语义上与授权字段等同;类型健全性与 null-guard 两个索引
  **刻意**仍只读声明字段,原因写在各自注释里:列的 `type` 与可空性属于 registry 的列
  定义,在 lint 侧另立一份就是本次要消灭的第二份副本,而 null-guard 喂的是会中断构建的
  判定,擅自并入会让今天能构建的 stack 变红。

  注入行为本身零改动:`applySystemFields` 的输出在全条件矩阵上逐列不变(新增 parity
  pin 用实跑注入代码比对)。已显式重声明系统列的应用不受影响——重声明仍然合法,
  examples 三个 app 的 `os validate` 输出改动前后完全一致。

- 5d3ced9: fix(objectql,lint)!: a `json_schema` validation rule's `format` keyword is now ENFORCED — records that passed before can start failing (#5029)

  > **⚠️ BEHAVIOUR CHANGE ON DEPLOYED DATA — READ BEFORE UPGRADING.** A `format`
  > keyword inside a `json_schema` validation rule used to enforce **nothing**.
  > It now enforces. If any deployed object carries such a rule, writes that
  > succeeded on the previous version can be **rejected** after this upgrade —
  > including writes from flows, seeds, imports and integrations, not just the UI.
  > Nothing about the metadata changed; the runtime simply started honouring what
  > the metadata always said. See "Before you upgrade" below.

  ## What was broken

  `packages/objectql/src/validation/rule-validator.ts` built its shared ajv as
  `new Ajv({ allErrors: true, strict: false })` and stopped there. In ajv 8 the
  `format` keyword is **not built in** — it ships in the separate `ajv-formats`
  package — and under `strict: false` an unregistered format is not an error: ajv
  logs one line at compile time and **drops the keyword**.

  So this rule:

  ```ts
  {
    type: 'json_schema',
    name: 'support_config_shape',
    field: 'support_config',
    message: 'Support config is invalid.',
    schema: {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      required: ['email'],
    },
  }
  ```

  compiled fine, ran on **every** write, enforced `type` and `required` — and
  enforced **nothing at all** for `format`. `{ email: 'not-an-email' }` was
  accepted, for every record, forever. The only signal was a stderr line at
  compile time naming no rule and no object.

  This is the #4649 / #4762 family one level in, and the partial failure is what
  made it nasty: the rule visibly rejects a bad `type` / missing `required`
  payload in dev, so it reads as _working_ while the `format` half never fires.
  `format` is also one of the most reached-for JSON Schema keywords (`email`,
  `uri`, `uuid`, `date`, `date-time`, `ipv4`), so this was not an exotic corner —
  and it is exactly the shape an AI writing metadata reaches for first.

  ## What changed

  - **`@objectstack/objectql`** now depends on `ajv-formats` and registers it on
    the shared instance (`addFormats(ajv)`). The **default (full)** format set is
    used deliberately: `fast` mode trades correctness for speed on precisely the
    formats authors reach for most, and a format that "mostly" matches is the same
    declared ≠ enforced defect with a smaller hole.
  - **`@objectstack/lint`** — the #4762 publish gate
    (`validate-rule-compilability.ts`) compiles every `json_schema` rule with the
    SAME ajv environment the runtime uses, on purpose, so it registers the same
    plugin. This is not cosmetic parity: `ajv-formats` also installs the
    `formatMinimum` / `formatMaximum` keywords, so a gate without it treats them
    as unknown keywords (`strict: false` ⇒ silently ignored) and would publish a
    schema the runtime then refuses to compile — a rule that passes review and
    enforces nothing, which is the failure that gate exists to prevent. The parity
    test now reads the plugin registration out of the runtime's source, so the two
    cannot drift apart silently.

  **Authoring is unchanged.** `format` stays a legal, publishable JSON Schema
  keyword; the publish gate does not refuse it (option 2 on #5029 was considered
  and rejected — refusing standard JSON Schema would push authors into private
  spellings). What changed is only that the declaration is now true.

  ## Before you upgrade

  1. Find the rules at risk: any `object.validations[]` entry with
     `type: 'json_schema'` whose `schema` contains a `format` key, at any depth
     (including inside `$defs` / `$ref` and a `conditional`'s `then` /
     `otherwise` branch).
  2. For each, audit the existing column against that format. Rows already stored
     are **not** re-validated — nothing is rejected retroactively, and no
     migration runs — but the **next write that touches the field** is checked,
     which includes an unrelated PATCH that merely resends the JSON blob.
  3. If a format was aspirational rather than real, remove that `format` key (or
     relax it) _before_ upgrading. Deleting the keyword is now a meaningful,
     visible act rather than a no-op.

  ## Known limitation, recorded deliberately

  A **misspelled** format name is still ignored. `format: 'emial'` compiles under
  `strict: false` — ajv logs `unknown format "emial" ignored` and drops it — in
  both the runtime and the publish gate, so a typo still enforces nothing. That
  behaviour is unchanged here and pinned by test in both packages, so it is a
  known boundary rather than an oversight; closing it is an authoring-time
  decision of its own and is tracked separately.

- 4b50be4: fix(lint): a MISSPELLED `format` in a `json_schema` validation rule is refused at publish time (#5178)

  #5029 registered `ajv-formats` so a `json_schema` validation rule's `format`
  keyword is really enforced. It did **not** close the other half, and said so:
  under `strict: false` — which is load-bearing, because author-written schemas
  legitimately carry vendor keywords — an **unrecognised** format name is a
  non-event. ajv logs one line at compile time and **drops the keyword**:

  ```
  $ node -e "const Ajv=require('ajv'); const addFormats=require('ajv-formats');
    const ajv=new Ajv({allErrors:true,strict:false}); addFormats(ajv);
    const v=ajv.compile({type:'object',properties:{e:{type:'string',format:'emial'}}});
    console.log('validates {e: zzz} =', v({e:'zzz'}));"
  unknown format "emial" ignored in schema at path "#/properties/e"
  validates {e: zzz} = true
  ```

  So an author who types `emial`, `e-mail`, `datetime` for `date-time`,
  `urireference` for `uri-reference`, `ipv_4` for `ipv4` or `Email` for `email`
  gets a rule that is declared, appears in the metadata, appears in every "what
  protects this object" listing, runs on every write, enforces `type` and
  `required` — and enforces nothing for the keyword they actually wrote. The
  record is **accepted**, which is the silent direction: nothing in the metadata,
  the UI or a test run says the constraint is inert. A typo is also the single
  most likely mistake in a hand-written or AI-generated JSON Schema.

  **New gate — `validateRuleSchemaFormats`**, a `gating` entry in
  `AUTHORING_RULES`, so it runs on all three authoring commands (`os validate`,
  `os build`, `os lint`) with no per-command wiring. One rule id:

  | id                                           | fires when                                                                          |
  | :------------------------------------------- | :---------------------------------------------------------------------------------- |
  | `validation-rule-json-schema-unknown-format` | a `json_schema` rule's schema names a `format` the runtime's ajv has not registered |

  Each finding names the rule, the object, the **RFC 6901 JSON Pointer** to the
  offending keyword, and the **nearest registered name**:

  ```
  objects.account.validations.support_shape.schema#/properties/email/format
    `json_schema` validation 'support_shape' on object 'account' names
    `format: 'emial'` at `#/properties/email/format`, which is not a registered
    format. … the schema compiles, the rule ships and runs on every write, its
    `type`/`required` keywords are enforced, and this constraint is enforced on
    no record, ever. The record is ACCEPTED, so nothing downstream reports the
    gap either.
    hint: Did you mean `format: 'email'`? The registered names are: binary, byte,
    date, date-time, … — the default `ajv-formats` set, the one
    `rule-validator.ts` registers (#5029).
  ```

  **The vocabulary is enumerated, never written down.** The registered set is read
  off a live instance of the very ajv the publish gate builds to mirror the
  runtime (`registeredFormatNames()`), not from a hardcoded list. A list would be
  a third opinion that nobody updates: the day `ajv-formats` adds a name, it
  starts refusing a format the write path enforces — a gate that turns working
  metadata red gets switched off, and then protects nothing. Enumerating means the
  gate follows the plugin across an upgrade with no edit at all.

  **The walk is JSON-Schema-aware, because `format` is not a magic word.** Every
  subschema position is visited — `properties`, `items` (both the 2020-12 schema
  form and draft-07's tuple array), `anyOf`/`allOf`/`oneOf`/`prefixItems`,
  `$defs`/`definitions`, `additionalProperties`, `patternProperties`,
  `if`/`then`/`else`, `not`, `contains`, `propertyNames`, `dependentSchemas`,
  draft-07 `dependencies` — at any depth, plus the rules nested in a
  `conditional`'s `then`/`otherwise`. Positions that hold arbitrary **data** are
  deliberately never read: a `format` inside `default`, `const`, `enum` or
  `examples` enforces nothing and was never meant to, so reporting it would invent
  a defect out of a legal document. A non-string `format` (`format: 42`) is left
  to `validation-rule-json-schema-uncompilable`, which already refuses it in
  ajv's own words.

  **The runtime is untouched, and so is the #4762/#5029 compile parity.** Option 2
  on #5178 (make an unknown format a runtime compile error) was rejected: it fires
  at runtime and fail-**open**, since `checkJsonSchema` catches, logs and skips —
  trading one silent gap for another. And this is a separate judgement laid
  _beside_ the existing compile, never folded into it: `validateRuleCompilability`
  still compiles each schema in the runtime's exact environment and still
  **publishes** a typo'd format, because a typo'd format compiles there too. Its
  `#5029` pin ("a MISSPELLED format name is published, not refused") passes
  verbatim. Two questions, two rules — "does ajv accept this schema?" and "will
  this `format` keyword do anything?" — sharing one traversal and one ajv
  environment so they can never disagree about which rules exist or what
  "registered" means.

  `ajv` / `ajv-formats` stay **lazy**, and this rule is lazier than its neighbour:
  the registered vocabulary is only fetched once a schema actually names a
  `format`, so a `json_schema` rule that names none loads neither package. Pinned
  by the package's `lazy-deps.test.ts` in all three of its layers.

  **Upgrading:** if `os validate` / `os build` / `os lint` newly rejects a
  `json_schema` validation rule, the format name in it was never being enforced —
  fix the spelling to the name the finding suggests, or express the constraint
  with `pattern`, which is enforced. No metadata that was working changes
  behaviour.

- 461ccda: fix(lint): 收敛 `validateStackExpressions` / `validateSecurityPosture` 里读 spec 不声明键的 `??` 别名链 (#5017)

  两条规则都以 `input: 'parsed'` 注册,看到的是 `ObjectStackSchema` 解析后的产物。
  #4984 → #5009 清掉了 sharing rule 字段层和 org-axis 规则里的同形读法;这一轮是同族
  第三轮,落在另外两个文件。议题点名五条,全包 grep 又找出同形的两条,一并处置:

  | 原读法                                                                      | spec 事实                                                                                           | 处置                           |
  | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- | :----------------------------- |
  | `rule.expression ?? rule.predicate ?? rule.condition ?? rule.formula`(两处) | 四个别名全是 `validation.zod.ts` 的 `aliases: { …: 'condition' }` **按名拒绝**的键;canonical 排第三 | 收敛为 `rule.condition`        |
  | `obj.validations ?? obj.validationRules`                                    | `ObjectSchema` 只声明 `validations`,strict 按名拒绝                                                 | 收敛为 `obj.validations`       |
  | `rule.condition ?? rule.criteria ?? rule.predicate`                         | `criteria` 是运行时编译产物 `criteria_json` 的拼法(#3896),`predicate` 直接拒绝                      | 收敛为 `sharingRule.condition` |
  | `def.reference ?? def.referenceTo`                                          | `field.zod.ts:331` 把 `referenceTo` 映射为 `reference`                                              | 收敛为 `def.reference`         |
  | `action.objectName ?? action.object`                                        | canonical 是 `objectName`;`object` 按名拒绝                                                         | 收敛为 `action.objectName`     |
  | `obj.sharingModel ?? (obj.security)?.sharingModel`                          | **`ObjectSchema` 根本没有 `security` 键** —— OWD 三个拨盘是平铺的,且 strict:嵌套写法被整包拒绝      | **删除整个 fallback**          |
  | `def.reference ?? def.reference_to`                                         | 同 `referenceTo`                                                                                    | 收敛为 `def.reference`         |

  对任何能解析的 stack,判定结果不变 —— 三个 example(crm / showcase / todo)与平台
  default permission sets 上,改动前后两条规则的 findings 逐字相同。

  **其中一条不是死代码,是活着的错。** `rule.expression ?? … ?? rule.condition ?? …`
  把 canonical 的 `condition` 排在两个被拒别名之后,所以一条同时写了 `condition` 和
  `expression` 的规则,lint 校验的是 schema 会拒绝的那个,而作者声明的那个**从头到尾
  没被看过**:producer 和 consumer 对同一份元数据给出两套说法。测试里重建了旧链来演示
  这个差异,而不是只描述它。

  真正的代价从来不是漏报,而是误导 —— `object.security.sharingModel` 出现在**安全
  linter**里,足以让下一位作者(人或 AI)相信对象级 `security` 信封是真实的授权面。

  同时补上两层结构性 meta-guard(#4992 模式,#5018 形状),让下一条死读法在 review
  前就红:

  - **declared-key guard** —— 规则源码里从每个 surface 上读的键,必须出现在该 surface
    自己的 Zod `.shape` 里。扫源码不是扫行为是刻意的:不可达分支没有行为可断言。
  - **reachability guard** —— `validateSecurityPosture` 全部 15 个 `findings.push`
    落点都必须被一条 schema **不报 `unrecognized_keys`** 的 fixture 触达。判据不是
    #5018 的 `safeParse` 全绿,而这正是这条规则的特点:它被文档明确设计为也跑在
    parse 前,好让 `os lint` 对 zod 会拒绝的**值**(`sharingModel: 'read'`)给出更
    好的信息。被拒的**值**和被拒的**键**是两回事 —— 后者在 parsed 路径上压根到不了。

  七条读法各自做过变异测试:任意一条加回去,都至少有一条测试转红。

- 58f3220: null-guard 闸门改走 `@objectstack/formula` 的规范解析入口,并移除对 `@marcbachmann/cel-js`
  的直接依赖(#4812)。

  `validate-null-guards.ts` 此前自建了一个**不带 limits** 的 cel-js `Environment`,于是它会解析、
  并进而判定平台自身拒绝的谓词 —— 超过 `maxAstNodes` (256) / `maxDepth` (32) /
  `maxListElements` (64) 的表达式在 lint 侧照常出 finding,在 `compile()` 侧却是
  `Exceeded max…`。两个解析入口,两个答案,而这个闸门握着更宽松的那个。

  改走 `parseCelToAst` 后两者合一。超界表达式不再由本闸门二次判定,而是交还给同一批调用点上
  本就在跑的 `validateExpression` —— 它以 blocking error 报告边界错误,措辞面向自纠;作者修好
  边界问题后,null-guard 判定自然回来。规则判定本身没有变化:#3306 的三元重写对本 pass 是
  verdict-neutral(重写仅在三元的某一支恰为 `null` 字面量时触发,而该支本就证明不出任何
  guard),已加测试钉住。

- f238970: fix(lint): 收敛 `validateRuleCompilability` 里读 spec 不声明键的 `??` 别名链 (#5096)

  #4984 → #5009 → #5017/PR #5046 同族第八处,落在第三个文件
  (`validate-rule-compilability.ts:239`):

  | 原读法                                   | spec 事实(对 live `.shape` + `safeParse` 实测)                                                                                                                                                                  | 处置                     |
  | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------- |
  | `obj.validations ?? obj.validationRules` | `ObjectSchema.shape` 只声明 `validations`,且 strict —— `validationRules` 被**按名拒绝**:`Unrecognized key(s) on this object: \`validationRules\`. … Did you mean \`validationRules\` → \`validations\`?`(#4001) | 收敛为 `obj.validations` |

  该规则以 `input: 'parsed'` 注册,canonical 排首位,所以别名 limb 对任何能解析的
  stack 都不可达 —— 三个 example(crm / showcase / todo,共 28 个对象、17 条验证规则)
  上改动前后 findings **逐字相同**(两侧均 0 条)。

  **代价从来不是漏报,而是误导。** 一个写在 consumer 里的别名 fallback,等于向后来的
  读者、以及照着这份源码写元数据的 AI 宣称 `objects[].validationRules` 是一个真实的
  authoring 面;它把 schema 一句指名道姓的拒绝,降级成一条静默失效的分支。别名容忍属于
  producer 的拒绝面,不属于 consumer(Prime Directive #12)。

  同时给本文件补上两层结构性 meta-guard(#4992 模式,#5017 形状),让下一条死读法在
  review 前就红:

  - **declared-key guard** —— 规则源码里从 `stack` / `obj` / `rule` 上读的每个键,必须
    出现在对应 surface 自己的 Zod `.shape` 里,且 `expected` 精确匹配;另加一条 "covers
    every receiver" 元测试,以及一条针对 `flattenRules` 里 `rule[branch]` **计算属性**
    读法的专项断言(点号扫描看不见它,而 `then` / `otherwise` 恰是本规则最有意思的读法)。
  - **reachability guard** —— 两个 `findings.push` 落点都必须被一条 `ObjectStackSchema`
    **完整 parse 通过**的 fixture 触达。这里用的是 #5018 的 `safeParse` 全绿判据,比
    `validate-security-posture` 只能要求"不报 `unrecognized_keys`"更严一档 —— 因为本规则
    判的是"编译不过",而在 spec 眼里 `regex` 是任意字符串、`schema` 是任意 record,编不过
    的产物依然完全 spec 合法:这条 gate 存在的理由正是 zod 看不见该缺陷,所以它永远不需要
    一条 zod 会拒绝的 fixture。

  原测试 `reads \`validationRules\` too` 断言的正是被删掉的那条 limb,实测确实产出 1 条
  finding(不是空转),因此它被**替换**而不是改拼写:把 key 换成 canonical 只会留下一条
  主题已不存在的绿测试。变异测试:别名 limb 加回去 → 2 条红;改成纯别名读 → 11 条红。

- 06fc07a: `os validate` now reports a `config.timeRelative` that is not a descriptor object

  A flow start node whose `config.timeRelative` held a scalar — `timeRelative: 'daily'`
  is the natural mistake, from fusing the sweep's **cadence** with its **descriptor** —
  was accepted in complete silence at every layer. The node `config` slot is open by
  design (ADR-0018) so the schema parsed it; the engine routes a flow to the
  time-relative sweep only when `config.timeRelative` is an object, so the flow fell
  through that branch and, with no other trigger key on the node, bound to nothing and
  never fired. Not one diagnostic was produced anywhere — not even the single bind-time
  warn that an object-but-unparseable descriptor gets, because the trigger was never
  handed the flow at all.

  A new authoring rule, `flow-time-relative-descriptor-unroutable` (warning), reports it
  at authoring time with the value, its type, and the consequence — and a hint that
  separates the two fused concepts: the descriptor says WHICH records to sweep
  (`{ object, dateField, and exactly one of withinDays | offsetDays }`), while HOW OFTEN
  is the sibling key `config.schedule`.

  Nothing is made tolerant: a scalar is still not a descriptor and the runtime's
  behaviour is unchanged. The rule is a separate criterion from
  `flow-time-relative-descriptor-invalid` (#5496) rather than a widening of it, and the
  two partition the key along the engine's own routing predicate — a value the engine
  routes gets the schema's verdict, a value it routes nowhere gets this one, and never
  both. Arrays and `Date` are `typeof 'object'`, so they stay with the shape rule.

- 61fde5e: lint: warn when a form section declares a `label` but no `name` — the heading no translation key can ever address

  `_sections` is keyed by the section's `name`, and every renderer that draws a
  section heading resolves it that way (`sectionLabel(objectName, section.name,
authored)` — `plugin-form`'s `ObjectForm`/`ModalForm`, `plugin-detail`'s
  `record:details`), falling back to the authored label when there is no name.
  So a section authored with a `label` and no `name` is untranslatable **by
  construction**, and every gate we own was structurally blind to it:

  - the reference validator reports keys a bundle carries that nothing declares —
    a nameless section produces no key, so there is no orphan to report;
  - the i18n coverage walk (#5405) emits one expected key per `sections[].name` —
    a section with no name contributes nothing to demand, so the report reads
    100% while the heading renders in the source locale in every locale.

  Measured on HotCRM: **70 of 70** form-view sections across all 14 view files are
  in exactly that state, with four locales at full declared coverage and zero
  warnings anywhere. It is also the real cause of the reported `Case / SLA /
Resolution` English strip — that object's _detail page_ sections carry names and
  translate, while its _form view_ sections carry none.

  `validateTranslatableSections` (rule id `translation-section-name-missing`) joins
  the reference-integrity suite, so it runs on `os validate`, `os lint` and
  `os compile` at once. It reads exactly the anchors the two landed halves already
  agree on: a view container's `sections`, its **default** `form.sections`, every
  `listViews.*` / `formViews.*` sub-container, the same three on views embedded in
  an object, and `record:details` sections nested anywhere in a page's component
  tree. `fieldGroups`-derived sections are out of range by construction — their
  heading is keyed by `fieldGroups[].key`, so they always have a name.

  **Warning, and opt-in.** Nothing crashes and nothing is dead — one heading stays
  in the source locale — so the severity matches its sibling rules (ADR-0072 D1)
  and nothing that passed before starts failing. `os validate` over
  `examples/app-showcase` now reports 14 of these (6 from form views, 8 from
  `record:details` pages) and still exits 0. A section warns only when the
  object it renders under carries some translation of its own, which keeps the
  monolingual case silent exactly as the coverage gate already does.

  The fix is a diagnostic at the **producer**, deliberately not tolerance at the
  consumer: deriving a lookup key by slugifying the label would fossilize a second
  de-facto contract next to the declared one, and would move the day anyone edits
  the heading text. The `name` the hint suggests is a suggestion for the author to
  write down, never a key anything resolves.

- 471839d: fix(spec): classify the 22 dashboard widget keys and refuse undeclared container inheritance (#4956)

  The spec liveness ledger's `dashboard.widgets` entry carried one blanket `live`
  verdict plus a `note` asserting that the per-widget props were _"classified in
  the DashboardWidgetSchema subtree"_. **No such subtree ever existed.** The gate's
  walk drills one level and only through an explicit `children`, and `widgets`
  declared none — so all 22 authorable keys of the strict `DashboardWidgetSchema`
  were never classified, never counted as unclassified, and every run printed
  "all governed-type properties are classified" anyway.

  That gap — not evidence — is what carried `widgets[].responsive` through the
  #3896 inert-key sweep that removed both its sibling `widgets[].performance` and
  its literal namesake `view.responsive`. `view` is drilled through `children`, so
  `list.responsive` got asked and went out; `widgets` was never asked. It was
  finally retired in #4876 / PR #4995, by hand, four days late.

  **What changed for authors**

  The `objectstack build` / `objectstack lint` advisory now covers dashboards, so
  five widget keys warn at build time (they never did before — `dashboard` was not
  in the lint's type collections, because until now its ledger warned on nothing):

  | Widget key               | Why it warns                                                                                                                   | What to do instead                                                                                               |
  | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
  | `widgets[].colorVariant` | no render path reads the top-level key — only the authoring panels do                                                          | move it under `options` (the inline metric card reads it there); the dataset-bound path has no colour affordance |
  | `widgets[].actionUrl`    | no renderer draws a per-widget action button; every `actionUrl` the dashboard renderer reads belongs to `header.actions[]`     | use `dashboard.header.actions[]`                                                                                 |
  | `widgets[].actionType`   | pairs with the above                                                                                                           | as above                                                                                                         |
  | `widgets[].actionIcon`   | zero readers in either repo                                                                                                    | as above                                                                                                         |
  | `widgets[].aria`         | declared ARIA attributes never reach the DOM — the same false-compliance shape as the dashboard-level `aria` removed in 17.0.0 | delete it; the renderer emits its own `aria-*`                                                                   |

  Advisory only — the build never fails on these. **Nothing is removed and no
  runtime behaviour changes**: this records verdicts, it does not act on them.
  Enforce-or-remove (ADR-0049) for the five is tracked separately.

  Two verdicts worth knowing because they cut the other way: `requiresService` is
  **live** — it reads as inert in the renderer repo but the REST layer strips
  widgets whose service is unregistered (ADR-0057 D10) — and `compareTo` is live
  on the inline chart path only; on the ADR-0021 dataset path the string arms are
  dropped and `{ offset }` fails in the analytics executor.

  **What changed for the gate**

  `pnpm --filter @objectstack/spec check:liveness` gains a third direction. A
  ledger entry sitting on a container property must now declare one of exactly
  three dispositions, all of them data: **drilled** (`children`), **deferred** (a
  `{ container, to }` row naming the coordinate that does classify the subtree),
  or **recorded** (a row in the shrink-only
  `scripts/liveness/undrilled-containers.baseline.json`). A container in none of
  the three fails, and so does a baseline row whose container has since been
  drilled.

  A deferral is **resolved, not believed** — the target must exist (a governed
  type root, or a drilled `type/prop` coordinate) and classify exactly the
  container's child keys; a dangling or drifted target fails. That is the #4956
  claim itself, made checkable: pointing a deferral at `DashboardWidgetSchema`
  now produces a build failure naming it, where the same words in a `note` were
  believed for a release.

  Every run reports both populations (today: 58 containers / 292 child keys
  classified nowhere, plus 6 resolved deferrals covering 248), `--undrilled`
  prints the worklist, and the success line no longer claims a completeness it
  does not have.

- b821b29: fix(lint): 清除 `validateOrgAxisRedLines` 里 spec 合法 stack 永远到不了的四条分支 (#5009)

  `validate-org-axis-red-lines.ts` 是 `input: 'parsed'` 规则 —— 它看到的是
  `ObjectStackSchema` 解析后的产物。#4984 修掉了 sharing rule 字段那一层的 `??`
  别名读法,但同一文件里还留着四条同形分支,每一条读的键 spec 都不声明:

  | 原读法                                                          | spec 事实                                                                                                                                              | 处置                      |
  | :-------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------ |
  | `cfg.permissions ?? cfg.permissionSets`                         | stack 根 **strip** 未声明键,`permissionSets` 解析后必为 `undefined`                                                                                    | 收敛为 `cfg.permissions`  |
  | `cfg.sharingRules ?? cfg.sharing`(两处)                         | 同上                                                                                                                                                   | 收敛为 `cfg.sharingRules` |
  | `str(rule.object ?? rule.objectName)`                           | `SharingRuleSchema` 是 `.strict()`,按名拒绝 `objectName`;`object` 又是必填                                                                             | 收敛为 `rule.object`      |
  | `asArray(object.rowLevelSecurity ?? object.rls)` 整段(约 20 行) | **`ObjectSchema` 两个键都不声明**,且 `.strict()` —— 带对象级 RLS 的 stack 在 `os validate` / `os build` 直接被拒("Unrecognized key(s) on this object") | **删除**                  |

  对任何 spec 合法的 stack,判定结果不变:这些分支本来就永远不执行(反向验证 ——
  新测试跑在改动前的实现上,29 条由 `safeParse` fixture 驱动的断言全绿)。真正的
  代价从来不是漏报,而是误导:对象级 RLS **根本不是授权面**(`authorable-surface.json`
  里只有 `security/PermissionSet:rowLevelSecurity` 一条),而那段死代码连
  `objects[N].rowLevelSecurity[M].using` 的诊断 path 都写好了,足以让下一位作者
  (人或 AI)相信它是真的并照着写更多代码 —— #5008 差点就这么做了。

  行为上唯一的差别落在 `os lint`(不 parse,跑 normalized 层):把别名拼法写进
  stack 的作者,不再从这条红线拿到诊断,而是从 schema 那里拿到一条指名道姓的
  拒绝。别名容忍属于 producer 的拒绝,不属于 consumer(Prime Directive #12)。

  同时补上一层结构性 meta-guard(#4992 模式),让下一条死分支在 review 前就红:

  - **declared-key guard** —— 规则源码里从 stack / permission set / RLS policy /
    object / sharing rule 上读的每一个键,都必须出现在对应 schema 自己的 `.shape`
    里。扫源码而不是扫行为是刻意的:不可达分支根本没有行为可断言。
  - **reachability guard** —— 每个 `findings.push` 调用点都必须被至少一条过
    `safeParse` 的 fixture 触达;走不到的分支不允许存在。
  - 规则 ① 的 fixture 现在也走 `PermissionSetSchema.safeParse`(此前只有 sharing
    rule 和 object fixture 有这层保护)。

  四条分支各自被变异测试验证过:把任意一条加回去,都至少有两条测试转红。

- da1a64c: fix(lint): reject a validation rule whose regex or JSON Schema does not compile, at authoring time (#4762)

  Two of the six object validation-rule types carry a **static artifact** that the
  write path hands to a real compiler, inside a `try/catch` that logs and returns
  `null`:

  - `format` → `new RegExp(rule.regex)` → _"Validation rule '…' has an invalid regex — skipped"_
  - `json_schema` → `ajv.compile(rule.schema)` → _"Validation rule '…' has an uncompilable JSON Schema — skipped"_

  "Skipped" means the rule is declared, appears in the metadata, appears in every
  "what protects this object" listing — and enforces nothing, on every record, for
  as long as the metadata is deployed, with a WARN line in a log nobody reads as
  the only signal. That is the shape #4649 was filed about one rule type over;
  #4761 flipped the CEL predicates to fail closed and deliberately left these two,
  because their blast radius differs (see below).

  **New gate — `validateRuleCompilability`**, a `gating` entry in
  `AUTHORING_RULES`, so it runs on all three authoring commands (`os validate`,
  `os build`, `os lint`) with no per-command wiring. Two rule ids:

  | id                                         | fires when                                                   |
  | :----------------------------------------- | :----------------------------------------------------------- |
  | `validation-rule-regex-uncompilable`       | a `format` rule's `regex` throws in `new RegExp(...)`        |
  | `validation-rule-json-schema-uncompilable` | a `json_schema` rule's `schema` throws in `ajv.compile(...)` |

  Each finding names the rule, the object and the config path, and carries the
  **compiler's own error text verbatim** — an author cannot act on "invalid
  regex", but can act on `Invalid regular expression: /([/: Unterminated character
class`. Rules nested in a `conditional`'s `then` / `otherwise` are judged too
  (`evaluateRule` recurses into them and reaches the very same checkers), and the
  finding names the branch it is in.

  **Detection is the real compilers, never a pattern that judges a pattern.** The
  regex is compiled with `new RegExp(source)` — the exact call `checkFormat`
  makes. The schema is compiled with ajv constructed with the **same options the
  runtime's shared instance uses** (`{ allErrors: true, strict: false }`), read
  back out of `rule-validator.ts`'s source by a parity test so the day those
  options change, this gate is told rather than left quietly disagreeing.
  `strict: false` is load-bearing in both directions: a gate running `strict: true`
  would reject author-written schemas carrying vendor keywords that the write path
  compiles happily — a gate that turns working metadata red gets switched off, and
  then protects nothing.

  `ajv` is a new dependency of `@objectstack/lint`, loaded **lazily**: only a
  stack that actually declares a `json_schema` validation rule pays for it, pinned
  by the package's `lazy-deps.test.ts` alongside `typescript` and `sucrase`. The
  kernel boot path (`@objectstack/lint/runtime`) never loads it at all.

  **The runtime half is deliberately unchanged.** `rule-validator.ts` still fails
  open on both, and the `#4649 — unchanged neighbours` pins that record it stand
  exactly as they are. A broken regex or schema is _static_ — decidable from the
  metadata alone, with no record in hand — so the authoring door closes the class
  outright without ever bricking a running deployment, whereas rejecting at write
  time would reject **every** write touching that field for as long as the bad
  metadata is deployed. Whether a runtime backstop is still wanted on top of a
  closed authoring door stays open on #4762.

- 5e3c83b: fix(lint): 七个规则 id 常量补进 barrel —— 消费者不必再对字面量,并加一条测试面门禁 (#5648)

  规则把自己的 id 写进每条 finding 的 `f.rule`,而那个字符串就是 `os lint --json` / `os validate` 递到消费者手上的东西:Studio 的 finding 渲染、下游按规则过滤/抑制、以及被授权元数据里的 `suppressWarnings: ['<rule-id>']`。规则文件为此导出同名常量,消费者本该比对常量而不是重敲 slug。

  但 `packages/lint` 的 `package.json#exports` 只开 `"."` 与 `"./runtime"`(`tsup.config.ts` 的 entry 也只有这两个),所以**没进 barrel 就不是「不好取」,而是完全取不到** —— 没有深路径可绕,消费者唯一的退路正是那个常量本来要消灭的字符串字面量。

  #5648 报的是其中一个(`FLOW_TRIGGER_UNKNOWN_EVENT`,#3427/#3457/#3481 三条规则共用的 id)。它要求的全量清查又翻出**六个**,散在五个规则文件、成因都远早于它:`APPROVAL_APPROVER_TYPE_UNSUPPORTED`、`SECURITY_FLS_UNQUALIFIED_KEY`、`FIELD_GROUP_SHADOWED`、`WIDGET_LEGACY_ANALYTICS_SHAPE`、`WIDGET_LEGACY_ANALYTICS_UNRENDERABLE`、`REACT_CHART_DRILLDOWN_INVALID`。其中 `WIDGET_LEGACY_ANALYTICS_SHAPE` 最能说明代价:规则打给用户的提示原话就是 `Suppress with suppressWarnings: ['widget-legacy-analytics-shape']`,即它主动教消费者用这个 id,却不让消费者拿到承载它的常量。

  漏项之所以能一路静默:规则照常工作,它自己的单测**从规则文件直接 import 常量**(不经 barrel),于是唯一会发现的时刻是有人从包外去消费它。同一种一行漏项独立发生七次,不是「下次记牢」能解决的记性问题,而是缺一条判定。

  **因此判定权移进 `packages/lint` 测试面**(`src/rule-id-barrel-exports.test.ts`):新增规则时忘了 barrel 那行,会在新规则自己的测试转绿的同一次 run 里失败。分层理由是这条不变量完全是包内的 —— 没有别处定义 lint 规则 id —— 且它要**真的 import** barrel 来核验取值,vitest 天然给得到;换成 `scripts/` 门禁则要么自己写一个 ES 解析器,要么先构建 dist,还会把反馈挪到另一个 job。

  门禁按两类假绿反向设计:发现面是对 `src/` 的**文件系统读取**而非手写清单(新规则文件一存在即被枚举),并对 id 条数压一条下限,避免将来改坏提取式后在空集上「全绿」;两个 entry 虽是静态列出(全动态 import 无法可靠打包),但另有一条用例从 `package.json#exports` 与 `tsup.config.ts` **各自独立**推导出同一集合并比对,新增第三个 entry 若不登记就会红,而不是悄悄不被检查。

  分类按**取值形状**而非发射位置判定:早先一版靠「定义旁边有 `rule: NAME`」来认,结果漏掉了经辅助函数参数发射的四个 `REACT_CHART_*` —— 恰好包含本次真实漏项之一。

  仅新增导出面,无行为变化:任何既有 `f.rule` 字符串都没有改动,原先对字面量的消费者继续可用。

- 20963e7: fix(lint): `translation-target-unknown` reads a view container's DEFAULT `form.sections` (#5415)

  `validate-translation-references` derives the `_sections` names an object may
  legally be translated by from a list of anchors: `fieldGroups[].key`, the named
  sections on `listViews.*` / `formViews.*`, the named sections on a page's
  `record:details` component, and the view record's own `sections`. The list was
  missing one: the view CONTAINER's **default form** — the `form` that
  `defineView({ list, form, formViews })` declares and that `ObjectForm` renders
  when no named form view is asked for.

  `collectViewRecord` iterated `['listViews', 'formViews']`, and `view.form` is
  neither of those nor the record's own `sections`, so `view.form.sections[].name`
  contributed **nothing** to the fact set. The renderer resolves those headings
  through exactly the same `sectionLabel(object, section.name, …)` convention as
  any named form view, so a bundle that correctly translated one of them was
  reported as keyed to a section "which nothing on object X declares", with a hint
  advising the author to delete a translation that renders. On the in-repo
  showcase contact surface — whose object declares `field.group` and no
  `fieldGroups[]`, so the default form is its **only** section anchor — all four
  headings were in that state, and the hint went as far as "declares no named
  section at all".

  The default form now feeds the same section collector as `formViews.*`, bound
  by `bindingOf(view.form) ?? listBinding` — i.e. `form.data.object` first, then
  the record-level object, then the list beside it — which is the resolution the
  CLI i18n walker performs for the same surface, so the rule that DEMANDS a key
  and the rule that ACCEPTS one agree on which object a heading belongs to. Each
  anchor is now a call into one collector rather than its own copy of the loop.

  Nothing tightens: an unnamed section is still untranslatable (it has no stable
  key to look up), and a `_sections` key no anchor declares is still reported —
  now with the real anchors enumerated in the hint.

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
- Updated dependencies [0f17114]
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
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
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
- Updated dependencies [bf1edef]
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
  - @objectstack/formula@17.0.0-rc.4
  - @objectstack/sdui-parser@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 430dcc2: fix(runtime,lint): `action.body` binds a handler only for `type: 'script'` (#4352)

  `ActionSchema.body` has always described itself as "Only used when type is
  `script`", and its JSDoc went further — "Only meaningful when
  `type === 'script'`. When set, the runtime invokes the body inside the sandbox
  … and ignores `target`." The runtime read none of it:
  `actionBodyRunnerFactory` bound a handler the moment `body` parsed, and
  `collectBundleActions` collected any named action. A `type: 'url'` action
  carrying a leftover `body` was therefore registered in the action registry and
  executed in the sandbox — reachable through
  `POST /api/v1/actions/:object/:action` and through
  `ql.object(o).execute(name)`, and counted by the governance inventory as a live
  handler.

  Declared ≠ enforced, in the shape that is hardest to debug: an author flips
  `type` from `script` to `url`, reasonably concludes the body is now dead code,
  and it keeps running with nothing anywhere saying so.

  **Behaviour change.** `body` now runs only under `type: 'script'`:

  | Action                                                         | Before    | After                                                  |
  | :------------------------------------------------------------- | :-------- | :----------------------------------------------------- |
  | `type: 'script'` + `body`                                      | body runs | unchanged — body runs                                  |
  | `type` omitted + `body`                                        | body runs | unchanged — body runs (`ActionType.default('script')`) |
  | `type: 'url' \| 'modal' \| 'flow' \| 'api' \| 'form'` + `body` | body ran  | **no handler is bound**; the refusal is logged         |

  Only an action that **explicitly** declares a non-`script` type _and_ carries a
  `body` changes behaviour. An omitted `type` still means `script`, because the
  collectors walk raw bundle objects — a `strict: false` `defineStack` or a legacy
  `manifest.actions[]` never passes through `ActionSchema`, so the schema's own
  default has to be applied at the gate rather than assumed to have been applied
  already.

  **FROM → TO.** If you have an action whose body you want to keep running, set
  `type: 'script'` and move the navigation/dispatch target elsewhere; if you want
  the target behaviour, delete the now-inert `body`:

  ```diff
    {
      name: 'open_portal',
  -   type: 'url',
  +   type: 'script',
      target: '/portal',
      body: { language: 'js', source: "await ctx.api.object('lead').update(…)", capabilities: ['api.write'] },
    }
  ```

  The refusal is **not** silent — silence would only relocate the invisibility the
  issue is about. `actionBodyRunnerFactory` logs a warning naming the action, its
  declared `type`, and both fixes.

  Authoring-time rejection of the same contradiction already shipped in #4438
  (`ActionSchema` rejects `body` alongside a non-`script` `type`), so what remains
  reachable here is data at rest published before that gate existed, plus bundles
  that never parsed. This release closes that half. New tests also pin that the
  **publish gate resolves to the rejecting schema** — through
  `getMetadataTypeSchema('action')` and `ObjectSchema.actions` — so a re-point of
  either registration cannot silently reopen the hole while the schema's own unit
  tests stay green.

  `@objectstack/lint`'s `validate-action-body-writes` filters by `type` again.
  #4344 deliberately made that rule type-blind on the grounds that "the runtime
  binds a handler from `action.body` alone … checking what executes beats checking
  what the schema says should" — true then, and the comment predicted its own
  revision. Execution and declaration are the same set again, so a non-`script`
  body no longer produces write-set advice about writes that provably never
  happen; the publish gate names that metadata's real defect (`type`) with its own
  prescription.

  `collectBundleActions` stays deliberately type-blind: it feeds governance
  surfaces that must enumerate every declared action, bound or not, and the other
  bind path (`engine.setDefaultActionRunner`, for Studio-authored actions) never
  walks it. The gate lives at the single point where a `body` becomes an
  executable handler, so there is no second copy of the rule to drift.

- 0800433: Lint an action nobody placed (ADR-0078 Phase 3, Tier-A `action-locations`).

  New advisory rule `action-no-placement`: an action that declares no
  `locations` and that no list view places by name renders on **no** surface —
  it parses, publishes, and appears in Setup, while no user can ever click it.
  ADR-0078 names this shape in its opening paragraph and Phase 3 asks for
  exactly this rule; the shared completeness predicate it envisioned was never
  built, so this lands standalone, one verified shape at a time.

  What made it verifiable now: objectui#3142 collapsed four disagreeing
  renderers onto one placement predicate. Before that, `action:bar` and the
  record header rendered an _undeclared_ action anyway, so the shape only looked
  inert on paper. As of objectui 17.1 it is measurably inert.

  Two things are deliberately **not** flagged:

  - **`locations: []`** — the documented headless action (callable over REST /
    MCP / AI, no UI surface). ADR-0110 D3 refuses an undeclared handler, so a
    headless declaration is the only legal way to expose one. The rule therefore
    distinguishes "nowhere, deliberately" (`[]`) from an unstated placement (key
    absent) and only reports the latter.
  - **Actions a view places by name** — `bulkActions`, `bulkActionDefs`
    (including `execution: 'aggregate'` defs, whose whole point is an action with
    no single-record home) and `rowActions`, across all three list-view tiers:
    `views[i].list`, `views[i].listViews.<key>` and the object-embedded
    `objects[i].listViews.<key>`.

  Advisory, never fatal — a view in another installed package may be the one
  placing the action, the same reason `validateSemanticRoles` and
  `lintLivenessProperties` warn rather than gate.

  Also: the action form schema in `@objectstack/metadata-protocol` no longer
  declares `shortcut` / `bulkEnabled`. Both were retired as `retiredKey()`
  tombstones in spec 17, and this schema is what the Studio designer renders its
  fallback form from — so advertising them handed authors two inputs that could
  only ever produce an unsaveable draft (objectui#3145 removed the matching
  dedicated controls). And `content/docs/ui/actions.mdx` now says which surface
  is the exception to location filtering, instead of a blanket claim its own
  showcase contradicted.

- 85a966f: Nav targets that are not object names (`page` / `report` / `dashboard`) are now checked at author time — closing a hole _inside_ an existing check.

  `defineStack`'s `validateCrossReferences` already validates these three. But each arm is gated on the collection being non-empty:

  ```ts
  if (nav.type === 'page' && typeof nav.pageName === 'string'
      && pageNames.size > 0 && !pageNames.has(nav.pageName)) { … }
  ```

  So a stack that declares **no `pages` at all** has its page-nav check silently switched off, and `{ type: 'page', pageName: 'anything' }` sails through. That is exactly the state a stack is in when the target was never written — the most likely way to reach this bug, not the least.

  Note the asymmetry the guard creates. The `object` arm of the same block has no size gate: it errors unless the item carries `requiresObject`, an **explicit** opt-in to "another package provides this". Objects have to say so out loud; pages, reports and dashboards got an implicit exemption that depends on an unrelated property of the stack.

  `validateNavTargetRefs` joins `REFERENCE_INTEGRITY_RULES` (16 → 17), so it runs on `validate`, `lint` and `compile` with no CLI rewiring. It reports **warning**, not error, and that ceiling is deliberate: `validate-object-references` can say ERROR for an unresolved _object_ because it resolves against the curated `PLATFORM_PROVIDED_OBJECT_NAMES` registry and knows which cross-package names are real. No such registry exists for pages, reports or dashboards, so "unresolved" cannot honestly be distinguished from "provided by a package we cannot see". Fixing the guard by tightening the parse-time throw was the other option and was rejected: a throw has no escape hatch for a legitimately cross-package page, and ADR-0072 D1's rule is that one dead finding costs more than a missed one. When `defineStack`'s check _is_ live it still hard-fails first; this rule is what speaks when that check has switched itself off, and it says so in the message.

  **Three nav types are deliberately NOT covered, each verified rather than assumed:**

  - **`action`** — already owned by `validate-action-name-refs`, which walks app navigation explicitly. Adding it here would double-report.
  - **`component`** — a verified NON-rule. An unregistered `componentRef` does _not_ fail silently: `ComponentNavView` renders a named diagnostic ("Component not registered … Ensure the plugin that provides this surface is installed and has called `registerAppComponent()`"), and the registry exists precisely so plugin-provided surfaces may legitimately be absent. Flagging it would break valid plugin nav and prescribe a fix for something already reported better at runtime.
  - **`url`** — external by definition.

  Both NON-rules are pinned by tests, so "completing" the module by adding them fails there first.

  **Scope honesty:** all 35 authored nav page/report/dashboard targets in this repo resolve, so this closes a latent hole rather than a shipped bug. The rule was proven to go red and then green through the real `validateReferenceIntegrity` entry point on a known-bad stack, not only in unit tests — a green check that has never been made to fail is the recurring defect this campaign keeps finding in its own instruments.

- a7163ea: The ADR-0078 completeness gate ships: a Zod-valid metadata instance that silently does nothing now fails at author time, on every authoring surface.

  This closes the hole _between_ the platform's existing gates. An instance can be Zod-valid (gate 1 green), use only _live_ properties (gate 2 green), and a correctly-authored sibling can be proven to run (gate 3 green) — and still be dead, because it omits a config its consumer needs and the consumer silently no-ops. The founding case (cloud#687): an AI authored `{ type: 'summary' }` with no `summaryOperations`; the engine's index builder skips it, the field reads 0 forever, the dependent "occupancy rate" is stuck at 0 — and the agent reported the work done, because every gate it could see was green.

  **Why this is worse than the unknown-key hole #4001 just closed.** There, the author wrote a key we don't know, and the parse now rejects it with a prescription. Here every key is one we know, the schema is satisfied, nothing warns, and the author gets a success. It manufactures false completion without the author mistyping anything — and the review step that catches a human's bare summary (seeing the field render `0`) is exactly the step AI authoring removes.

  **One shared predicate, every surface — the ADR's core decision.** Instance-completeness checks previously existed _only_ in cloud's AI-build graph-lint, so a stack authored with `os` + a coding assistant, an MCP agent, `os validate` in CI, or by hand got none of them (`formula_without_expression` existed nowhere in the framework). The judgement now lives in `@objectstack/spec/kernel`'s `checkFieldCompleteness` / `checkViewCompleteness` — sibling of `isIncoherentAggregate`, the ADR-0019 pattern — consumed by the new `@objectstack/lint` `validate-functional-completeness` and registered as an author-time rule (28 → 29), so `os build` / `os validate` / `os lint` / MCP / hand authoring are all covered. Cloud graph-lint can re-home its duplicate rules onto the same predicate rather than drifting from it.

  **Every rule cites the runtime line that makes it true**, because the completeness audit's scariest candidate — a "sharing rule fails open and shares every record" — collapsed on a three-file read, and #4001's last two batches shipped four confidently wrong prescriptions before learning the same thing:

  | rule                                                          | the silent skip                                                                    | severity |
  | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
  | `field/summary-without-operations`                            | `engine.ts` — `if (!d.summaryOperations) continue`                                 | error    |
  | `field/formula-without-expression`                            | `engine.ts` builds the formula plan only from fields that HAVE one                 | error    |
  | `field/relationship-without-reference`                        | `$expand` — `if (!referenceObject) continue`                                       | error    |
  | `field/choice-without-options` (`select`, `radio`)            | `record-validator.ts` — an empty option list disables server-side value validation | error    |
  | `field/choice-without-options` (`checkboxes`)                 | same branch, but shared with free-form                                             | warning  |
  | `view/layout-without-binding` (`kanban`, `calendar`, `gantt`) | renderer falls back to literal default field names                                 | warning  |

  **The deliberate NON-rules are pinned as hard as the rules.** `multiselect` without options is _not_ flagged: `record-validator.ts` says verbatim `// free-form (tags without options)`. The runtime blesses it as a mode, which makes it ADR-0078 case (3) "genuinely optional" — flagging it would be another false prescription, and the test is where that attempt fails first. `timeline` / `tree` views are likewise out of v1: they have config schemas, but their renderer behaviour has not had its verification pass.

  **It found a real one on its first run against a real app.** `showcase_field_zoo.f_summary` was a bare `Field.summary({ label: 'Roll-up Summary' })` — one line below an `f_formula` that _is_ complete, in the object whose entire job is to show what each field type looks like. So the canonical example of a roll-up in this repo computed nothing. It could not be fixed by adding `summaryOperations`: a roll-up aggregates a child into its parent, and the zoo is a leaf (`f_master_detail` makes it a child of `showcase_project`, and nothing is a child of the zoo). Removed, with the working examples named — `showcase_invoice.total` for the plain sum, `showcase_expense_report.total_amount` / `approved_amount` for the `summaryOperations.filter` variant. The rule it broke was the file's own: "relationship types point at the other showcase objects so they have REAL targets."

  Tracked in #4544. This is Phase 1; Phase 2 (the cloud authoring-path config-drop fix) is in the `cloud` repo, and Phase 3 lands the Tier-B shapes one verification pass at a time.

- e6e9379: ADR-0078 Phase 3: a webhook with no `triggers` now fails at author time — and the Tier-B candidate list is corrected to what verification actually supports.

  **The rule.** `webhook/without-triggers`, error severity, in the shared `@objectstack/spec/kernel` predicate alongside the Phase 1 rules, walked by `@objectstack/lint`'s `validate-functional-completeness` over `stack.webhooks` in both collection spellings. A webhook that declares no trigger materializes into `sys_webhook`, renders in Setup looking armed, and delivers nothing.

  **Why it needed two sources, and why the first one argued against it.** The runtime skip site reads:

  ```
  if (triggers.size === 0) {
      // No dispatchable triggers (or a manual-only webhook with none) —
      // skip auto-enqueue.
      return null;
  ```

  That parenthetical _blesses_ the empty case as a deliberate mode — structurally identical to the `multiselect`-without-options NON-rule, where `record-validator.ts`'s `// free-form (tags without options)` is exactly why we do not flag it. On that evidence alone this candidate stays unenforced.

  The mode it names does not exist. `webhook.zod.ts`'s #3196 note records that the `api` (manual/programmatic fire) trigger was _removed_ because "no manual fire path exists — the only webhook HTTP surface re-queues already-failed deliveries". There is no way to fire a webhook the auto-enqueuer dropped. Inert on every path, so: `error`.

  > **The generalization, now written into the module and pinned by a test:** a runtime comment records what its author believed, and beliefs go stale when a sibling feature is deleted. A blessing has to be corroborated by something showing the blessed mode is still _reachable_ — otherwise it is a comment about a mode that no longer exists. The test asserts the finding carries both citations, so nobody demotes this rule on the strength of the comment alone.

  `triggers: []` is flagged identically to an omitted `triggers`. Unlike an action's `locations: []` — the documented headless spelling — an empty array here carries no "I meant it" signal, because turning a webhook off has its own key (`isActive`). The repo's one real webhook (`showcase_task_changed`) confirms it: shipped inactive via `isActive: false`, with a full trigger list.

  **The corrected Tier-B disposition.** Phase 3 was scoped from the 2026-06 audit's Tier-A/B catalog. Verifying each candidate before writing it — the discipline that caught four false prescriptions in #4001 — found most of the list already closed or misfiled:

  | candidate                                              | disposition                                                                                                                                    |
  | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | A2 action without `locations`                          | **already shipped** — `validate-action-locations.ts`, which already exempts the documented `locations: []`                                     |
  | B approval empty/unresolvable approvers                | **already shipped** — `validate-approval-approvers.ts`                                                                                         |
  | B select/multiselect without options                   | shipped in Phase 1                                                                                                                             |
  | B write-side referential integrity                     | **not an authoring-lint item** — a runtime gap; no metadata omission to detect                                                                 |
  | B `unique:true` no-op on memory driver                 | **not an authoring-lint item** — a driver gap                                                                                                  |
  | B composite/repeater sub-field constraints             | **not an authoring-lint item** — a runtime gap                                                                                                 |
  | B nav targets of type page/report/url/component/action | **genuine gap, different module** — the key is present but dangling, which is reference resolvability (ADR-0072), not completeness (ADR-0078)  |
  | B dataset with zero measures                           | **unverified — not shipped.** No runtime consumer in this repo; the dataset compiler lives elsewhere                                           |
  | B webhook without triggers                             | ✅ **this change**                                                                                                                             |
  | B schedule trigger with invalid cron                   | **unverified — not shipped.** `normalizeSchedule` accepts any non-empty string, but the scheduler's behaviour on an invalid one was not traced |

  Two candidates are deliberately left unshipped rather than written on the audit's stated confidence, and one is left for the module that actually owns it. The audit's own lesson stands: it produces _candidates_, not confirmed bugs — the scariest one collapsed on a three-file read.

  Tracked in #4544.

- 459f925: feat(lint): `has(x)` 不是 null 守卫 —— 发布期直接拒绝未守卫的可空比较 (#4763)

  CEL 的 `has(x)` 问的是**键是否存在**。自 #4649 起,谓词读到的记录对对象声明的每个
  字段都是**全量**的:一个声明了却存 `NULL` 的列同样"存在",所以
  `has(record.end_date)` 对声明字段恒为 `true`,什么也没告诉作者。于是这个读起来
  像守卫的写法根本不是守卫:

  ```text
  has(record.start_date) && has(record.end_date) && record.end_date < record.start_date
  ```

  它会走到 `null < null`,CEL 没有对应重载,整个谓词中断。#4761 之前中断被吞掉
  (规则跳过,一条 WARN),也就是说**这一形状的规则在任何含 null 值的行上从未生效
  过**——它写在元数据里、读起来完全正确、却什么都没有强制执行。#4761 把运行时改成
  fail-closed 之后,当场就在我们自己的两个示例对象里抓到了它。

  运行时拒绝是兜底,不是该学到这件事的地方:作者会在真实数据(很可能是生产数据)
  上收到一个 400,离写下规则可能已经过去几个月。而这个错误**仅凭元数据就可判定**
  ——谓词的 AST 加上对象声明的字段类型,就足以判断某个操作数是否可能为 null。按
  AGENTS.md PD #12(在创作期拒绝,不要在消费端容忍),它属于发布闸门。

  **新增闸门(error,直接拒绝,没有降级开关)。** `os build` / `os validate` /
  `os lint` 与运行时发布闸门共用的 `validateStackExpressions` 现在会拒绝这样的谓词:
  对**声明为可空**的字段(没有 `required: true`、没有 `defaultValue`、没有默认选项、
  不是 autonumber)应用**排序**(`< <= > >=`)或**算术**(`+ - * / %`,含一元 `-`)
  运算符,而该操作数没有被同一布尔分支内支配它的 `!= null` / `== null` / `!isBlank()`
  显式判空所守卫。`has(x)` **刻意不**计入守卫——这正是本规则存在的理由。错误信息点名
  规则、操作数与修法,收尾句逐字取自 `rule-validator.ts` 的 `unevaluableRuleError`,
  两道闸门措辞完全一致。

  覆盖面(有意划定,而不是含糊地覆盖一半):对象**校验规则**(含 `conditional` 规则
  `then` / `otherwise` 里嵌套的谓词)与**生命周期 hook 的 `condition`** ——即真正由 CEL
  在全量记录上求值、会 fail-closed 的两类面。共享规则条件(下推成 SQL 过滤,`NULL > x`
  是三值逻辑,不会 fault)、flow 的扁平作用域条件(裸标识符可能是 flow 变量)与
  `Field.formula`(有自己的 #3306 `guard ? value : null` 处理)不在此列。

  对**未声明**键的 `has()` 完全不受影响——那才是它的正当用途:区分"这次 PATCH 里
  根本没提到这个键"与"显式写了 null"。示例应用无需改动即通过新闸门。

- 8e53e5d: feat(lint): 视图 `searchableFields` 按运行时同一套判定做构建期校验 —— 一个 lookup 笔误不再等到 400 才暴露 (#4830)

  视图(list view)的 `searchableFields` 会被客户端逐字回显为 `$searchFields` 覆盖参数,而
  REST 入口闸(#4254)会用 `resolveSearchFieldResolution`(`@objectstack/spec/data`)判定
  该对象的可搜索集合 —— 声明一个 lookup 等「不可搜索」字段,运行时会把**整条查询** 400
  (`INVALID_FIELD`),列表工具栏搜索对全体角色彻底不可用。此前 `compile`/`validate` 只查
  字段**存在性**,这类笔误全绿放行,只能靠人肉点搜索框发现。

  新增规则 `searchable-field-unsearchable`(error 级,新导出常量同名):对每个视图级
  narrowing(对象内建 `listViews`、`defineView` 的 `list`/`listViews`、react 页面的
  `<ListView searchableFields>`)按**运行时同一个函数**(`resolveSearchFieldResolution`,
  非复制的类型清单,杜绝再度漂移)判定 declared = enforced:

  - 对象未声明 `searchableFields`(auto 源):视图里出现 lookup/json/hidden/审计列等
    auto-default 拒绝的字段 → 构建期 error,信息含类型与 400 后果,lookup 给出「镜像到本
    对象 text/formula 字段」的处方;
  - 对象已声明(declared 源):视图条目超出对象声明集合 → 构建期 error(视图只能收窄、
    不能放宽,ADR-0061);
  - 对象自身的 `searchableFields`(canonical)维持**只查存在性**:运行时 declared 分支按
    存在过滤、不按类型过滤,声明即被引擎执行,构建期拒绝会误伤运行时接受的元数据
    (ADR-0072 D1);
  - 注册表注入的系统列在 narrowing 中跳过判定(其运行时元数据对 linter 不可见,宁可漏报
    不可误报)。

  内部核心 `checkSearchableFieldList` / `indexObjectSearchTargets`(模块级导出,未入包
  barrel)签名有变:索引值从 `Set<string> | null` 变为 `ObjectSearchTarget | null`,并新增
  可选 `role: 'canonical' | 'narrowing'`(默认 `'narrowing'`)参数。

- ebb209c: fix(spec,lint): withdraw the `record:*` blocks from the react tier — no renderer read the props it published (#4413)

  The react-tier contract published `objectName` / `recordId` on
  `<RecordDetails>`, `<RecordHighlights>`, `<RecordRelatedList>` and
  `<RecordPath>`, and no renderer read either prop. All ten `record:*` renderers
  take their record from `useRecordContext()`, which only the record route
  (`RecordDetailView`) and the metadata editor's preview (`PagePreview`) ever
  mount; the `kind:'react'` page renderer wraps the page in a
  `SchemaRendererProvider` alone. So the blocks rendered their "bind a record to
  preview" placeholder — or, for `record:related_list` (the one that does read
  `schema.objectName`), refused to fetch because the parent id never arrived. A
  page authored exactly to contract came back EMPTY with nothing reported
  anywhere, including by `os validate`, which resolved those props' field names
  against the object they named: lint standing guard over a binding that never
  ran.

  Withdrawn rather than implemented. The contract was not merely unimplemented,
  it was the wrong SHAPE: per-block bindings describe four independent fetches of
  one record, which is exactly the coupling the shared record context exists to
  prevent (`record:details` drops the fields a mounted `record:highlights`
  registered; one inline-edit save bar commits them all under a single
  `ifMatch`). Honoring the props would have fossilized that (Prime Directive
  #12). The naming of that primitive — a record SCOPE an author wraps around the
  family, one fetch, shared context — is the open design question, filed as #4444.

  `@objectstack/spec` drops the four blocks from `REACT_BLOCKS` and gains the
  ledger for why, plus the working replacement per type. The family is derived
  from `ComponentPropsMap`, so a record component added later is gated the day it
  lands — including the six that were never in the contract but are just as
  reachable through the registry-built react scope.

  `@objectstack/lint` gains `react-block-needs-record-context` (error), which
  rejects them on a react page by tag and through `<Block type="record:…">`
  alike, quoting the block that does work: `<ListView filters={['<lookup>', '=',
parentId]}>` for a related list, `<ObjectForm mode="view" recordId={…}>` for a
  field panel. A locally-declared component of the same name shadows the injected
  scope and is left alone.

- 4b945fc: Author-time rules now gate the RUNTIME metadata write path, not just the CLI (#4463)

  The 26 author-time rules `os validate` / `os build` / `os lint` share (#4409) ran on
  those three commands and nowhere else. Every runtime metadata write — Studio's
  designer, REST `/meta` item CRUD, an MCP/AI agent authoring a flow — reaches
  `saveMetaItem`, which did a per-type Zod `safeParse` and stopped. For a tenant that
  was not the weakest of four doors, it was the **only** door: a `sys_metadata`
  overlay row is not in the CLI's config file, so there was no command they could run
  instead. An approval flow whose `expression` approver is broken CEL
  (`record.owner ==`) is Zod-valid, so it saved, registered, and failed at the node's
  entry the first time it fired — the exact body `os lint` had rejected since #4409.

  **One shared core, one runtime gate.**

  - The rule registry moved from `packages/cli` into `@objectstack/lint`
    (`AUTHORING_RULES`), and the CLI now calls it there. Five rule modules moved with
    it (`lintFlowPatterns`, `lintLivenessProperties`, `lintAutonumberFormats`,
    `lintViewRefs`, `data-model-rules`), unchanged. There is one table; a second one
    cannot be introduced without failing `authoring-rule-wiring.test.ts`.
  - New kernel-safe subpath export **`@objectstack/lint/runtime`** — the entry the
    metadata write path imports. Running the gate loads neither `typescript` nor
    `sucrase`, pinned by a new `runtime-lazy-deps.test.ts` alongside the existing
    `lazy-deps.test.ts`, which is unchanged.
  - Each registry entry now declares `surfaces` (`cli` / `runtime-publish`) plus
    either the metadata `runtimeTypes` it judges or a written `surfaceReason`. The
    ratchet fails an entry that answers neither.

  **Behaviour**

  - A `state: 'active'` `saveMetaItem` — and the draft→active promotion in
    `publishMetaItem` — of a **flow** runs the flow / approval / expression /
    reference rule families. A gating finding is refused with **422
    `INVALID_METADATA`**, in the same structured envelope the Zod failure already
    used, with `rule` / `path` / `where` / `message` / `hint` per issue.
  - **Draft saves are never gated** — a draft is allowed to be half-finished and
    cannot execute.
  - Only the write is judged: the rules run twice (context with and without the
    submitted item) and only findings the item _added_ can refuse it, so a
    pre-existing violation in a stored row never blocks an unrelated save. Stored
    rows keep being read.
  - Escape hatch **`OS_ALLOW_UNLINTED_METADATA_WRITES=1`** turns the refusal into a
    loud log for a migration window. Unset it once the metadata is fixed — the
    runtime executes what it published.

  Only `flow` writes are gated in this pass; every other metadata type carries a
  recorded reason in the registry.

- 97faca3: feat(spec,lint)!: give `bulkActionDefs` a shape, and lint the aggregate name it references (#4457)

  A selection-bar bulk action was declared as
  `z.array(z.record(z.string(), z.any()))` — **no shape at all**. The real
  contract lived in objectui's `BulkActionDef` interface and in the executor that
  reads it, so every authoring mistake landed as a silent runtime downgrade:
  `opeartion` parsed and the executor hit `Unknown operation: undefined` per row;
  `excution: 'aggregate'` parsed and the def stayed per-record, so the endpoint
  written for ONE `_selectedIds` call got N calls instead — the exact defect
  objectui#3139 was filed to make expressible. That is ADR-0018's "second
  vocabulary" smell (an action surface sharing none of `ActionSchema`'s checks)
  crossed with ADR-0078's silently-inert metadata.

  `ui/bulk-action.zod.ts` types it, with the same treatment `ActionParamSchema`
  got in #3746/#4001: a **strict** def whose unknown-key error names the offending
  key and the canonical spelling. Beyond spelling, it refuses the combinations the
  executor never reads — `patch` outside an `update`, `execution` outside a
  `custom`, `params` on a `delete`, `batchSize` on an aggregate — and refuses a
  hand-written `actionDef`, which is attached by the renderer when it resolves the
  def's `name` and which authored by hand would smuggle an action definition past
  the action registry.

  **One shape that parsed before is now rejected**: `operation: 'custom'` without
  `execution: 'aggregate'`. `resolveBulkActions` attaches a dispatcher for exactly
  one authored shape (the aggregate one); every other custom def falls to
  `Promise.resolve()` per row — a button that reports success for every selected
  record and does nothing. The error names both legal forms: `bulkActions:
['<name>']` for per-record (promoted with the action's own label, params and
  `visible`), `execution: 'aggregate'` for one call over the whole selection.

  Two things are deliberately left open:

  - **`params[]` is `.passthrough()`.** objectui's `BulkActionParam` declares a
    `[key: string]: unknown` catch-all — widget config (min/max/step/format)
    forwarded to the field renderer as-is. Locking it down would reject valid
    config, so declared keys are typed and the rest rides through, the same call
    `dashboard.zod.ts` makes for a widget's `config`.
  - **The bulk-param / action-param spelling divergence** (`help`/`helpText`,
    `default`/`defaultValue`, `object`/`reference`, plus `labelField`, which
    `ActionParamSchema` has no counterpart for). objectui already owns a converter
    for the promoted direction; converging the authored direction is a cross-repo
    change with its own migration. Typing them as they are is what makes the
    divergence visible rather than undocumented — the prerequisite for closing it.

  `label` and the param/option labels are `z.string()`, not `I18nLabelSchema`:
  an authored def reaches the grid verbatim (nothing resolves an `{ en, zh }` map
  on this path) and the bar renders `def.label` as a React child, so blessing the
  map form would trade a parse error for a blank screen. Localize by declaring a
  real action and naming it in `bulkActions` — that path runs through the i18n
  resolver.

  **Lint**: `validate-action-name-refs` now covers `bulkActionDefs`. Only an
  `execution: 'aggregate'` entry is a name reference (it is what
  `resolveBulkActions` looks up); an `update`/`delete` def's `name` is a button id
  and resolving it would be nonsense. The walk also reaches an **object's own
  `listViews`** for the first time — an object has no top-level `list`, so that
  tier had simply never been visited while the view-level ones were covered. And
  the hint no longer tells a bulk-surface author to add a `locations` entry: the
  selection bar is the one surface that does not filter on it, so naming the
  action there is the whole placement.

  Verified zero new findings against `app-showcase` / `app-crm` / `app-todo`.

### Patch Changes

- f3141d8: fix(spec): a node that publishes no descriptor configSchema can now own an expression-ledger entry (#4439)

  `FLOW_NODE_EXPRESSION_PATHS` is the #4027 ledger that tells `registerFlow` and
  `objectstack validate` which config keys hold expressions, and in which dialect.
  Its ratchet (`config-expression-ledger.test.ts`) derives what it expects from
  descriptor `configSchema` `xExpression` markers, and fails in **both**
  directions — an undeclared marker, or a ledger entry nothing declares.

  `decision` / `script` / `subflow` publish **no** descriptor `configSchema` on
  purpose: a published partial schema would drop the editors their hand-written
  Studio forms need (the #4210 incident), so their contract lives in
  `schemaless-node-config.zod.ts`. Those two rules compose into a hole — an
  expression slot on a schemaless node is structurally unreachable by the ratchet,
  and because the reverse direction rejects unclaimed entries, it cannot be
  entered by hand either.

  `decision.conditions[].expression` sat in that hole. Its own schema says
  _"Bare CEL predicate deciding this branch"_ and its own comment names `{…}` as
  the #1491 trap, and no validator walked it — so `{lead_record.status} ==
'converted'` passed `tsc`, passed `objectstack validate`, passed registration.
  #4414 made that fail loudly at run time; this makes it fail at build time,
  which is the delay #4027 exists to remove.

  ## The fix

  The ratchet now reads **both** declaration channels:

  - **descriptor `configSchema`** — unchanged, enumerated from the live registry;
  - **`schemaless-node-config.zod.ts`** — the marker rides
    `.meta({ xExpression })` through `z.toJSONSchema`, the same channel
    `loop.collection` has used since objectui#2670.

  Spec hands the second channel over as JSON Schema
  (`getSchemalessNodeConfigJsonSchemas()`, memoized, `input` mode — the shape a
  descriptor's `configSchema` already is), so the ratchet walks both with the
  _same_ function. No second notion of "a declared expression property", which is
  the duplication a ledger exists to remove, and no `zod` dependency added to
  `service-automation`. Each channel is separately asserted non-empty, so a broken
  derivation on one side cannot hide behind the other's results.

  `SCHEMALESS_NODE_CONFIG_SCHEMAS` is also exported for anything else that needs
  to reason about all node config contracts. Additive — objectui's
  `flow-node-config` reconciliation imports each schema by name and is unaffected.

  ## The sweep

  The other schemaless slots were checked and deliberately carry no marker:
  `script.template` is a template **id**, not a body; `script.inputs` /
  `script.variables` / `subflow.input` are values that interpolate `{token}` —
  text-with-holes, the shape essentially every node config string has, already
  covered generically by `validate-flow-template-paths` and the CLI flow linter.
  A `flow-template` ledger entry means something narrower: a _reference that must
  resolve to a value_, like `loop.collection`. So `decision.conditions[]
.expression` is the only genuinely declared expression slot on the class — now
  recorded in the ledger's header so it is not re-derived.

  ## Docs corrected

  The flows guide taught the **wrong dialect** for decision predicates in three
  places (`'{order_amount} > 10000'`), plus a "braces missing in a decision
  expression" warning that inverted after #4414 — and `FlowNodeSchema`'s own
  `@example` did the same. All corrected to bare CEL, with the history stated so
  an author with a braced predicate knows what changed and why their build now
  fails. The dialect table drops from three dialects to two: predicates never take
  braces, values always do.

  Verified: 13 new/updated tests across the ratchet, the engine's registration
  pass and `@objectstack/lint` (including the exact app-crm predicate rejected at
  both `registerFlow` and `objectstack validate`); `pnpm build`, `pnpm typecheck`
  (122 tasks), `pnpm lint` and `check:docs` clean.

- fd3013a: feat(spec,automation)!: converge `script` to a function call — retire the `actionType` branches — and parse `script` / `subflow` config at execute time (#4343)

  A `script` node had four ways to name what it ran and only one of them ran anything.
  Protocol 17 keeps that one and retires the rest.

  - **`config.actionType: 'email' | 'slack'`** were **logger-backed stubs**. They wrote a
    line, reported success, and delivered nothing — under any configuration, installed
    messaging service or not. Every bundled example used one; none of them ever sent
    anything.
  - **`config.template` / `.recipients` / `.variables`** fed those stubs, so they addressed
    a message no channel sent. (The examples did not even reach them: they passed the
    payload in `inputs`, which the built-in branch never read.)
  - **inline `config.script`** was recognized and **never executed** — the built-in runtime
    has no server-side JS sandbox, so the node warned and completed as a no-op.
  - **any other `actionType`** was shorthand for a registered-function name — a second
    spelling of `config.function` — and `'invoke_function'` was a marker that named nothing
    on its own.

  What remains is what worked: `config.function` (now **required**) names a registered
  function, `config.inputs` feeds it, `config.outputVariable` binds its return value.

  **The replacements are three different mechanisms, not one rename.**

  | Retired                                                           | Use instead                                                                                                                                        |
  | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `actionType: 'email'` (+ `template` / `recipients` / `variables`) | a `notify` node — it delivers through the messaging service: the in-app inbox by default, real email once `@objectstack/plugin-email` is installed |
  | `actionType: 'slack'`                                             | a `connector_action` node with the Slack connector, or an `http` node posting to an incoming webhook — `notify` has no Slack channel               |
  | `actionType: 'my_fn'` (shorthand)                                 | `function: 'my_fn'` — the conversion moves it for you                                                                                              |
  | `script: '…'` (inline JS)                                         | move the logic into a registered function and call it via `config.function`                                                                        |

  **Execute-time parse.** `script` and `subflow` now run their config through the contract
  before executing, the seam #4277 gave the flat builtins — a violation refuses the node as
  a **guard** (wrong metadata; no `fault` edge may route it, #3863). `script` could not join
  that seam while its legal key set depended on `actionType`: a flat parse would either
  reject valid shapes or wave everything through. Converging the node is what made the
  contract fit. `subflow`'s hand-written `flowName` check became the same parse, so its
  message is now `subflow 'n1': config does not satisfy the subflow contract —
config.flowName: …`. `decision` deliberately stays export-only: its one key is optional,
  so a parse would check nothing.

  **Migration.** `os migrate meta --from 16` rewrites stored sources; authoring one of these
  keys in TypeScript is a compile error carrying the same prescription. A shorthand
  `actionType` **converts into `function`** — that is what it named — unless `function` is
  already set, in which case it was dead metadata the executor never reached. The other four
  keys are dropped outright: nothing read them, so there is no value to preserve, and
  rebuilding the intent is an authoring decision (the table above) rather than something a
  mechanical rewrite can guess.

  The keys leave the **load path** (`retiredFromLoadPath`) with the rest of the keys retired
  for _misdescribing themselves_ rather than for being renamed: absorbing
  `actionType: 'email'` silently would let an author keep believing the flow sends mail. The
  one seam that still replays it is `registerFlow`, which rehydrates data at rest (#3903) —
  a row in `sys_metadata` has no author for a tombstone to teach. So a stored email-stub node
  arrives stripped of the keys nothing read and then **refuses for naming no callable**,
  where it used to log a line and report success. That flip is the behavior change to expect.

  **A build gap this surfaced, fixed here.** `FlowFunctionEntrySchema` now also accepts a
  **lowered handler ref** (a non-empty string), the form `objectstack build` produces: the
  CLI lowers every inline callable to a serialisable ref _before_ the stack is parsed (it
  must — `z.function()` wraps callables and would break the ref mapping), so a built
  manifest holds `{ myFn: 'myFn' }`, which neither previous member accepted. The result was
  that `defineStack({ functions })` — a documented, first-class mechanism — could not
  survive a build at all. Nothing had noticed because no bundled example used it; #4343
  turns that from latent into blocking, since `config.function` becomes the only thing a
  `script` node can run. `Hook.handler` already declared exactly this pair (`z.union([
z.string(), <function> ])`, "string, post-build / inline function, pre-build"), so this
  brings `functions` onto the platform's established shape rather than inventing one. A
  string carries no callable and `normalizeFlowFunctionEntry` still drops it by design — the
  real functions ride in the sibling ESM module the build emits, merged by name — so
  hand-authoring one registers nothing and fails loudly at execute ("no function named '…'
  is registered"), never silently.

  Also in this change: the retired constants `SCRIPT_BUILTIN_ACTION_TYPES`,
  `SCRIPT_INVOKE_FUNCTION_ACTION_TYPE` and the `ScriptBuiltinActionType` type are removed
  (they described the dispatch set that no longer exists); `os validate` names a retired key
  and its replacement instead of reporting a generic missing callable; and the `#3796`
  alias fixture, which carried `actionType: 'invoke_function'` through both sides, no longer
  describes an end state protocol 17 can reach — the rename itself is untouched. No liveness
  ledger row moves: the gate walks `FlowSchema`, whose `nodes[].config` is
  `z.record(z.unknown())`, so these keys were never governed by one.

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
  - @objectstack/formula@17.0.0-rc.2
  - @objectstack/sdui-parser@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 6a67d7a: feat(lint): L2 action-body writes to undeclared fields warn at author time (#4271)

  The write-set lint that #4305 gave L2 hook bodies now covers the other surface
  that carries one. An action body is the same artefact: the same
  `HookBodySchema` union, parsed by the same `HookBodySchema.safeParse` in
  `actionBodyRunnerFactory`, run in the same QuickJS sandbox. So it fails the
  same way — `ctx.api.object('crm_deal').update({ stag: 'won' })` inside an
  action reaches the driver unfiltered, and the outcome splits by driver: on SQL
  the stray column fails the whole call with a driver-level error far from the
  authoring site, and on a schemaless driver the stray key is persisted. Half
  the surface was still blind.

  **New rule — `action-body-write-unknown-field` (advisory).** Wired into
  `REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile` all
  report it; it never blocks a build. Both places the runtime reads actions from
  are walked — top-level `actions` and `objects[].actions` — and a
  `defineStack`-merged action, which lives in both, is reported once at its
  authored path. That dedupe is by VALUE (bound object + name + body source), not
  by object identity the way `collectBundleActions` can afford: the suite runs on
  the schema-PARSED stack, and parsing rebuilds every node, so the two copies
  arrive as distinct objects that are merely equal. An identity check passes a
  shared-reference unit fixture and then reports the showcase app's one warning
  twice — which is exactly what it did before the end-to-end run caught it.

  **Only the `ctx.api` write family carries over, and that is the point.** An
  action's `ctx.input` is its PARAMS bag (`input: unwrapProxyToPlain(actionCtx
?.params)`), not a record, so resolving those names against object fields would
  flag every correctly-named parameter — a pure false-positive machine, and a
  false positive kills an advisory lint. `ctx.record` is not a write surface
  either: the runner hands the body a plain snapshot and never writes it back, so
  `ctx.record.x = …` is discarded for _declared_ and undeclared fields alike —
  a different defect from "the unknown column vanishes", and flagging only its
  undeclared half would imply the declared half persists.

  So the rule ships a declared **partition** of the shared
  `HOOK_BODY_WRITE_PATTERNS` rather than a second ledger:
  `ACTION_BODY_WRITE_PATTERN_IDS` (today: `api-crud-literal`) and
  `ACTION_BODY_WRITE_EXCLUSIONS` (`input-property-assign`,
  `input-object-assign`), each exclusion carrying its reason. The two halves are
  tested to cover the shared ledger exactly, so a fourth pattern landing on the
  hook side fails this rule's test until someone classifies it — silence is not a
  decision. Every applicable pattern is additionally proved end-to-end through
  the full validator (prefilter, pattern filter and field check included), and
  every exclusion is proved to be about applicability rather than an
  unextractable shape: the shared extractor still sees it, and this rule still
  reports nothing for it.

  One extractor, one field index, one implicit-field set, shared with the hook
  rule rather than copied. The action rule is the same check on the other body
  surface, so a second copy of `IMPLICIT_FIELDS` would drift exactly the way the
  five hand-copied system-field lists #4330 collapsed did.

  The lint stays off the kernel boot path, and lands one notch tighter than the
  hook side: the only applicable pattern is rooted at `ctx.api`, so an action
  body that never mentions it does not even parse, let alone load the ~9 MB
  TypeScript compiler. Guarded by `lazy-deps.test.ts`.

  `@objectstack/spec`: `ScriptBodySchema` and `ActionSchema.body` now point at
  the action-side rule and spell out that `ctx.input` (params) and `ctx.record`
  (a discarded snapshot) are not record-write surfaces — doc comments only, no
  schema or generated-artifact change.

- 0ecc656: feat(lint): an action body's discarded `ctx.record` write warns at author time (#4345)

  `#4344` deliberately left `ctx.record` alone, and said why: an action's
  `ctx.record` is a plain snapshot (`unwrapProxyToPlain(actionCtx?.record)`) that
  `boundActionHandler` never writes back — the hook path's
  `applyMutationsToInput` has no action-side counterpart — so `ctx.record.x = …`
  is discarded for **declared and undeclared fields alike**. Reporting that
  through the unknown-field rule would have been actively wrong: flagging only
  the undeclared half implies the declared half persists, which is the false
  completion this rule family exists to stop manufacturing. It needed its own
  finding, and now has one.

  **New rule — `action-record-write-discarded` (advisory).**

  **It is not "flag every `ctx.record.<field>` assignment"** — that would be a
  false-positive machine, because mutating the snapshot to build a payload is a
  legitimate idiom:

  ```js
  ctx.record.stage = "won";
  await ctx.api.object("crm_deal").update(ctx.record); // the write is LIVE
  ```

  So the finding requires the write to be **provably dead**: reported only when
  `ctx.record` never escapes the body as a value. Property reads
  (`ctx.record.id`) do not rescue a write and do not suppress the finding;
  handing the object to anything — an argument, an assignment RHS, a spread, a
  return — does. Aliasing (`const r = ctx.record`) reads as an escape, which is
  the safe direction: it costs a missed finding, never a false one.

  Truthiness and type tests are **not** escapes, and that distinction is what
  makes the rule fire on real code rather than almost never. Running it against
  the showcase app is what surfaced it: `mark_done` opens with
  `ctx.recordId || (ctx.record && ctx.record.id)`, the defensive idiom action
  bodies are actually written with, and counting that guard as an escape silenced
  the finding on the one body in the repo that had a record write. A test reads
  the reference and yields a boolean — or, for `&&`/`||`/`??`, yields the left
  operand only when it is falsy, which is null or undefined and persists nothing.
  Only the LEFT operand is a test: `x || ctx.record` really does evaluate to the
  object, and still escapes.

  **One suite member, two rule ids.** Both findings fall out of one parse of one
  source on one surface, so `validateActionBodyWrites` reports both rather than
  `REFERENCE_INTEGRITY_RULES` growing a second member that would parse every
  action body again to say two things about the same walk. The alternative —
  hand-wiring it into the three CLI commands — is the drift that suite exists to
  end, and `validateReadonlyFlowWrites` is the standing proof: wired into
  `validate` and `compile`, never into `lint`. The trade-off is written down at
  both ends rather than left to be rediscovered.

  **The ledger ratchet fired, as designed.** `record-property-assign` joins the
  shared `HOOK_BODY_WRITE_PATTERNS` — the extractor's shape inventory, not any
  one rule's — and both existing consumers had to classify it before it could
  land. That was not cosmetic on the hook side: a `record-property-assign` write
  carries no `object`, and `validateHookBodyWrites` branched on exactly that to
  mean "a `ctx.input` write", so the new shape would have been reported as _"the
  hook writes 'stage' to its input"_. The hook rule now declares its own
  consumed subset (`HOOK_BODY_WRITE_PATTERN_IDS`) and its exclusion with a
  reason — a hook sandbox context has no `ctx.record` at all
  (`buildSandboxContext` never sets it), so the expression throws at run time
  rather than silently no-op'ing, and a loud failure is not an advisory rule's
  business.

  `extractHookBodyWriteSet` is the new one-parse entry point, returning the
  writes plus the `ctxRecordEscapes` signal; `extractHookBodyWrites` stays as a
  thin projection of it.

  **Boot path.** The action gate's prefilter widens from `api` to `api`-or-
  `record`, so a body reaching neither still never loads the ~9 MB TypeScript
  compiler. `lazy-deps.test.ts` pins it — and its header and two case names,
  which still claimed every lazy dep waited on "a react page", now say which
  trigger each one pins (typescript has also been loaded by the hook-body gate
  since #4271).

  `@objectstack/spec` / `@objectstack/runtime`: `ScriptBodySchema`,
  `ActionSchema.body` and `ScriptContext.record` now state that
  `ctx.api.object(...)` is the only path that persists anything, and that
  `ctx.record` is read-only in effect. Doc comments only — no schema or
  generated-artifact change. Whether the runtime should instead refuse or honour
  a record write stays open on #4345.

- e4c61a7: Validate the expression slots a flow node's `configSchema` declares (#4027).

  A node type's designer `configSchema` and the keys its validators traverse were
  two unreconciled lists. Both the engine's `registerFlow` pass and the author-time
  `objectstack validate` pass hardcoded `config.condition` / `edge.condition` and
  assumed every other node string was a `{var}` template — so a declared expression
  property outside that hardcoded set was validated by nobody.

  That is how #3528 shipped. `screen.fields[].visibleWhen` has been on the `screen`
  descriptor since #3304, typed `xExpression: 'expression'` (bare CEL) and offered
  to authors in Studio, but no validator traversed it. An app authored the
  predicate in the _other_ dialect — `'{createOpportunity} == true'` — and it passed
  `tsc`, `objectstack validate` and registration in silence. Because `required` _is_
  enforced, a field the author had made conditional rendered unconditionally and
  blocked Submit on an input the user was never shown: the run paused forever and no
  resume was ever issued.

  Now:

  - **`FLOW_NODE_EXPRESSION_PATHS`** (`@objectstack/spec`) is the declared ledger of
    expression-bearing node config paths, each recording the dialect it takes.
  - **Both validators read it.** A malformed `visibleWhen` is a located, quoted
    error at `registerFlow` _and_ at `objectstack validate` — `node 'screen_1'
(screen) screen field visibleWhen at config.fields[1].visibleWhen`.
  - **A reconciliation ratchet** derives the expression properties from the live
    descriptors and fails CI in both directions: a new `xExpression` property with
    no ledger entry, or a stale entry no descriptor declares. It walks every
    registered builtin, not just `screen`.

  Dialects are recorded rather than assumed because there are three, and two of them
  disagree about braces: bare CEL (`{…}` is the #1491 brace-trap), single-brace
  `{var}` flow interpolation (`{…}` is correct), and the ADR-0032 §3 double-brace
  text template. Only bare-CEL slots are checked — `loop.collection` and
  `map.collection` are recorded as `flow-template` and deliberately left alone,
  since no validator implements their dialect and checking them under either of the
  other two would reject every currently-valid flow.

  `ActionDescriptor.configSchema`'s TSDoc no longer claims `registerFlow()`
  validates `config` against it. It never did: `FlowNodeSchema.config` is
  `z.record(z.unknown())`, so types, `required`, `enum` and unknown keys are still
  unenforced. The doc now states exactly what is checked and what is designer-facing
  only, so nothing relies on a guard that does not exist.

- cc60165: feat(lint): a flow `update_record` node writing an undeclared field gates the build (#4271)

  The write-set family #4305 (hooks) and #4344 (actions) opened had a third
  surface, and it was the one the docs had spent the longest recommending as the
  safe alternative to the other two. A flow `update_record` node whose
  `config.fields` names a field the target object never declares was caught by
  **nothing**: `validate-readonly-flow-writes.ts` walks that exact map and
  explicitly stepped over the unknown key (`if (!meta) continue; // a
form/field-layout lint concern` — a referral to a rule that does not check
  writes), and `validate-flow-template-paths.ts` checks the `{record.<path>}`
  READ tokens interpolated into node config, never the write-side key. So the
  surface `hook-bodies.mdx` pointed authors at — "prefer a flow `update_record`
  node, whose structural `fields` config is checked" — was the least checked of
  the three.

  **New rule — `flow-node-write-unknown-field`, and it is an `error`.** Wired into
  `REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile` report
  it at once (one more place than the hand-wired readonly rule next door reaches).

  **Why it gates where its two siblings advise.** The hook and action rules are
  advisory because they PARSE JavaScript: the finding is only as good as the
  extractor, and a false positive kills an advisory lint. Nothing here is parsed —
  `config.fields` is a literal map next to a literal `objectName`, the same
  certainty `flow-update-readonly-field` already gates on one config key over. A
  rule that errors on a write the engine _strips_ while only warning on a write
  that names no column at all would be incoherent in the same `fields` map.

  And the runtime consequence is not the benign "consumer skips the unknown name
  and renders the rest" that keeps `page-field-unknown` / `form-field-unknown`
  advisory. Both halves were measured, not inferred:

  - Through the engine, an undeclared key reaches `driver.update` verbatim — the
    flow executor calls the data engine directly, the UPDATE path strips only
    readonly/readonlyWhen, and the SQL driver's `formatInput` /
    `applyWriteColumnMap` pass an unrecognized key straight through (`m[k] ?? k`).
  - On SQLite/knex it becomes `update "deal" set "name" = 'n2', "stagee" = 'won' …
→ no such column: stagee`. The statement is rejected **whole**: `name` —
    spelled correctly, in the same payload — does not land either, and the step
    fails with a driver error naming a column, far from the authoring mistake.
  - On a schemaless datasource nothing rejects it, so the stray key is persisted
    into a column the object never declares, where no schema-driven read returns
    it.

  That is the call `validate-searchable-fields` makes for a stale entry and
  `validate-flow-template-paths` makes for a filter-position token: gate when the
  miss breaks or corrupts the operation, advise when it merely narrows the output.

  **One field index and one implicit-field set across all three surfaces.**
  `indexObjectFields` and `IMPLICIT_FIELDS` are imported from the hook rule rather
  than copied, so the three rules cannot drift on what is writable without being
  authored — the shape #4330 collapsed one package over.

  Every skip exists so the gate only ever fires on a certainty, and each is
  silent: a templated `objectName`, a non-literal `fields` map, an object this
  stack does not define, an object that declares no fields at all (external /
  datasource-introspected schemas, the same skip `validate-searchable-fields`
  takes), and dotted keys (a nested-path write, not a top-level column). `runAs`
  is deliberately NOT consulted, unlike the readonly rule that skips
  `runAs:'system'` — an elevated identity bypasses the readonly strip, but no run
  identity conjures a column.

  **Scope is declared as data, not left as silence.** `FLOW_WRITE_NODE_TYPES`
  (today `update_record`) and `FLOW_WRITE_NODE_TYPES_DEFERRED` (`create_record`,
  with its reason) are partition-tested against the CRUD node types that carry a
  `fields` write map — derived behaviourally from the spec's executor-written
  config schemas, not restated — so a node type that grows one later fails that
  test until someone classifies it.

  `@objectstack/spec`: `ScriptBodySchema`'s "prefer a flow `update_record` node,
  whose structural `fields` config is error-checked" note now names the rule that
  makes it true. Doc comment only — no schema or generated-artifact change.

  Docs: #4355 had just rewritten `automation/hook-bodies.mdx` to record this gap
  honestly — "**Prefer a flow `update_record` node when the write set is fixed —
  but not for _this_ check** … writing a field the object never declares is
  currently reported by nothing at all. On that one axis an L2 body is now the
  better-checked surface." That bullet, and the matching note in
  `automation/hooks.mdx`, are the two sentences this change makes false. Both now
  say the axis has flipped back — and why the flow side lands a level _stronger_
  than the body side rather than merely level with it.

- c1d44f7: feat(lint): L2 hook-body writes to undeclared fields warn at author time (#4271)

  An L2 (`language:'js'`) hook body that writes a field the target object never
  declares — `ctx.input.amout = 0`, `ctx.api.object('deal').update({ stag: … })`
  — runs clean in the QuickJS sandbox and reaches the driver **unfiltered**:
  `applyMutationsToInput` is a plain `Object.assign`, and the write-path
  validator walks declared fields on insert and skips a key it has no field def
  for on update. What happens next depends on the driver, and neither half is
  acceptable:

  - **SQL** — the stray column enters the statement and the **whole write fails**
    with a driver-level error (`table deal has no column named stagee`). The
    write is lost, and the error surfaces far from the mistake that caused it.
  - **Schemaless** (memory, MongoDB) — the driver spreads the payload, so the
    stray key **is** persisted: an undeclared column nothing downstream reads.

  No diagnostic anywhere, and nothing at the authoring site either way — the
  #4001 "the mistake is invisible where it is made" family. The read side
  (`hook.condition`) and the capability surface were already statically checked;
  the write side was the one blind face, and `hook-body.zod.ts` carried it as an
  **accepted gap**.

  **New rule — `hook-body-write-unknown-field` (advisory).** `@objectstack/lint`
  now parses each L2 body (TypeScript parser; parsed, never executed, never
  type-checked) and resolves its literal writes against the target object's
  declared + system fields. An unknown field warns with a did-you-mean. Wired
  into `REFERENCE_INTEGRITY_RULES`, so `os validate`, `os lint` and `os compile`
  all report it; it never blocks a build.

  The recognized write shapes are declared as data — `HOOK_BODY_WRITE_PATTERNS`,
  each entry carrying a canonical example that a reconciliation test round-trips
  through the real extractor, so a pattern cannot be declared-but-unverified
  (#3528's death). v1 ships three:

  - `ctx.input.<field> = …` / `ctx.input['<field>'] ⟨op⟩= …` → the hook's own
    target object(s); flat-input envelope keys (`id`/`options`/`ast`/`data`) are
    never treated as record fields.
  - `Object.assign(ctx.input, { <field>: … })` → same target.
  - `ctx.api.object('<object>').insert|create|update({…})` / `.updateById(id, {…})`
    → the named object, at the **real** `ObjectRepository` payload positions
    (`update(data)` — the payload is argument 0, not `update(id, data)`).

  Everything statically unknowable is skipped silently, favouring missed findings
  over false ones: computed keys, spreads, non-literal payloads, dynamic object
  names, wildcard-target (`object:'*'`) input writes, cross-package targets,
  aliased input (`const doc = ctx.input`), and multi-target hooks where the field
  exists on _some_ target (the body may branch per object — only an
  everywhere-miss warns).

  The lint stays off the kernel boot path: the TypeScript compiler loads lazily,
  only when a hook actually carries a JS body (same contract as the react-page
  gates, guarded by `lazy-deps.test.ts`).

  `@objectstack/spec`: the `ScriptBodySchema` header's "write-set opacity —
  accepted static-analysis gap" note now points at the lint instead, and spells
  out what remains opaque so the warning's absence is not read as proof of
  correctness.

- 3eb1b2b: feat(lint): every field-bearing prop on a React page block resolves against the
  object it names

  #4329 closed ONE of them — `<ListView searchableFields>` — by running the
  metadata rule's core from the gate that owns React block props. That prop was an
  instance, not the class: every other prop a `kind:'react'` page binds BY FIELD
  NAME shipped exactly as typed, the same silent drift `page-field-unknown`
  already closes for the page-component `properties` bag one surface over.

  `validate-react-page-props` now resolves all of them:

  - `<ListView>` `fields` / `columns` / `sort` / `grouping` / `userFilters` /
    `hiddenFields` / `fieldOrder` / `filterableFields`
  - `<ObjectForm>` `fields`, `initialValues` KEYS, `sections[].fields[]`
  - `<RecordHighlights>` / `<RecordDetails>` / `<RecordPath>` /
    `<RecordRelatedList>` — via the SAME `COMPONENT_FIELD_SPECS` table the
    metadata surface uses, keyed by the block's `schemaType`, so the two surfaces
    agree by construction rather than by two lists that happen to match
  - `<Block type="…">` — the escape hatch reaches the same table by the type the
    author writes, so it is checked instead of being a hole

  Findings carry the metadata rule's id (`page-field-unknown`) at its advisory
  severity, because the consumer behaves the same way: an unknown name is skipped
  and the rest renders.

  **A FILTER position gates instead.** `<ListView filters>` / `<ObjectChart
filter>` name fields in a QUERY, and an unknown column there is not a skipped
  column: the predicate can never match, `SqlDriver` swallows the driver's
  "no such column" and returns `[]`, and the surface renders an empty list that
  looks exactly like "there is no data" — the silent zero `filter-token-unknown`
  and `validate-flow-template-paths`' filter-position call both gate on. Those
  are reported as `error`.

  Filter positions are also resolved INDEPENDENTLY of each other, unlike every
  other value this gate reads. `filters={['status', '=', stage]}` — a static field
  beside a React-state value — is the shape a react page actually writes, and the
  all-or-nothing static reader skipped the whole array, including the one position
  that was knowable.

  Everything else is unchanged: a value from a variable, a call, or behind a
  spread is unresolvable rather than wrong and is skipped silently (ADR-0072 D1),
  as are cross-package objects, objects with no authored field map, dotted
  relationship paths, and registry-injected system columns.

  ### Breaking: `<RecordRelatedList objectName>` is the RELATED object, as the spec always said

  `RecordRelatedListProps.objectName` is the related (child) object — that is what
  `record:related_list` means on every metadata surface, what
  `validate-page-field-bindings` resolves its `columns` against, and what the one
  registry component behind both surfaces consumes. The React overlay declared
  `objectName` a SECOND time and glossed it "The parent object", and the generated
  contract publishes the overlay's description in place of the schema's — so the
  react surface both contradicted the spec and lost any way to name the object it
  renders.

  FROM → TO for a page authored against the old gloss:

  ```diff
  - <RecordRelatedList objectName="account"  recordId={id} relationshipField="account_id" columns={['name','total']} />
  + <RecordRelatedList objectName="invoice"  recordId={id} relationshipField="account_id" columns={['name','total']} />
  ```

  `objectName` names the CHILD object being listed; the parent record stays bound
  by `recordId`, and `relationshipField` is the child's field pointing back at it.
  The lint above reports the old spelling (the child's columns and its FK do not
  resolve against the parent). `objectName` is now also published as required, as
  the schema declares it.

  The class is closed as well as the instance: `REACT_OVERLAY_SHADOWS` in
  `@objectstack/spec/ui` ledgers every overlay prop that restates a spec-schema
  prop, and a test asserts the ledger equals the real collision set — so the next
  overlay entry that silently redefines a schema prop fails a test instead of
  shipping a second dialect.

- 9555b07: feat(lint): `<ListView searchableFields>` on a react page is checked against
  the bound object's fields (#4329)

  #4328's `searchable-field-unknown` gates a stale `searchableFields` entry on
  the metadata surfaces — an object's own ADR-0061 declaration, its built-in
  named list views, and a `defineView` aggregate's default `list` / named
  `listViews`. It did not cover the react page surface: `ListView` declares
  `searchableFields` as a dataProp, so a `kind:'react'` page could write
  `<ListView searchableFields={['renamed_field']}>` and nothing resolved the
  name. The failure is the one #4328 documents — the engine's
  `resolveSearchFields` silently filters the stale name out, so the search scans
  a narrower set than the page asked for, or (once every entry is stale) falls
  through to the auto-default and scans a wider one; and once the REST read path
  validates the `$searchFields` override (#4254), the prop objectui echoes
  verbatim becomes a `400 INVALID_FIELD` on that list.

  The check lives in `validate-react-page-props` — the gate that already parses
  the page's real JSX — and runs on `<ListView>` usages whose `objectName` and
  `searchableFields` are static literals, under the same rule id and severity
  (`searchable-field-unknown`, `error`) as the metadata surfaces. It is not a
  re-implementation: `validate-searchable-fields` now exports its core
  (`indexObjectSearchTargets` + `checkSearchableFieldList`), and the react gate
  runs that, so the two surfaces agree on what counts as a field by construction
  — same three skips (an object this stack does not define, an object with no
  authored field map, registry-injected system columns derived from the spec's
  own declarations), same dotted-path strictness (search matches the field map
  by exact string, so `owner_id.name` is flagged, not exempted).

  JSX-specific seams follow the gate's existing rules: a value that comes from a
  variable, a call, or a spread is not knowable at build time and is skipped
  silently — an unresolvable binding is not a wrong one (ADR-0072 D1).

- 7967133: feat(lint): a `searchableFields` entry naming no field is caught at authoring
  time, not at request time

  `searchableFields` is `z.array(z.string())` in both `object.zod.ts` and the
  list-view schema, so nothing ever checked that an entry resolves to anything.
  Rename a field and the old name stays behind — Zod-valid, shipped, pointing at
  a column that no longer exists.

  The engine tolerates it, which is exactly what kept the drift invisible:
  `resolveSearchFields` filters the declaration down to fields that exist
  (`searchableFields?.filter((f) => all[f])`) and says nothing. The tolerance
  fails in the direction nobody expects:

  - **some entries stale** → `$search` scans a NARROWER set than the object
    declares. Records that should match do not, and the response is
    indistinguishable from "no such record";
  - **every entry stale** → the filtered set is empty, so resolution falls
    through to the AUTO-DEFAULT (name/title + short-text fields). A declaration
    whose whole purpose is to CHOOSE the searchable set ends up selecting one the
    author never wrote — the "asked narrower, answered wider" inversion #4226
    closed on the projection axis.

  It also stops being quiet downstream. Clients echo the declaration verbatim as
  the `$searchFields` override (objectui's list search sends
  `schema.searchableFields`), so once the REST read path validates that override
  against the object (#4254), a stale entry the engine had been silently skipping
  becomes a `400 INVALID_FIELD` on every list search for that object — a
  request-time break whose cause is an authoring typo made long before.

  **New rule — `searchable-field-unknown` (gating).** Wired into
  `REFERENCE_INTEGRITY_RULES`, so it runs on `os validate`, `os lint` and
  `os compile` with no CLI edit. It covers the object's own ADR-0061 declaration
  and the list views that narrow it (`objects[].listViews`, a `defineView`
  default `list`, and named `listViews`), resolving each entry against the bound
  object's declared fields.

  `error`, not the advisory level the other field-existence rules use
  (`page-field-unknown`, `form-field-unknown`, `semantic-role-field-unknown` are
  all warnings). Those describe a consumer that SKIPS an unknown name and renders
  the rest; this describes a declaration that either selects the wrong set or
  refuses the request outright — the same call `validate-flow-template-paths`
  makes for a filter-position token, where the miss widens the query instead of
  shrinking the page.

  Existence only: a field that exists but is an odd search target (a `json`
  column) is NOT flagged — an explicit `searchableFields` is authoritative, so
  declaring one is a choice, not drift. Three skips keep false positives near zero
  (ADR-0072 D1): an object this stack does not define, an object with no authored
  field map (external / datasource-introspected), and registry-injected system
  columns — the last derived from the spec's own `FIELD_GROUP_SYSTEM_FIELDS` and
  `SystemFieldName` rather than hand-copied, since this package already carries
  five slightly-different copies of that list.

  Dotted paths are the one place this rule is stricter than its siblings. They
  skip `owner_id.name` because the query engine resolves the traversal; search
  does not — `resolveSearchFields` matches the field map by exact string, so a
  dotted entry is dropped exactly like a typo, and it is the spelling most likely
  borrowed from `select`/`sort`. It is flagged, with its own fix hint.

### Patch Changes

- 78caf51: fix(lint): the write-set diagnostics describe what the runtime actually does (#4271)

  `hook-body-write-unknown-field` and `action-body-write-unknown-field` told
  authors the undeclared column "silently never lands in the stored record".
  Measured on `main`, that is wrong in **both** directions. Nothing between the
  body and the driver filters the key — `applyMutationsToInput` is a plain
  `Object.assign`, and `validateRecord` walks declared fields on insert and
  `continue`s past a key with no field def on update — so the driver decides:

  - **SQL** — the stray column enters the statement and the **whole write
    fails** with a driver-level error (`table deal has no column named stagee`).
    Nothing is stored, so the correctly-spelled fields of that row are lost too,
    and the error names a column far from the body that wrote it.
  - **Schemaless** (memory, MongoDB — both spread the payload without consulting
    the declared field set) — the stray key **is** persisted, as an undeclared
    column nothing downstream reads.

  A lint that misdescribes the failure it is warning about teaches the wrong
  debugging instinct: an author told the value silently vanishes will not connect
  the driver error they actually see to the typo that caused it, and on a
  schemaless driver will not go looking for the stray key that is really there.
  All three messages now state the split, matching the "What still happens at
  runtime" description #4355 gave `content/docs/automation/hook-bodies.mdx`.

  Both outcomes are pinned by a new integration test —
  `runtime/src/sandbox/undeclared-field-write-driver-split.integration.test.ts`.
  Its insert cases run the full chain (real QuickJS sandbox, real hook body, real
  engine, real driver against a real SQLite table), so "reaches the driver
  unfiltered" is proved rather than asserted: if anything on that path ever
  learns to filter, the SQL half stops throwing and the test goes red. The rule
  headers, the `ScriptBodySchema` / `ActionSchema.body` notes and the two
  still-unreleased #4271 changesets are corrected to match. #4355 fixed the
  prose docs; this is the same correction on the surfaces that ship in the
  packages — the diagnostic an author actually reads, and a test that pins it.

  `@objectstack/spec`: doc comments only — no schema or generated-artifact change.

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

- 38182ff: feat(lint): `flow-node-write-unknown-field` covers `create_record` too (#4271)

  #4369 shipped the flow write-set gate on `update_record` alone and parked
  `create_record` in `FLOW_WRITE_NODE_TYPES_DEFERRED` with its reason — a gating
  rule earning its severity one measured surface at a time, recorded as data
  rather than left as silence. This measures the other half and moves it across.

  **The INSERT path fails the same way, one notch harder.** Same literal
  `config.fields` map, same `objectName` binding, same journey to the driver — the
  engine hands an undeclared key to `driver.create` verbatim, alongside the audit
  stamps. On SQLite/knex it becomes `table deal has no column named stagee` and
  the statement is rejected whole, so the correctly named fields in the same
  payload never land either. The extra harm is what does _not_ exist afterwards:
  the row is never created, so every later node reading `{<node>.id}` from that
  node's `outputVariable` is working from a record that was never written. An
  `update_record` failure at least leaves the record intact.

  So the message now names that consequence on `create_record` and only there —
  "…and the record is never created at all" — instead of one sentence blurred to
  fit both.

  Nothing else moves: same rule id, same `error` severity, the same silent bails
  (templated `objectName`, non-literal `fields`, cross-package objects, objects
  declaring no fields, dotted keys), and `runAs` is still not consulted. Each skip
  is now pinned on the create surface as well as the update one, so the two node
  types cannot drift into different behaviour.

  **`FLOW_WRITE_NODE_TYPES_DEFERRED` is now empty and deliberately kept.** The
  partition test derives the full `fields`-write-map set behaviourally from the
  spec's executor-written config schemas, so a node type that grows one later
  belongs to neither list and fails that test until someone classifies it.
  Deleting the empty array would turn that forced decision back into a default.

  Two non-members are now excluded on the shape of their failure rather than by
  omission, both stated in the module header and one pinned by a test:
  `get_record.fields` is a projection (`z.array(z.string())`) — a READ, where an
  unknown entry narrows the selection instead of breaking the statement — and
  `screen.defaults` is forwarded into the `ScreenSpec` the client renders, so an
  unknown key is a prefill the renderer ignores. That inert "skips it and renders
  the rest" case is exactly what this rule's `error` severity is defined against.

  Verified against the repo's own apps: app-crm, app-todo and app-showcase all
  still validate clean with `create_record` covered — including crm's
  convert-lead flow, which creates an account and an opportunity before updating
  the lead.

- af5b96b: fix(lint): flow rules see into try_catch / loop / parallel regions (#4380)

  Every lint rule that inspects flow nodes had hand-written the same one-liner —

  ```ts
  const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
  ```

  — and every one of them was therefore blind to the same thing.
  `FlowRegionSchema` holds a full `nodes: z.array(FlowNodeSchema)`, and four
  config slots carry one: `try_catch.config.try` / `.catch`, `loop.config.body`,
  and `parallel.config.branches[].nodes`. Regions nest arbitrarily. Move a node
  into any of them and the checking stayed behind.

  Measured before the fix, the same bad nodes at the top level vs inside a
  `try_catch`:

  | rule                                            | severity      | flat | nested              |
  | :---------------------------------------------- | :------------ | :--- | :------------------ |
  | `flow-node-write-unknown-field`                 | error         | 1    | **0**               |
  | `flow-update-readonly-field`                    | error         | 1    | **0**               |
  | `approval-approver-*`                           | error/warning | 1    | **0**               |
  | `flow-template-unknown-field` (filter position) | error         | 1    | **1, as a warning** |

  **The last row is the one a reader would not predict.**
  `validate-flow-template-paths` scans a node's whole `config` for string leaves,
  so it still _saw_ tokens inside a region — but its `filter`-position split only
  looks at the top level of the node it was handed. A nested filter token lost its
  position, so the #3810 finding ("this node cannot run — an erased condition
  WIDENS the query") silently degraded to an advisory warning, reported against
  the wrapping `try_catch` instead of the `get_record` that is broken:

  ```
  FLAT     error  	flow "f" node "get_record"	flows[0].nodes[1]
  NESTED   warning	flow "f" node "try_catch"  	flows[0].nodes[1]
  ```

  Being visible is not the same as being judged correctly. That is worse than a
  clean miss: a yellow line reads as "checked and merely advisory".

  **One shared walk, not five.** `flow-walk.ts` — the flow-side counterpart of the
  existing `page-walk.ts`, and here for the same stated reason: getting the
  traversal right is subtle enough that duplicating it has already produced dead
  rules. `walkFlowNodes(flow, flowPath)` yields every node with its real config
  path (`flows[0].nodes[1].config.catch.nodes[0]`), a region breadcrumb for
  diagnostics (`try_catch "Guard" › catch`), and depth. Four rules now route
  through it: the two flow write rules, the template-path rule, and the approval
  rule.

  Findings now land on the node that is actually wrong, which is the point — a
  path pointing at the container is not actionable in a flow with several regions.

  **The double-count trap is handled, not left to each caller.** A container node
  is walked too (it has its own config worth checking — a `loop`'s `collection`, a
  `try_catch`'s `retry`), but its `config` physically contains every descendant,
  so a rule that scans config recursively would report each nested finding twice.
  `WalkedFlowNode.localConfig` is the container's config with region slots
  removed; the recursive scanner uses it, and a test pins that a nested token is
  reported once while the container's own `collection` token still is.

  `REGION_SLOTS` is declared as data and pinned against the spec's own
  region-bearing config schemas — derived behaviourally (a slot is one that
  accepts `{nodes: […]}`), not restated — so a fifth construct fails that test
  instead of becoming a fifth silent blind spot. A `MAX_REGION_DEPTH` cap keeps a
  hand-authored (pre-parse) stack from hanging a lint.

  Verified end to end: nested now matches flat on every rule, including the
  restored `error` severity. app-showcase ships an `update_record` inside a
  `catch` branch (`showcase_resilient_sync`) that had never been checked by
  anything — it is correct, so validation stays clean, and breaking its field name
  on purpose now fails `os validate` with
  `flows[24].nodes[1].config.catch.nodes[0].config.fields.sync_statuss` and the
  region trail `try_catch "Push with retry" › catch › node "Flag Sync Failure"`.

- 7d80695: fix(lint): an object declaring no fields is unjudgeable, not "has no such field" (#4383)

  `hook-body-write-unknown-field` and `action-body-write-unknown-field` reported
  **every** field write to an object that declares no `fields` — an external
  object, or a datasource-introspected schema whose columns are resolved at
  runtime. Measured before the fix:

  ```
  hook  : ["hook-body-write-unknown-field / warning"]     ← false
  action: ["action-body-write-unknown-field / warning"]   ← false
  flow  : []                                              ← correct
  ```

  `indexObjectFields` returns an **empty Set** for such an object rather than
  `undefined`, and both rules only asked "is this object in the stack?" —
  `targetSets.every((s) => s !== undefined)` and `if (!known) continue`. An empty
  Set is neither undefined nor falsy, so it became the answer to `has(field)`,
  and the answer is always `false`.

  That field map is not empty, it is **unknown**. The distinction already existed
  in two other rules of the same family, each with its reason written down —
  `validate-searchable-fields` skip #2 and `validate-flow-node-writes` (#4369,
  which added the guard because it gates). Two of four had it; the drift shape
  #3583 and #4330 exist to remove.

  **Fixed once, not twice.** The guard now lives in a shared
  `judgeableFieldsOf(index, objectName)` that returns the declared names only when
  they are a sound basis for a "resolves to nothing" judgement, and `undefined`
  for both unjudgeable cases — cross-package objects and fields-less ones. All
  three write-set rules route their lookups through it, so a fourth cannot repeat
  the omission. It is internal to the family (not re-exported from the package
  barrel), same as `indexObjectFields` and `IMPLICIT_FIELDS`.

  One semantic call worth naming: a **multi-target** hook where only _some_
  targets are judgeable is now skipped entirely. The `ctx.input` finding fires
  only when a field is missing from EVERY target, and an unjudgeable target is one
  the field might well exist on — so judging the remainder would assert "missing
  everywhere" on evidence that does not cover everywhere. Consistent with the
  rule's stated asymmetry: prefer a missed finding to a false one.

  No behaviour change for objects that declare fields: an unknown field on a
  normal object still warns exactly as before, pinned by a test placed next to
  each new skip so the guard cannot swallow the real finding.

- ade7be4: fix(lint): the seven system-field exemption lists derive from the spec's declarations (#4330)

  Five rules in `@objectstack/lint` each carried their own hand-copy of
  "registry-injected columns present on almost every object but absent from
  authored `fields`" — and they had already drifted from one another (two more
  copies had appeared by the time the fix landed). This is the shape #3786
  removed from the audit-provenance family, rebuilt one package over: the same
  list, maintained in parallel, each under a comment asking to be kept in sync
  with one of the others.

  The package now has one module, `system-fields.ts`, whose `SYSTEM_FIELDS` is
  DERIVED from the spec's two declarations — `FIELD_GROUP_SYSTEM_FIELDS`
  (`@objectstack/spec/data`) and `SystemFieldName` (`@objectstack/spec/system`)
  — and all seven field-resolving rules consume it. A pin test holds the
  boundary in both directions: the set contains exactly the two declarations'
  union, and none of the rule-local exemptions.

  Two deliberate behavior consequences, both in the permissive direction the
  rules' own comments argue for (over-inclusion costs at worst a missed
  warning; under-inclusion costs a false one):

  - `widget-bindings`, `page-field-bindings` and `react-page-props` now also
    exempt `is_deleted`;
  - `flow-template-paths` now also exempts `user_id`.

  Names that are NOT system columns in the spec's sense (`name`, `owner`,
  `record_type`, and the legacy physical spellings `_id` / `space`) stay
  rule-local next to the reason each rule exempts them, instead of widening
  every rule: `name` in particular is an ordinary authored field on most
  objects, and exempting it package-wide would stop the field-existence rules
  from catching a reference to a field the object genuinely does not have.

- 8db4587: fix(lint,cli): `os lint` / `os compile` 不再放行一个 `os validate` 会拒绝的 react 页面

  `validateReactPageProps` 只手工接在 `os validate` 上,另外两个命令从来没跑过它。
  在 showcase 的 react 页面上植入一处 gating 违规(`<ListView filters={['no_such_col','=',stage]}>`
  —— 谓词命中不了任何行,列表回空,和「本来就没数据」无法区分)实测:

  ```
                os lint      os compile     os validate
    修复前      exit 0 放行   exit 0 放行    exit 1 拒绝
    修复后      exit 1 拒绝   exit 1 拒绝    exit 1 拒绝
  ```

  这条规则在 #4340 之后已经是**整个 react 页面表面唯一**的字段解析闸门:
  `<ListView>` 的 columns/fields/sort/grouping/userFilters、`<ObjectForm>` 的
  fields/initialValues/sections/subforms、`record:*` 一族(与元数据表面共用同一张
  `COMPONENT_FIELD_SPECS`)、`<ObjectChart>` 的 aggregate/axes、以及 `searchableFields`。
  漏接不是少几条警告 —— 而是这些绑定在 build 路径上**完全没人看**,包括其中会 gate 的那些。

  现接入 `REFERENCE_INTEGRITY_RULES`,`os validate` 里那处手工接线随之删除,三个命令的
  答案由构造保证一致。这正是 suite 设立要终结的漂移(#3583 §5 D5),也是
  `validateReadonlyFlowWrites` 在 #4394 里刚走过的同一条路 —— 那次的教训是
  「一张 map、两个检查、两套命令集合」,这次是「一次 JSX parse、七个 rule id、
  一套命令集合」。

  规则行为零变化:id、严重级、文案都不动;喂进去的输入也不变(`os validate` 原本就
  传 `result.data`,suite 拿到的是同一个)。`#4402` 的接线守卫会在下一次有人想再手工
  接一条规则时直接报错。

  `validateReactPageProps` 沿用 `validateHookBodyWrites` / `validateActionBodyWrites`
  的惰性约定:只有真的存在 `kind:'react'` 页面时才加载 TypeScript 编译器。

- 7fec5d6: fix(lint,cli): `os lint` no longer passes a flow the other two commands refuse

  `validateReadonlyFlowWrites` was hand-wired into `os validate` and `os compile`
  and never into `os lint`. Measured on the showcase app with one planted
  violation — a `runAs:'user'` `update_record` writing a static-`readonly` field:

  |        | `os lint`           | `os validate`    |
  | ------ | ------------------- | ---------------- |
  | before | **exit 0 — passed** | exit 1 — refused |
  | after  | exit 1 — refused    | exit 1 — refused |

  That rule **gates** (a static `readonly` + literal field is a certain no-op:
  the engine strips it from the UPDATE payload while the step still reports
  success, #2948/#3425), so the divergence was not a missing warning — `os lint`
  green-lit a build `os validate` stops.

  It now joins `REFERENCE_INTEGRITY_RULES`, and both hand-wired call sites are
  deleted with it, so the three commands share one answer by construction rather
  than by three people remembering. This is the drift the suite was created to end
  (#3583 §5 D5) and which its own header cited this rule as the standing proof of.

  Two things made the wiring indefensible rather than merely untidy:

  - `validateFlowNodeWrites` (#4369) walks the **same** `config.fields` map to ask
    the other half of the question — "does this field exist?" against "is it
    writable?" — and is already a suite member. One map, two checks, two different
    command sets.
  - The two hand-wired sites did not even agree with each other on their input:
    `validate` passed the PRE-parse `normalized` stack, `compile` the POST-parse
    `result.data`. Verified equivalent for this rule before collapsing them onto
    the suite's post-parse input, so no finding is lost.

  No rule behaviour changes: same ids, same severities, same messages.

- 31e0be9: Flow metadata is canonicalized inside structured regions, not just at the top level (#4347).

  `registerFlow` canonicalizes a stored flow through three passes — the ADR-0087 conversion
  table, `FlowSchema.parse`, and the ADR-0032 predicate validation — and every one of them
  walked `flow.nodes` / `flow.edges` only. An ADR-0031 container keeps a whole sub-graph in
  its open `config` (`loop.config.body`, `parallel.config.branches[]`,
  `try_catch.config.try`/`.catch`), so all three stopped at the container and metadata came
  out **position-dependent**: the same node converted at the top level and did not one level
  in, and the same predicate was stored as a `{ dialect: 'cel', source }` envelope on a
  top-level edge and left a bare string on a loop-body edge.

  The reporting app shipped three sweeps whose gates never opened. Each run reported
  `success: true`, queried correctly, selected exactly the right records, and then did
  nothing — which is indistinguishable from "this sweep had no work to do" unless you assert
  on records written.

  - **`mapFlowNodes` recurses into regions**, to any depth. Every conversion in the table now
    reaches a nested node, which matters most for the two that change behaviour rather than
    spelling: a `webhook` / `http_request` callout inside a loop body kept a type no executor
    owns (the run failed), and a `delete_record` kept `config.filters`, leaving the canonical
    `filter` the executor reads absent — the erased-condition hazard
    `flow-node-crud-filter-alias` exists to prevent. Notice paths carry the region
    (`flows[0].nodes[3].config.body.nodes[1].config.filter`), so the warning points at the
    node to edit.
  - **New `normalizeControlFlowRegions`**, called at the load seam after
    `validateControlFlow`: each region is parsed through its own schema (recursively — regions
    nest), so nested edges and nodes carry the same canonical shapes as top-level ones. A
    region that does not parse is left untouched; rejecting one stays `validateControlFlow`'s
    job, so which flows register is unchanged.
  - **New `collectFlowGraphs`** yields a flow's own graph plus every nested region, each with
    a scope label. Both predicate validators iterate it instead of `flow.nodes` — the engine's
    `validateFlowExpressions` and `@objectstack/lint`'s author-time
    `validateStackExpressions` — so the `{record.x}` brace-trap they exist to catch is now
    caught inside a loop body too, naming the region (`loop 'sweep' body · edge 'b1' …`). It
    used to pass `objectstack validate`, pass registration, and fail at run time with the
    diagnostic suppressed.

  The container executors already parse their own config at run time (`parseNodeConfig`,
  #4277), so a nested predicate did evaluate correctly on current `main` — what was still
  wrong is everything that reads a region _without_ re-parsing it (the Studio designer,
  `getFlow`, the version history), and every conversion, none of which the executors replay.

  Also hardened, per the issue's secondary finding: `evaluateCondition`'s legacy `{var}`
  template path **refuses an unresolved dotted reference** instead of comparing it as a
  string. `'oppRecord.amount > 500000'` was compared `'oppRecord.amount' > '500000'` — `'o'`
  against `'5'` — so it was constantly true regardless of the amount: silently wrong in the
  _true_ direction, a gate that reports success while never gating. It now throws with the
  source and the fix (a CEL envelope, or brace the reference if the `{var}` dialect was
  meant), the same "never swallow a broken predicate" rule ADR-0032 §1c set for the CEL path.
  The `try { … } catch { return false }` around that block went with it: nothing in it throws,
  so it guarded nothing and would have swallowed the new refusal straight back into the silent
  wrong answer. Bare-word comparisons (`'{status} == active'`) and `{var}` templates are
  unchanged — only dotted references, which substitution can never leave behind, are refused.

- 4bfd455: One declaration of where ADR-0031 regions live (#4401).

  A region is a sub-graph inside `FlowNodeSchema.config`, an open `z.record`. Nothing in the
  type system says which key on which node type holds one, so every pass that needs to reach
  a region node has to be told — and within one week three of them were told separately, by
  two changes that were each correct on their own:

  | pass                                                                        | package | table it carried    |
  | --------------------------------------------------------------------------- | ------- | ------------------- |
  | `mapFlowNodes` (ADR-0087 conversions)                                       | `spec`  | `FLOW_REGION_SLOTS` |
  | `validateControlFlow` / `normalizeControlFlowRegions` / `collectFlowGraphs` | `spec`  | `regionSlotsOf`     |
  | `walkFlowNodes` (lint flow rules)                                           | `lint`  | `REGION_SLOTS`      |

  Each pinned its own copy with its own reconciliation test. So every copy was protected from
  drifting away from the schemas, and **nothing would have failed if the copies drifted from
  each other** — while adding a fourth construct meant editing three places, and missing one
  reproduces exactly the silent blind spot #4347 and #4380 were both filed about.

  - New `@objectstack/spec/automation` export `FLOW_REGION_SLOTS` (plus the
    `FLOW_REGION_SLOTS_BY_TYPE` / `FLOW_REGION_CONFIG_KEYS` views) is now the only statement
    of the fact. It lives in an **import-free** module so `spec/conversions/walk.ts` can read
    it and stay the pure shape walker it was written as; mapping a slot onto the Zod schema
    its value parses as stays in `control-flow.zod.ts`, which is schema business.
  - The three reconciliation tests collapse into one, `region-slots.test.ts`, keeping the
    strongest of them: it derives each construct's region keys **behaviourally**, by asking
    the config schema what it actually accepts in a region shape, rather than reading names
    off `.shape`. It also probes every other exported `*ConfigSchema`, so a new
    region-bearing construct cannot be added without either declaring its slots or failing
    here.

  The three **walks** are deliberately left separate. They take different inputs (parsed
  `FlowNodeParsed` vs raw authored records), yield different units (a graph, a node, a
  copy-on-write rewritten tree), and the lint one formats human diagnostic trails from node
  labels — consumer logic, not protocol (Prime Directive #2). Merging them would trade a
  duplicated four-line table for a walker that serves nobody well. Only the fact they all
  need is shared.

  No behaviour change: every existing test passes unchanged, which is the point of the
  exercise.

- 1bd2795: feat(spec,lint): the `ui` vocabularies admit what the renderers implement, and derive instead of restating (objectui#2945)

  Additions-only follow-up to the vocabulary audit
  (objectstack-ai/objectui#2901, #2945). Nothing here narrows a vocabulary, so no
  already-stored metadata changes meaning — three of the four `ui/` enums that had
  drifted from what is actually implemented, plus the fork that drift had made
  invisible.

  **`ChartTypeSchema` admits `combo`.** The taxonomy could not name the one chart
  family the rest of `chart.zod.ts` is written for: `ChartSeriesSchema.type`
  exists to override a series' type — its doc comment literally says _"combo
  charts"_ — and `ChartSeriesSchema.yAxis` binds a series to the left or right
  axis, which is only meaningful for mixed marks. objectui's renderer draws it
  distinctly (mixed bar/line/area on dual axes, per-series type) and had to carry
  `combo` in a local fork of this list, whose own comment claimed to mirror it.

  **`WidgetActionTypeSchema` is `ActionType`.** The two disagreed by one member,
  `form`, and the disagreement was backwards: a dashboard header or widget action
  button dispatches through the same `ActionRunner` that implements `form` —
  objectui's `DashboardRenderer` deliberately routes everything except a raw `url`
  into it, so a `flow` header action works (#3528). The narrower enum therefore
  rejected at validation exactly what the shared dispatcher then executes.
  Derived, so the next type the runner implements needs one edit, not two.

  **`ListChartConfigSchema.chartType` is `ChartTypeSchema.extract([...])`.** Same
  five members as before — a de-duplication, not a widening. A member renamed in
  the taxonomy now fails at build time instead of leaving a second list quietly
  disagreeing.

  **`@objectstack/lint`'s chart-family set is derived from the taxonomy.**
  `validate-widget-bindings` decides which widgets need a `chartConfig` measure
  mapping from a hand-written list of families, and its omissions fail in the
  worst direction: an unlisted family reads as _"not a chart"_, so a widget
  missing its mapping **passes** validation. `combo` was exactly that case —
  verified by pinning the old list back, where a `combo` widget with no
  `chartConfig` produced zero findings. The set is now the taxonomy minus an
  explicit `MEASURE_EXEMPT_CHART_TYPES` (single-value and tabular families), so a
  family added to the spec is covered without editing the rule.

  Guards: `packages/spec/src/ui/vocabulary-derivation.test.ts` asserts both
  derivations still hold (a restated list fails silently — it keeps validating,
  just not what the other list says), and the lint suite now walks every
  multi-series family in the taxonomy rather than a list of its own.

  A third ratchet already existed and did its job: `app-showcase`'s coverage test
  requires a gallery widget for every distinctly-renderable `ChartType`, and it
  failed the moment `combo` was admitted. The Chart Gallery dashboard now
  demonstrates it — a task count as bars on the left axis, an average as a line on
  the right, which is the configuration `series[].type` / `series[].yAxis` exist
  for.

  `ActionType` deliberately does **not** gain `navigation`, which the audit
  suggested. `ActionRunner.executeNavigation` is a strictly weaker
  `executeUrl` — no `${param.X}` interpolation, no `apiBase` promotion, no
  `openIn` — differing only by a `replace` option, and its one live producer is
  the SDUI `element:button` `action` prop, which `ElementButtonPropsSchema` does
  not model at all. Promoting the name would add a second spelling of _navigate_
  to a closed authorable vocabulary (members cannot be removed later) without
  closing the gap that actually exists. Tracked separately.

  Verified: `@objectstack/spec` **6944 tests / 267 files**, `@objectstack/lint`
  **544 tests / 37 files**, both green; `tsc --noEmit` clean on both.

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
- Updated dependencies [cc2de0e]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/sdui-parser@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 14252d3: feat(approvals): cross-organization approver targeting — a plant document can
  require a group-side sign-off (ADR-0105 D9)

  One organization id used to decide three different things at once in
  `openNodeRequest`: where the request row lives, where its inbox index rows
  live, and **where its approvers are looked up**. The first two are the
  request's own organization by definition. The third is not — a group CFO holds
  her `cfo` position in the GROUP organization while the purchase order she signs
  off lives in the PLANT organization. `expandPositionUsers('cfo', <plant>)`
  matched nobody, the slot fell back to the dead `position:cfo` literal, and a
  group escalation could not be expressed at all.

  An approver may now declare which organization's directory resolves it:

  ```yaml
  approvers:
    - { type: position, value: plant_manager, group: plant }
    - { type: position, value: cfo, organization: $root, group: finance }
  behavior: per_group
  ```

  - **`$root` / `$parent`** walk D6's `parent_organization_id` tree, so the two
    common intents need **no deployment knowledge** — flow metadata is portable
    across environments while organization ids are minted per deployment. A slug
    covers what the symbols cannot, notably a **sibling** organization (a
    shared-services centre approving payables for every plant).
  - Declared **per approver**, so one node can require a plant manager and a
    group CFO in parallel. A node-level form cannot express that without
    splitting into serial nodes, which changes the semantics.
  - **Bounded, not free:** the target must share a `parent_organization_id` root
    with the request's organization. The rule reads only the organization tree —
    never the submitter — so one flow routes identically for everyone.

  Everything else fails loudly rather than quietly:

  - a non-`group` posture **refuses** the declaration (a `group` → `isolated`
    migration must not silently reroute approvals);
  - an approver type with no org-scoped directory (`user` / `field` / `manager` /
    `team`) refuses it too, and a new `approval-approver-cross-org-unsupported`
    lint catches that at author time;
  - a targeted approver holding no membership in the request's organization is
    dropped with a warning naming them — D2's union wall would otherwise hide the
    request from someone already routed to, so the node's existing
    `onEmptyApprovers` policy takes over instead of leaving an unopenable task.

  Nothing changes for an approver without `organization`: same resolution, same
  queries, no extra reads.

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- e2616e0: feat(spec,lint)!: remove `agent.tools[]`, lint agent authoring, and resolve `action_<name>` only when it actually materialises (#3820, ADR-0109 accepted)

  **Breaking — `agent.tools[]` is removed.** ADR-0064's central invariant is
  "an agent's tool set is the union of its surface-compatible skills' tools;
  nothing falls through to the global registry", and this legacy inline slot
  was the one seam that broke it: the runtime resolved `agent.tools[].name`
  against the **full** tool registry with no surface check, so an `ask`-surface
  agent could name an authoring tool and get it. Removing the field makes the
  invariant structural — there is no second slot to disagree with the skills —
  rather than a rule every reader has to remember (ADR-0049 "design+enforce or
  remove"). `AIToolSchema` / the `AITool` type go with it.

  _Migration:_ attach capability through `skills`. An agent authoring `tools` is
  not a parse error — Zod strips the unknown key — so existing stacks keep
  parsing, but the slot no longer does anything.

  **`validate-ai-tool-references` now models AI exposure.** The rule previously
  resolved `action_<name>` against every declared action. The runtime is far
  stricter (ADR-0011): it materialises a tool only when the action opts in with
  `ai.exposed: true` + `ai.description` **and** has a headless path (type
  `script`/`api`/`flow` with a target or body — `url`/`modal`/`form` are
  UI-only). Resolving against all actions therefore blessed references the agent
  could never call — the exact failure the rule exists to catch. Unresolved
  `action_*` references now get their own message and fix, since "the action
  isn't exposed" and "the name is fictional" need different answers.

  **New rule `validate-ai-agent-authoring`** (`agent-authoring-withdrawn`,
  warning): flags a stack that declares `stack.agents`. Tenant/app-package
  agents were withdrawn in ADR-0063 §2 — the runtime filters them from the
  catalog and refuses to load them — but `defineStack` still accepted the array,
  so an app could ship agents that parse, validate, and never run. This is the
  authoring-time signal that was missing (ADR-0078: loud at the producer,
  tolerant at the consumer). Joins `REFERENCE_INTEGRITY_RULES`.

  ADR-0109 is now **Accepted — implemented (Phase 1)**, and the AI docs teach
  the zero-tool-record default path, including the three conditions that decide
  whether `action_<name>` exists and why a `modal` action staying human-driven
  is a design answer rather than a gap.

- 33f5e23: feat(lint): `validate-ai-surface-affinity` — skill ↔ agent surface affinity is now linted (#3820)

  An agent binds a product surface (`'ask'` | `'build'`, ADR-0063 §1) and a skill
  declares which surface it belongs to (`'ask'` | `'build'` | `'both'`, §3). The
  runtime refuses an incompatible binding with a **load error at chat time** —
  after parse, validate, and deploy all passed cleanly. The new rule reports that
  contradiction statically, and joins `REFERENCE_INTEGRITY_RULES`, so
  `objectstack validate`, `lint`, and `compile` all pick it up with no CLI
  changes.

  Scope is deliberately narrow (zero false positives by construction): only
  bindings where **both** the agent and the skill are declared in the same stack
  are checked. `agent.skills[]` names that don't resolve in-stack (kernel skills
  are runtime-registered and statically invisible) are skipped — resolving those
  namespaces is #3820 D0/D2, decided by ADR-0109 (Proposed).

  The spec side is doc-truth only, no schema shape changes:

  - `stack.agents` is documented as **platform-internal** (ADR-0063 §2 — the
    kernel ships exactly two agents; third parties extend via skills), replacing
    prose that still described the withdrawn ADR-0040 per-app-copilot model.
  - `stack.tools` is documented as declaration-only pending the ADR-0109 tool
    authoring model.
  - `app.defaultAgent` is re-documented as a surface-binding knob (`'ask'`
    implicit / `'build'` for authoring surfaces), not a custom-agent slot.
  - `SkillSchema` now states that a per-skill `permissions` field deliberately
    does not exist (ADR-0049) — authoring one is silently stripped; access is
    gated by `agent.access` / `agent.permissions` and per-tool authz.

- 259af21: feat(spec,lint): ADR-0109 Phase 1 — platform tool-name registry + advisory `skill.tools[]` reference lint (#3820 R7)

  ADR-0109 (revised) settles the AI tool authoring model: **the default
  third-party path needs no tool records at all.** A skill's `tools[]` names
  either a platform-registered tool or a tool the runtime materialises from the
  app's own declarative actions (`action_<name>`) — the executable, its authz,
  and its audit trail stay on the action/flow the app already ships. Tool
  records are demoted to an optional AI-presentation refinement layer (Phase 2,
  gated on acceptance).

  Phase 1, shipped here:

  - **`PLATFORM_PROVIDED_TOOL_NAMES`** (`@objectstack/spec/system`) — curated
    registry of every statically-named tool the cloud AI runtime registers,
    grouped by owning package, plus `PLATFORM_TOOL_FAMILY_PREFIXES` for the
    materialised `action_` family and `isPlatformProvidedToolName()`. The
    `PLATFORM_PROVIDED_OBJECT_NAMES` precedent, applied to tools; conformance
    tests live in the owning cloud packages.
  - **`validate-ai-tool-references`** (`@objectstack/lint`) — the #3820 R7
    `skill.tools` branch, wildcard-aware, resolving against declared
    `stack.tools` ∪ the registry ∪ the materialised action family. Severity
    **warning** (ADR-0078 advisory-first ratchet): the registry cannot see
    third-party runtime plugins. Joins `REFERENCE_INTEGRITY_RULES`, so
    `validate`, `lint`, and `compile` all pick it up. On the HotCRM corpus it
    reports exactly the 10 fictional tool references (0 false positives on the
    6 that resolve).
  - **`composeStacks` no longer drops `tools`** — the slot joins the
    concatenated array fields, so a declared record survives composition.
  - `stack.tools` / AI-slot docs updated to the ADR-0109 model.

- 474fe39: feat(approvals): declare approver value bindings; retire `queue` approver authoring (#3508)

  - `@objectstack/spec` exports `APPROVER_VALUE_BINDINGS` — the single declaration of how a
    designer must source each approver row's `value`: `user`/`team`/`department`/`position`
    are DATA-record lookups on the system directory objects (`sys_user` / `sys_team` /
    `sys_business_unit` / `sys_position`; `position` commits the machine **name**, the
    others the row id), `org_membership_level` is a closed enum (`ORG_MEMBERSHIP_LEVELS`),
    `manager` is auto-resolved, `field` names a trigger-object field, and `queue` is
    unsupported. Also exports `NON_AUTHORABLE_APPROVER_TYPES`.
  - `queue` approver type is deprecated-for-authoring: it still parses (stored flows keep
    loading and rendering) but is published in `xEnumDeprecated`, so designers stop
    offering it — the runtime has no queue resolution and the slot routes to nobody. The
    approver `value` xRef now also maps `manager`, so designers can render its
    auto-resolved state. No authored key is removed; nothing to migrate. If a flow carries
    `{ type: 'queue' }`, replace it with `team` / `department` / `position` (or a concrete
    `user`) until a real ownership-queue implementation lands.
  - `@objectstack/plugin-approvals` now warns at resolution time when a stored `queue`
    approver is skipped.
  - `@objectstack/lint` adds `approval-approver-type-unsupported` (warning) for approver
    types that are declared but not implemented by the runtime.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- b0e5a37: fix(lint,cli): a filter reference that cannot resolve fails the build, not the run (#3426, #3810)

  `validateFlowTemplatePaths` reported every `{record.<path>}` miss as **advisory**,
  on the reasoning that an unresolved token renders a blank and the run still
  completes. Since #3810 that reasoning no longer holds in one position: inside a
  CRUD node's `filter`, an unresolved token does not blank a value, it **deletes
  the condition** — and a removed condition matches MORE rows, not fewer. Those
  nodes now refuse to execute rather than run a widened query.

  So the rule was warning about metadata whose runtime is already decided: `os
validate` printed a yellow line, exited 0, and shipped a flow that cannot run.
  Severity now follows the runtime consequence, by position:

  - **`filter` of `get_record` / `update_record` / `delete_record` → `error`.**
    These are the three nodes whose filter `resolveNodeFilter` guards. The finding
    says what the runtime will do ("the node refuses to run at execution time")
    and why the build gates rather than warns (an absent condition _widens_ the
    query). `os validate` exits 1.
  - **Every other position → `warning`, unchanged.** A message body, an `http`
    url, an `update_record` write payload: the token still renders a blank, the
    run still completes, and the head object may legitimately come from another
    installed package. `create_record` is deliberately excluded from the gating
    set — it writes a payload and has no filter to widen.

  Both rules split this way (`flow-template-unknown-field` and
  `flow-template-lookup-traversal`), so a typo and a lookup hop are gated wherever
  the runtime refuses them. A reference used in both positions on one node is
  reported **once, at error severity**.

  **`os validate` now enforces it.** The command filtered this rule's findings for
  `severity === 'warning'` and dropped everything else on the floor, so an error
  from it would have been invisible. It now gates on errors first — printing rule
  id and config path, and emitting them under `errors` in `--json` — mirroring the
  `validateReadonlyFlowWrites` step directly below, which makes the same
  shift-left split (a certain runtime failure gates; a state-dependent one
  advises).

  Verified against the shipped examples: 33 flows across app-todo, app-crm and
  app-showcase produce **no new errors**; the four pre-existing lookup-traversal
  warnings sit in `script` / `notify` / `subflow` / `parallel` positions and keep
  their advisory severity.

  No authoring change is required for a correct filter. A filter that this rule
  now fails is one the runtime would have refused anyway — the difference is that
  you find out at `os validate` instead of at 3am.

- fd7cfde: fix(lint,cli): the flow-template-path rule reaches `os lint` and `os compile`, not just `os validate` (#3583, #3810)

  `validateFlowTemplatePaths` was wired by hand into `os validate` and nowhere
  else. That is precisely the drift `REFERENCE_INTEGRITY_RULES` exists to end
  (#3583 §5 D5): the same stack, checked by a different rule subset depending on
  which command the author happened to run.

  It mattered more after #3861 gave the rule a gating severity. A `{record.<path>}`
  token in a CRUD node's `filter` that names an unknown field — or hops through an
  un-expanded relation — makes the runtime **refuse the node** (#3810). `os
validate` failed on it; `os lint` and `os compile` did not look, so a CI job
  running either one would build and ship a flow that cannot execute.

  **The rule is now a suite member.** It belongs by the suite's own admission
  criterion: a `{record.<field>}` token is a name written in metadata, resolved
  against the bound object's declared fields. One line in
  `REFERENCE_INTEGRITY_RULES` reaches all three commands, and the hand-wiring in
  `validate.ts` is deleted rather than duplicated.

  Before landing this, the rule was run against all three stack shapes the suite
  is handed — raw `config` (`os lint`), `normalizeStackInput` output, and
  schema-parsed `result.data` (`os validate` / `os compile`) — across `app-todo`,
  `app-crm` and `app-showcase`. All three agree finding-for-finding, so moving the
  call site does not change what is reported.

  Verified end-to-end on `app-showcase`: all three commands pass unchanged on the
  real stack (the four pre-existing lookup-traversal warnings still print, still
  advisory), and with one filter token corrupted to `{record.idd}` **all three now
  exit 1** — where previously only `validate` did.

  **Also fixed, in the same file.** On a clean run, `os validate --json` never
  reported the reference-integrity suite's warnings: `refWarnings` was assembled,
  printed to the console, and included in the _failure_ payload, but omitted from
  the success-path `warnings` array. Adding the rule to the suite would have
  silently dropped its warnings from `--json` for JSON consumers, so `refWarnings`
  now appears there — which also surfaces the other five rules' warnings that were
  being discarded. Same shape of bug as the dropped errors #3861 fixed: computed,
  then thrown away.

- 9bf4588: feat(lint): flag never-firing record trigger tokens at authoring time (#3427)

  New `flow-trigger-unknown-event` rule in `validateFlowTriggerReadiness`: a flow
  start node whose `triggerType` is record-lifecycle-shaped
  (`record-before|after-<op>`) but names an op the record-change trigger cannot map
  — e.g. a typo like `record-after-updated` — binds to the record-change trigger
  yet maps to no ObjectQL hook and never fires, with only a runtime warning. The
  rule surfaces that never-fire defect at `os validate` time. Warning severity;
  bare `record-<noun>` shapes (e.g. `record-change`) are out of scope.

- f022c4d: refactor(lint): one entry point for the reference-integrity suite (#3583 D5)

  Six rules that answer the same question — "does this name resolve to anything?"
  — were wired by hand into three CLI commands, so landing a rule meant editing
  `validate`, `lint` and `compile`, and forgetting one meant the same stack got a
  different verdict depending on which command the author ran.

  New public API on `@objectstack/lint`:

  - `validateReferenceIntegrity(stack)` — runs every reference-integrity rule and
    returns the concatenated findings.
  - `REFERENCE_INTEGRITY_RULES` — the ordered list behind it (`validateObjectReferences`,
    `validateActionNameRefs`, `validatePageFieldBindings`, `validateChartBindings`,
    `validateNavAccess`, `validateTranslationReferences`).
  - `ReferenceIntegrityFinding` / `ReferenceIntegrityRule` / `ReferenceIntegritySeverity`
    — one finding type instead of a six-way union.

  Adding a rule to that list reaches `validate`, `lint` and `compile` with no
  further wiring. The individual rule exports are unchanged, so nothing that
  imports them directly needs to move.

  Behaviour-preserving: identical findings on the three example apps (zero) and
  on the HotCRM corpus (24, unchanged per rule). `os doctor` is deliberately not
  converted — it runs only `validateWidgetBindings` and is an environment health
  check rather than an authoring gate.

- 2343099: feat(lint): translation-bundle reference integrity + option-key validation (#3583)

  The i18n gate only ever ran forward: `os i18n check` asks which keys the
  metadata expects that no bundle carries. Nothing asked the reverse — which keys
  a bundle carries that no metadata claims — even though the spec already names
  the answer (`TranslationDiffStatus 'redundant'`, `TranslationCoverageResult.redundantKeys`,
  both declared with no producer).

  That direction ships two failure modes, both found in the HotCRM audit: bundles
  keyed to fields an object no longer declares (a rename that left the translation
  behind), and select-option translations keyed by the option's **display label**
  or a variant spelling of its value (`direct-mail` for `direct_mail`, `planned`
  for `planning`). Neither breaks anything — which is the problem. The resolver
  finds nothing and renders the source string, so the screen looks translated and
  one field or one picklist value quietly does not.

  New rule `validateTranslationReferences` walks every bundle in
  `stack.translations` against the stack it ships with, wired into `os validate`,
  `os lint`, and `os compile`:

  | Key                                                                           | Must name                                                                          |
  | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | `objects.{object}`                                                            | an object this stack defines, or a platform object                                 |
  | `objects.{object}.fields.{field}`                                             | a field that object declares                                                       |
  | `objects.{object}.fields.{field}.options.{key}`                               | an option's stored `value`                                                         |
  | `objects.{object}._views` / `._actions` / `._sections` / `._actions.*.params` | a view `name` / bound action / `fieldGroups[].key` or named section / param `name` |
  | `apps.{app}` / `.navigation.{id}`                                             | an app `name` / navigation item `id`                                               |
  | `dashboards.{dash}` / `.widgets.{id}` / `.actions.{actionUrl}`                | dashboard `name` / widget `id` / header `actionUrl`                                |
  | `globalActions.{action}`                                                      | an action with no `objectName`                                                     |

  Every finding is a **warning** (`translation-target-unknown`,
  `translation-option-key-unknown`): an orphan key is inert, not broken, and the
  severity should say so. Diagnostics carry the declared names to choose from,
  name the stored value when a key turns out to be the display label, and suggest
  a namespace-segment match (`task` → `todo_task`) that edit distance alone misses.

  Cross-package objects follow the existing ladder: a registered platform object
  is skipped wholly (its fields are not visible from a stack lint), a
  platform-prefixed name no package registers is reported once on the object key,
  and the subtree is never half-checked. `messages`, `validationMessages`,
  `settings`, `settingsCommon` and `metadataForms` are deliberately not judged —
  their keys are owned by application code, plugins, and the platform's own
  metadata-type registry, so no enumerable universe exists to resolve against.

- f2b8ac9: Navigation reachability vs. granted access (issue #3583, assessment R5)

  `validate-nav-access` joins what an app's navigation exposes against
  `buildAccessMatrix` — the first lint consumer of the ADR-0090 D6 matrix, which
  previously only backed `os compile`'s snapshot gate. An object in the menu that
  no permission set grants read on renders as an entry and then fails
  permission-denied when opened: it works while you browse as an administrator
  (the platform's built-in `admin_full_access` carries a wildcard grant) and
  breaks for exactly the users the app ships permission sets for.

  Advisory severity — a grant can legitimately come from a permission set another
  installed package ships. Quiet by construction in three cases: platform-provided
  objects (their own packages grant them), stacks that declare no permission sets
  at all (permissions managed elsewhere, so flagging every entry says nothing),
  and any stack where a set carries a wildcard `objects: { '*': … }` grant — the
  shape `admin_full_access` itself uses, which the access matrix records under the
  literal key `*`.

  Wired into `os validate`, `os lint`, and `os compile`.

- 2a5f04a: `<ObjectChart>` aggregate result-column naming is now a contract, and its axis bindings are validated (issue #3701)

  Split out of #3583 Phase 2 (#3684), which extended ADR-0021 axis checking to
  report charts, list-view charts, and dataset-bound page chart components but had
  to leave the react `<ObjectChart>` block out: it is OBJECT-bound (`objectName` +
  an inline `aggregate`), `aggregate` existed in the contract only as the
  description string `'{ field, function, groupBy }'`, and nothing in the repo said
  what the aggregated result columns were called. Without that, `xAxis`/`yAxis` had
  nothing to resolve against, and guessing a convention would have manufactured
  false positives (ADR-0072 D1).

  **The convention, recorded rather than invented.** Every path that can serve an
  object-bound chart already agreed — the engine's structured-`groupBy` aggregate
  (whose alias objectui sets to `field || function`), the legacy analytics query
  (which remaps its measure key back to `field`), the client-side fallback, and the
  console's own chart-view wiring (`xAxisKey: groupBy`, `series[].dataKey: field`).
  `packages/spec/src/ui/chart-aggregate.ts` writes it down and exports it:

  - an object-bound aggregate returns rows keyed by the **raw field names** —
    `groupBy` for the category column, `field` for the value column, the literal
    `count` for a fieldless count, plus `<field>__comparison` under a comparison
    overlay;
  - `chartAggregateCategoryKey` / `chartAggregateValueKey` / `chartAggregateResultKeys`
    derive those columns so producers and checkers cannot re-derive them apart;
  - `ChartAggregateSchema` replaces the description string with a real Zod schema
    and rejects a non-`count` function with no `field` (which used to reach the
    renderer as `sum(undefined)` and render blank).

  This is the deliberate opposite of the dataset path, whose rows are keyed by the
  declared measure `name` (`sum_amount`) — the trap `chart-measure-unknown` catches.
  Only the dataset path has an author-chosen name to key by.

  **`<ObjectChart>`'s contract now names the props it actually reads.** The block
  consumes `xAxisKey` and `series[].dataKey`; `ChartConfig`'s `xAxis`/`yAxis`/`series`
  shapes reached it and were silently dropped, which ADR-0078 forbids. They are
  removed from the block's `dataProps`; `chartType`, `xAxisKey`, and `series` are
  declared in the React overlay where the other bindings live.

  **`validate-react-page-props` now reads attribute VALUES**, not just names, for
  `<ObjectChart>`:

  - `react-chart-field-unknown` (error) — `aggregate.field` / `aggregate.groupBy`
    naming a field the bound object does not declare;
  - `react-chart-aggregate-invalid` (error) — an unimplemented aggregation
    function, or a non-`count` function with nothing to aggregate;
  - `react-chart-axis-unknown` (error) — `xAxisKey` / `series[].dataKey` naming a
    column the aggregate does not return (including a dataset-style `sum_total`),
    or a category axis bound to the value column;
  - `react-chart-axis-inert` (warning) — the `xAxis` / `yAxis` shapes this block
    never reads.

  Value reading is opt-in per block and evaluates only static literals: a prop
  driven by React state or a variable, a usage carrying a `{...spread}`, a chart
  given inline `data`, and objects another package defines are all skipped
  silently — an unresolvable binding is not a wrong one.

- 4f740b0: `<ObjectChart>`'s author contract is the spec `ChartConfig` shape again (issue #3729)

  #3701 trimmed `xAxis`/`yAxis`/`series` out of the `<ObjectChart>` contract
  because the renderer read `xAxisKey`/`series[].dataKey` and silently dropped the
  ChartConfig shapes — an honest record of the runtime gap, not the target state.
  objectui#2880 closed the gap the other way round (the renderer now honors
  `ChartConfig` through one normalization boundary), so the contract follows the
  protocol again (ADR-0082 D1: the spec schema IS the protocol).

  **Contract.** `type`, `xAxis`, `yAxis`, `series`, `subtitle`, `showDataLabels`,
  `annotations` and `interaction` are published from `ChartConfigSchema`; the
  internal `chartType`/`xAxisKey`/`series[].dataKey` spellings leave the author
  contract. `annotations` and `interaction` gained the `.describe()` they never
  had, so the generated contract stops publishing bare `object[]` with no meaning.

  **The `type` exception.** `ChartConfig.type` is the chart family, but on any
  surface that flattens chart config into a props bag `type` is already the SDUI
  envelope's component discriminator — an author writing `type="bar"` used to
  replace `object-chart` and the block stopped resolving. The collision is created
  by the flattening and is resolved there (objectui's react-page wrapper), so the
  contract can publish `type` as the spec spells it. The contract generator's
  blanket `type` skip is now overridable by an explicit `dataProps` allow-list,
  since for this one block `type` is a real author prop.

  **Lint.** `validate-react-page-props` reads the axes in the spec spelling —
  `xAxis.field`, `yAxis[].field`, `series[].name` — and keeps accepting the
  internal spellings silently, because dashboards and the console's own chart-view
  wiring emit them. `react-chart-axis-inert` is retired: the props it warned about
  are honored now, so the warning would be false. The three binding-integrity
  rules from #3701 are unchanged.

  **Spec.** `chart-aggregate.ts` records the constraint the whole result-column
  convention rests on: an inline `aggregate` is SINGLE-MEASURE. Keying rows by the
  raw field name only works because there is exactly one measure to key; two
  measures over one field would collide, and resolving that needs an author-chosen
  name per measure — which is what a dataset is. Widening `ChartAggregateSchema`
  into a measures array would silently invalidate every axis binding these rules
  validate, so the boundary is now written down rather than left to be rediscovered.

  The chart taxonomy note is corrected too: grouped/stacked bar and stacked area
  are absent from `ChartTypeSchema` not because they render as their base chart,
  but because stacking is a property of the SERIES (`ChartSeries.stack`), not a
  chart family — one `bar` family plus a series stack group expresses all three.
  `ChartInteraction.zoom` is now marked declared-not-delivered in its own
  description rather than reading as shipped.

- 17749fc: Page-component field bindings and non-dashboard chart bindings (issue #3583, Phase 2)

  Two more reference-integrity rules from the #3583 assessment, both wired into
  `os validate`, `os lint`, and `os compile`.

  **`validate-page-field-bindings`** — `PageComponent.properties` is an untyped
  bag, so a highlights strip, KPI card, or details section can name a field the
  bound object does not have; the component silently skips it. Which object a
  component binds follows `dataSource.object` → `properties.object` → the page's
  `object`, so multi-object pages are checked per element. `record:related_list`
  resolves its columns/sort/filter against the **related** object and its
  add-picker against that picker's own object. Advisory (matching
  `FORM_FIELD_UNKNOWN`). Relationship paths, system fields, cross-package objects,
  and unregistered component types are skipped.

  **`validate-chart-bindings`** — extends ADR-0021 axis checking past dashboards to
  report charts (`report.chart` and `report.blocks[].chart`), list-view charts
  (`views[].list`, `views[].listViews.*`, `objects[].listViews.*`), and
  dataset-bound page chart components. An axis naming a raw field instead of a
  declared measure is an **error** (the series comes back empty); an axis naming a
  declared-but-unselected measure is a **warning**. The report shape needed its own
  handling: `ReportChartSchema` narrows `xAxis`/`yAxis` to bare strings, which the
  dashboard rule's array guard skips silently. The react `<ObjectChart>` block is
  object-bound, not dataset-bound, and is deliberately left out — nothing defines
  what its aggregate names the result column.

  **Fixes:** the page walk used by `validate-action-name-refs` read a top-level
  `page.components` array, which `PageSchema` does not have — components live under
  `regions[].components[]` and `slots`, and sub-trees nest inside the untyped
  `properties` bag (`children`, `items[].children`, `body`, `footer`) rather than a
  `children` key on the component. The rule was therefore visiting nothing on a
  schema-parsed stack. Traversal now lives in one shared, tested module; on the
  showcase app it reaches 194 components where the previous shape found 46.
  Source-authored pages (`kind: 'html' | 'react' | 'jsx'`) are skipped — their
  `regions` hold a derived cache the `source` wins over.

- 4340f13: feat(lint,cli): flag flow `update_record` writes to readonly fields at design time (#3425)

  A flow `update_record` node that writes a field the target object declares
  `readonly: true`, under the default `runAs: 'user'` identity, is a **silent
  no-op**: the objectql engine strips static-`readonly` fields from a non-system
  UPDATE payload (#2948), so the intended write never lands — yet the step still
  reports `success`. #3407/#3413 surfaced the strip as a run-time step warning;
  this moves the discovery **left** to `os validate` / `os build` so an author
  finds the mismatch at design time instead of by reading server WARN logs days
  later.

  - New `@objectstack/lint` rule `validateReadonlyFlowWrites(stack)` — a pure
    `(stack) => Finding[]` check (ADR-0019). A static `readonly:true` field
    written by a literal `update_record` under `runAs !== 'system'` is a
    100%-certain no-op → **error** (gates the build). A `readonlyWhen` field is
    per-record-state → **warning** (advisory). Deliberately narrow to stay
    false-positive-free: `create_record` (INSERT is engine-exempt from the strip),
    `runAs: 'system'` flows (the intended "automation maintains it" channel),
    templated object names, and non-literal `fields` maps are all skipped.
  - Wired into `os validate` and `os compile`/`os build`, mirroring the existing
    security-posture gate (errors fail; advisories print dimmed).

  The formal contract, unchanged in behavior: `readonly` governs the end-user /
  API surface (REST/UI and `runAs:'user'` flows strip it); trusted system writers
  (`runAs:'system'`, system hooks, seeds) maintain it. To let a flow maintain a
  readonly field, declare `runAs: 'system'`.

- f163028: Reference-integrity validation for object and action names (issue #3583)

  A HotCRM audit found ~20 shipped instances of one bug class — metadata naming
  something that does not exist — all passing `objectstack validate` / `lint`
  cleanly and failing silently at runtime. This closes the object-name and
  action-name half of that class.

  **New — `@objectstack/spec`:** `PLATFORM_PROVIDED_OBJECT_NAMES`, a curated
  registry of every object name contributed by a platform package, official
  plugin, or the cloud runtime, plus `isPlatformProvidedObjectName()` and
  `hasPlatformObjectPrefix()`. This replaces the `startsWith('sys_')` prefix guess
  that could not tell `sys_user` (real) from `sys_approval_process` (fictional —
  removed by ADR-0019, registered by nothing), which is why every fictional
  platform-prefixed reference shipped. A conformance test scans each package's
  `*.object.ts` declarations and fails if the registry drifts.

  **New lint rules** (wired into both `os validate` and `os lint`):

  - `validate-object-references` — action-param `reference` / `objectOverride`,
    dashboard `globalFilters[].optionsFrom.object`, and navigation
    `requiresObject` gates. Severity follows resolvability: an unresolved
    _unprefixed_ name is a typo (**error** — `object: 'user'` where the platform
    object is `sys_user`); an unresolved _platform-prefixed_ name is **advisory**,
    since a third-party package may still provide it.
  - `validate-action-name-refs` — the surfaces that bind an action BY NAME:
    list-view `bulkActions` / `rowActions`, page `record:quick_actions`
    `actionNames`, and nav action items. A name matching no defined action is an
    **error** (the button renders and does nothing), matching the existing
    dashboard-action-target rule.

  **Fixes:**

  - `defineStack` cross-reference validation now walks `app.areas[].navigation` —
    an areas-based app previously got no navigation checking at all — and recurses
    into `children` on `object` nav items, not only `group` ones.
  - `os lint` i18n coverage now reads field `options` in the canonical
    `{value,label}[]` array shape; it only handled the record map, so option-label
    coverage silently never fired for canonically-shaped select fields.
  - Hook `condition` expressions are now field-checked when `object` is an ARRAY
    of targets (previously only a single string target was checked, so a
    multi-target hook filtering on a nonexistent field passed clean). Per-target
    diagnostics are de-duplicated.
  - A dashboard widget binding no `dataset` at all is now reported instead of
    silently bypassing every binding and chart check on the raw-config
    (`lint`/`doctor`) paths. `dataset` is schema-required, so this matches what
    the parsed paths already enforce.

### Patch Changes

- 1bd5652: feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
  `delegated_admin` org role, capped so it cannot mint authority (#3697)

  D8 authorizes invitation _placement_ against the issuer's `adminScope`
  (ADR-0090 D12), so a delegated plant admin may invite only into their own
  subtree. That gate is implemented, unit-proven and reachable — but no principal
  could reach it in a state where it did anything:

  - better-auth grants `invitation: ["create"]` to `owner` and `admin` only
    (`memberAc` holds `invitation: []`, which every other registered role
    inherits);
  - under a wall-enforcing posture, owners and admins are auto-elevated to
    `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
    `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
    short-circuits on tenant admins.

  The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
  wall (real, and correct) but never by `adminScope`, so D8's motivating story —
  "a plant admin invites into their own subtree without a platform admin
  finishing the job" — could not happen.

  **Two pieces, and they only ship together.**

  **1. The role.** `delegated_admin` is now registered with the organization
  plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
  membership grade that may reach `/organization/invite-member` without being an
  org admin. Deliberately _not_ `invitation: ["cancel"]`: better-auth's cancel
  route checks the permission with no inviterId attribution, so it would mean
  "cancel anyone's pending invitation in the org".

  The role carries no ObjectStack authority by construction — `mapMembershipRole`
  passes it through as a position name, and with no `sys_position_permission_set`
  binding that name resolves to nothing. Role = _can reach the endpoint_;
  `adminScope` = _what the endpoint permits_.

  `sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
  fourth option. Those selects are **enforced on write** — better-auth's own
  invitation and membership inserts are validated like any other row — so
  registering the role with the org plugin without listing it in both would have
  produced a role nobody could hold and nobody could hand out
  (`ValidationError: role must be one of: owner, admin, member`). That is exactly
  how the end-to-end regression caught it, twice; neither unit test could. The
  three non-English translation bundles carry the English label for the new option
  until localized.

  **2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
  beside the D8 placement gate. Registering the role alone would have been a
  four-step privilege escalation: better-auth's only role-level cap on _what role
  you may invite someone as_ is its `creatorRole` check (default `owner`), which
  blocks inviting an **owner** but not an **admin** — and an accepted `admin`
  membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
  subtree-scoped delegate could have manufactured a tenant admin, with every
  existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
  acceptance-time membership write runs under better-auth's context, not the
  issuer's).

  The cap refuses an invitation whose role outranks the issuer's own, and
  restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
  because an app-registered role projects into `current_user.positions` and may be
  bound to permission sets, making it a capability channel too. A delegate's
  channel for capability is the invitation's _placement_ intent, which the D12
  gate allowlists position-by-position. The cap applies to every invitation,
  placement-carrying or not (the escalation is independent of placement), and
  fails closed: an issuer role that cannot be resolved confers nothing above a
  plain member.

  **What changes for deployments.** One new class of principal exists: members
  holding the `delegated_admin` org role, who can invite into the org — as
  `member` only, into the subtree their `adminScope` allows. It is opt-in twice
  over (someone must set the membership role _and_ grant an adminScope set), so a
  default deployment changes not at all. Org owners and admins are unaffected.

  Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
  console and control-plane surfaces name the role from one place.

- 9dcc0ae: fix(automation): array-form flow `triggerType` fails loudly instead of silently never firing (#3481)

  An array `triggerType` on a flow start node — the shape an author (or an AI
  authoring pass) naturally reaches for to fire on more than one event, e.g.

  ```ts
  config: { objectName: 'app_task', triggerType: ['record-after-create', 'record-after-delete'] }
  ```

  was accepted everywhere and armed nowhere. Multi-event unions are deliberately
  unsupported (only the single tokens plus the `record-after-write` create-OR-update
  union exist — see #3457), but nothing said so: `defineFlow` passed the array
  (start-node `config` is an open record), the engine's `typeof === 'string'` check
  folded it to no trigger and misclassified the flow as **manual**, so it never
  entered the trigger-binding audit, and the flow-trigger-readiness lint used the
  same `typeof` narrowing and produced no finding. The flow bound to nothing and
  never fired, with zero output at any layer — the same silent-never-fire class as
  #3427 / #3472, and the last authoring shape still slipping past every guard.

  This is a **defensive** fix — arrays remain unsupported; they now fail loudly:

  - **lint** (`validate-flow-trigger-readiness`): an array `triggerType` containing
    any `record-*` element now yields a `flow-trigger-unknown-event` warning at
    `os validate` time, steering to `record-after-write` (for created-or-updated) or
    one flow per event.
  - **engine** (`resolveTriggerBinding`): such an array is routed to the
    `record_change` trigger — exactly as an unmappable single token is — instead of
    being folded to a manual flow, so it reaches the trigger's bind-time rejection.
  - **trigger** (`record-change`): the bind-time rejection detects the array shape
    and emits a targeted warning (naming the flow, pointing at `record-after-write`
    and #3457) rather than the generic unknown-token line.

- 5b89711: feat(spec,lint): freeze the `{current_user_id}` filter vocabulary and fail the build on unresolvable placeholders (#3574)

  A dashboard widget filtered on `{current_user}` rendered `0`. Not an error — a
  zero, indistinguishable from a metric that is legitimately empty, with nothing
  in the console or the server log. `service_dashboard.my_open_cases_by_priority`
  in the HotCRM template had shipped broken this way since the day it was
  written.

  The token had never been part of the contract. Date macros were frozen in
  `date-macros.zod.ts` with a spec vocabulary, a lint-usable predicate, and a
  single client resolver; `{current_user_id}` had only prose in an `app.zod.ts`
  JSDoc and three ad-hoc client implementations that each handled one surface's
  filter shape. Nothing could tell an author their token was wrong.

  - **`@objectstack/spec`** — new `data/context-tokens.zod.ts` freezing
    `CONTEXT_TOKENS` (`current_user_id`, `current_org_id`) as the sibling of
    `DATE_MACRO_TOKENS`, with `isContextToken` / `isKnownFilterToken` /
    `classifyFilterToken` and a `CONTEXT_TOKEN_SUGGESTIONS` near-miss table. The
    module documents what the tokens are _not_: presentation scope, never an
    access boundary — that is RLS, which uses the unrelated `current_user.id`
    expression root.
  - **`@objectstack/lint`** — new `validateFilterTokens` (rule
    `filter-token-unknown`, severity `error`). It walks `filter` / `filters` /
    `runtimeFilter` subtrees across dashboards, objects, views, reports,
    datasets, pages and apps, and reports any placeholder that resolves in
    neither vocabulary. It scans for filter _keys_ rather than enumerating known
    surfaces, so a new surface following the convention is covered the day it
    ships — enumerating surfaces is how the dashboard was missed in the first
    place. Navigation `recordId` / `params` are deliberately out of scope: they
    resolve `AppContextSelector` ids, which are meaningless in a filter.
  - **`@objectstack/cli`** — the gate runs in `os validate` and `os compile`.

  It is an error rather than a warning because of who authors this metadata. An
  AI reads a query returning `0` as a correct answer and builds on it; its
  correction loop is author → validate → fix, so a diagnostic only reaches it if
  it can fail the build. The three spellings the suggestion table covers —
  `{current_user}`, `{user_id}`, `{organization_id}` — are each correct
  _somewhere else_ in the platform, which is exactly why authors reach for them.

  Also fixes a `ViewSchema` JSDoc example that documented `{user_id}`, a token
  that resolves nowhere.

- de9af8a: fix(automation,objectql): a filter that loses a condition must not run (#3810)

  Three related holes, all of which end in "the query matched rows the author
  excluded".

  **1. A flow filter could silently widen to match everything.**

  The flow template interpolator expresses "this token did not resolve" as
  `undefined`. In a message that renders as empty text — harmless. In a FILTER it
  removes the condition, and a removed condition matches MORE rows. When it was
  the only condition, `{ owner: '{record.ownr}' }` became `{}`, and `{}` handed to
  `deleteMany` is every row in the table.

  So one mistyped field name in a `delete_record` node silently emptied the
  object. Reproduced with all four causes: a typo (`{record.ownr}`), an input the
  run never received, a lookup hop (`{record.account.name}` — the trigger record
  carries a scalar id), and a filter placeholder.

  `get_record` / `update_record` / `delete_record` now refuse to execute when
  interpolation erased any authored condition, naming the offending template. The
  guard keys on LOSS, not emptiness: an author who deliberately wrote no filter is
  unaffected, and losing one of two conditions still fails, because widening from
  "my open records" to "all open records" is the same class of bug.

  **2. Filter placeholders never reached the engine that resolves them.**

  `config.filter` is where two `{…}` dialects meet — the flow template dialect
  (`{record.owner}`) and the filter placeholder dialect (`{current_year_start}`,
  `{current_user_id}`, resolved by `resolveFilterTokens()`). Evaluation order
  picked the winner by accident: the flow interpolator ran first, found no flow
  variable by that name, and erased it.

  `interpolateFilter()` hands that position back to the dialect that owns it — a
  whole-string token that no flow variable resolves and that IS a recognised
  placeholder passes through verbatim for the engine to expand. Flow variables
  keep precedence, so a template that works today cannot change meaning.

  **3. The engine resolved placeholders on reads but not on writes.**

  `resolveFilterTokens()` reached `find`/`findOne`/`count`/`aggregate` only. So
  the SAME filter selected different rows depending on the verb: `find({ owner:
'{current_user_id}' })` matched the signed-in user's rows, while
  `update`/`delete` compared the literal token text and matched none — a flow that
  previewed with one and acted with the other operated on two different row sets.
  This is the #3106 shape one layer down: the evaluator existed, only some call
  sites reached it.

  `update` and `delete` now resolve too, BEFORE the by-id fast path claims a
  scalar `where.id` (otherwise an unresolved `{current_user_id}` would be bound as
  the primary key itself). Caller options are never mutated.

- 5524f84: feat(automation): opt-in single-hop lookup expansion for record-change flow templates (#3475)

  A record-change flow can now declare `expand: ['<lookup_field>', …]` on its start
  node config so node templates resolve `{record.<lookup>.<field>}` (e.g.
  `{record.account.name}` in a notify title, closing the #3426 gap for lookups).

  The engine re-reads the declared relations AFTER identity resolution, as the
  run's OWN principal — `resolveRunDataContext` honors `runAs`, so a `runAs:'user'`
  run reads the referenced object as the **triggering user** (its RLS/FLS enforced)
  rather than system-elevated. This is what made expansion unsafe to do in the
  trigger's re-read (which has no resolved grants) and is why it lives in the
  engine (new `AutomationEngine.setRecordExpander`, bridged by the plugin to the
  same data engine the CRUD nodes use).

  Only the declared relation keys are grafted onto the run record, so bare lookup
  ids and `multiple` lookup arrays (#1872) on other relations — and the formula
  fields the trigger already hydrated — are untouched. Opt-in ⇒ zero cost when
  unused; best-effort ⇒ a re-read failure leaves the record unexpanded and never
  breaks the flow.

  The `os validate` lint rule `flow-template-lookup-traversal` (#3426/#3472) is now
  suppressed for a relation once the flow declares it in `config.expand`.

- 169b58a: fix(#3426): build-time warning for unresolvable flow template paths + guard the formula re-read

  Two follow-ups to #3426 (the formula/lookup `{record.<path>}` template gap that #3445 began closing).

  **Build-time signal (the issue's fallback ask).** `os validate` now flags a
  record-change flow node whose `{record.<path>}` template cannot resolve —
  turning the previous SILENT blank into an advisory warning. Two cases, via the
  new `@objectstack/lint` rule `validateFlowTemplatePaths`:

  - `flow-template-unknown-field` — `{record.<x>}` where `<x>` is neither a
    declared field nor a system column (a typo like `{record.full_naem}`).
  - `flow-template-lookup-traversal` — `{record.<lookup>.<field>}`, a cross-object
    hop the seeded record carries only as a scalar id (still unsupported; tracked
    on #3426).

  Deliberately quiet: formula fields, bare lookup ids, numeric indexes into
  `multiple` lookups (#1872), `json` sub-paths, and system columns are NOT flagged,
  and flows bound to an object this stack does not define are skipped (no schema to
  compare against).

  **Hydration re-read guards.** The `trigger-record-change` computed-field re-read
  (#3445) is now (a) skipped when the object declares no `formula` field — the only
  thing it adds — via the engine's optional `getObjectConfig`, and (b) memoized per
  write on the shared HookContext, so N flows on one written record share ONE
  re-read instead of N. Any uncertainty falls back to the prior unconditional
  re-read (correctness over the optimization).

- 7f4a8a1: fix(lint): flag every never-firing `record-`-prefixed trigger token, incl. `record-change` (#3427)

  Generalizes the `flow-trigger-unknown-event` rule: it now flags ANY `record-`-prefixed
  `triggerType` that is not a valid firing token
  (`record-{before,after}-{create,insert,update,delete,write}`) — not just
  `record-(before|after)-<bad-op>` typos. This closes the `record-change` trap: the
  engine routes `record-change` ("Record changed (any)") to the record-change trigger,
  which maps it to no hook so it never fires — now caught at `os validate` time instead
  of only a runtime warn. Also covers bad-phase tokens like `record-during-update`.
  Warning severity, unchanged.

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

- 29ff3c2: feat(lint): warn on replay-unsafe `mode: 'insert'` seed datasets (#3434 follow-up)

  Seeds are replayed — they re-load on every dev-server boot and every package
  re-publish, not applied once — so `mode: 'insert'` (the loader's one mode with
  no existing-row check) duplicates its table on every restart. That footgun
  shipped undetected until #3434 (showcase memberships grew 3 → 6 → 9).

  Adds `validateSeedReplaySafety` to `@objectstack/lint` (a pure `(stack) => Finding[]`
  rule, ADR-0019) and wires it into `os validate` / `os lint`. Every `data[]` seed
  declared with `mode: 'insert'` now gets an advisory warning that points at the
  idempotent modes (`ignore` / `upsert`) and the `externalId` to match on — a
  single natural-key field, or a COMPOSITE list of fields for a join / junction
  table with no single key (`['team', 'project']`, the support #3434 added). It
  catches the mistake at authoring time instead of on the second boot.

- 95829a0: feat(lint): warn on seed values outside an object's declared state machine (#3433 follow-up)

  #3433 exempts seed writes from the `state_machine` validation rule, so a seeded
  status the FSM does not declare is no longer rejected at write time. A field-level
  `select` still catches a value outside its `options`, but a `state_machine` on a
  free-text field — or a value that is a valid option yet not a declared FSM state —
  now sails through silently: the exemption is a deliberate but blind back door.

  `validateSeedStateMachine` (a pure `(stack) => Finding[]` rule, run from
  `os validate` / `os lint`, symmetric with the replay-safety rule from #3434)
  re-adds that safety net at author time. It flags any seed record whose
  `state_machine`-governed field carries a value outside the machine's declared
  states — the union of `initialStates`, the transition-map keys, and the transition
  targets. Advisory (`warning`): the exemption itself is legitimate, so the fix-it
  points at either adding the state to the machine or correcting the typo, not a hard
  build failure. New rule id: `seed-value-outside-state-machine`.

- 57bab76: Typed `decisionOutputs` declarations (#3447 follow-up). A `decisionOutputs` entry may now be `{ key, label?, type: 'text' | 'user' | 'department' | 'position' | 'team', multiple? }` alongside the bare-string form — a typed entry tells the decision UI to render the matching record picker (id values; `multiple` collects an id array) instead of free text, turning "paste user ids" into "pick people". The type shapes only the input widget: the runtime whitelist works by `key` either way, via the new `normalizeDecisionOutputs` helper exported from `@objectstack/spec/automation` — the single reader of the union shape shared by the service, the request read, and `os lint`. The request read now carries `decision_output_defs` (normalized declarations) alongside the version-skew-safe `decision_outputs` key list.
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
  - @objectstack/formula@17.0.0-rc.0
  - @objectstack/sdui-parser@17.0.0-rc.0

## 16.1.0

### Minor Changes

- fa006fb: Validate dashboard filter field-existence at build time (extend ADR-0021, #3365).

  `validateWidgetBindings` now checks that every dashboard-level filter (`dateRange`

  - each `globalFilters[]`) resolves to a real field on each bound widget's dataset
    object. Since #2501 wired these filters into every widget's analytics query, a
    filter field absent on a widget's object — e.g. a `dateRange` bound to
    `close_date` inherited by an account/contact widget over a different object —
    emitted invalid SQL (`no such column: close_date`) and crashed the widget at
    render time. That build-decidable invariant previously escaped `os validate` /
    `os build` and failed only when a user opened the dashboard.

  It now fails the build (new rule `dashboard-filter-field-unknown`) with a message
  naming the dashboard, widget, filter, field, and object, unless the widget opts
  out via `filterBindings: { <name>: false }` or re-targets to an existing field —
  mirroring the field-existence invariant ADR-0032 enforces for CEL references.
  Effective-field resolution matches the runtime (`filterBindings` re-target /
  opt-out, legacy `targetWidgets` allow-list, filter default). Registry-injected
  system fields (e.g. `created_at`, the `dateRange` default) and objects outside
  the validated stack never false-positive.

- db160dd: Flag dead action/route references in dashboard header & widget actions (ADR-0049 for references, #3367).

  `os validate` / `os build` now run a new `validateDashboardActionRefs` gate over every dashboard `header.actions[]` and widget `actionUrl`:

  - `actionType: 'script' | 'modal'` — **error** unless `actionUrl` resolves to a defined action (`stack.actions` or an object's `actions`). `modal` also resolves via the runtime `<verb>_<object>` convention (`create_/new_/add_/edit_/update_` + a real object) and bare object names. A dangling target ships a button that renders and silently does nothing on click — a false affordance, exactly the "declared ≠ enforced" gap ADR-0049 closes, applied to references.
  - `actionType: 'url'` — **warning** when a relative in-app path names a `objects/reports/dashboards/pages/views` route whose target does not exist in the stack. External URLs, interpolated (`${…}`) targets, and opaque routes are skipped to keep false positives near zero.

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/sdui-parser@16.1.0

## 16.0.0

### Minor Changes

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

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

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/formula@16.0.0
  - @objectstack/sdui-parser@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/sdui-parser@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 3a18b60: feat(approvals): rename the `role` approver type to `org_membership_level` (#3133)

  `ApproverType.role` was the last platform surface projecting the reserved word
  "role" (ADR-0090 D3). It is not covered by D3's better-auth exception: that
  exception protects better-auth's own `sys_member.role` **column**, which we do
  not own — `ApproverType` is our own enum, an authoring surface, and D3 mandates
  that the projection of that concept is spelled `org_membership_level` and
  labelled "organization membership", **never "role"**.

  The sentence licensing the leak was also false: ADR-0090 D3 claims
  `sys_member.role` is "already relabelled `org_membership_level` in the platform
  projection", but `org_membership_level` existed nowhere in the codebase and
  ADR-0057 D7 lists that relabel under "Deferred (evidence-gated, P4)". The
  projection never landed, so the word reached authors.

  The name manufactured a real, silent failure — "hotcrm class": every other
  surface renamed to `position` (`sys_role`, `ShareRecipientType.role`,
  `ctx.roles[]`), so `{ type: 'role', value: 'sales_manager' }` reads as the
  legacy spelling of a position. It resolves against the membership tier, finds
  no member row, falls back to an inert `role:sales_manager` literal, and the
  request waits forever on an approver that cannot exist.

  - **spec**: `ApproverType` gains `org_membership_level`; `role` stays as a
    deprecated alias for one window (a published 15.x flow keeps loading) with
    `DEPRECATED_APPROVER_TYPES` + `canonicalApproverType()` as the single source
    for the mapping. Removed in the next major.
  - **plugin-approvals**: resolves on the canonical type and warns on the
    deprecated spelling. The `type:value` fallback literal keeps the **authored**
    spelling — stored `sys_approval_approver` rows and `pending_approvers` slots
    from 15.x carry `role:<v>`, and rewriting it would orphan them.
  - **lint**: `approval-role-not-membership-tier` → `approval-approver-not-membership-tier`
    (the rule id carried the reserved word too), plus a new
    `approval-approver-type-deprecated`. The two are mutually exclusive: a bad
    _value_ wins, because prescribing `org_membership_level` for a position name
    would be wrong advice — the fix there is `position`.

  Authoring `type: 'role'` keeps working and now says so out loud. Rewrite it as
  `org_membership_level`; if the value is an org position, the fix is `position`.

- 2ea08ee: Flow trigger observability — kill the four-layer silence around record-change flows that never fire (2026-07-17 third-party eval).

  A misauthored auto-launched flow (wrong `objectName`, missing `requires: ['automation','triggers']`, failing start condition) produced ZERO output at every layer: the engine's own registration/binding logs land inside the CLI's boot-quiet stdout window (which swallows debug/info/warn — only error/fatal reach stderr), and each "didn't happen" path was itself silent. Fixes:

  - **Startup banner `Flows:` section** (`os serve`/`os dev`/`os start`): flow count, bound-to-trigger count, registered trigger types, draft count — plus loud `⚠` lines for flows declared with no automation engine enabled (`requires` missing), flows whose trigger type has no registered trigger, and bound record-change flows targeting an unknown object (dead binding). Printed after stdout is restored, so it is immune to the boot-quiet window.
  - **Trigger-fired run failures now log at ERROR** (stderr — always visible): the automation engine no longer drops the AutomationResult of a trigger-fired execution; condition-evaluation faults and node failures surface with the flow name. Condition-not-met skips stay at debug (high-frequency, intentional).
  - **`RecordChangeTrigger` probes object existence at bind time** and warns when a flow's `objectName` matches no registered object (exact-name matching), instead of silently arming a hook that can never fire.
  - **`kernel:bootstrapped` binding audit** in the automation plugin: warns per enabled-but-unbound triggered flow with the reason, and reports registered/bound/draft counts (`AutomationEngine.getTriggerBindingAudit()`, extended `getFlowRuntimeStates()` with `status`/`triggerType`/`object`).
  - **`os validate` flow-wiring advisories** (`@objectstack/lint` `validateFlowTriggerReadiness`): warns when a record-triggered flow targets an object the stack does not define, and when an auto-triggered flow's status is `draft` (authored or defaulted — draft flows still fire; declare `active` or `obsolete`).
  - Removed leftover boot-debug writes (`registerApp`/`AppPlugin`/`StandaloneStack`/`AuditPlugin` stderr noise) that previous debugging of this same silence had left behind.

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

- a2795f6: feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

  Time-relative business rules ("alert 60 days before a contract's `end_date`")
  could only be expressed as a `record_change` flow gated on a date-equality
  condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
  when the record _happens to change_, so it fires only if a record is edited on
  exactly the threshold day — i.e. almost never, unattended. The robust
  alternative was a hand-written cron + range query that every author
  re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
  procurement `po_overdue`, …).

  A flow's start node can now declare a `timeRelative` descriptor instead:

  ```ts
  config: {
    timeRelative: {
      object: 'contracts',
      dateField: 'end_date',
      offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
      // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
      filter: { status: 'active' }, // optional, ANDed with the date window
    },
    schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
  }
  ```

  The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
  `TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
  flow **once per matching record**, with the record on the automation context —
  so the start-node `condition` gate and `{record.<field>}` interpolation work
  exactly as for a record-change flow. Because the window is evaluated every day,
  a threshold is never missed regardless of when the record last changed. The
  discovery query runs as a system operation (RLS-bypassing) and is capped
  (`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
  per-record failures are isolated so one bad row never aborts the sweep.

  The automation engine routes a start node carrying `config.timeRelative` to the
  `time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
  unchanged), and `os validate` gains readiness checks for the new descriptor
  (unknown swept object, ambiguous draft status). New authorable spec key:
  `TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).

### Patch Changes

- 524696a: feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

  The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
  undeclared top-level key instead of silently stripping it, moving a whole class
  of author error (a hallucinated or legacy key that renders as a silent no-op)
  from fallible human review to deterministic CI. `options: z.unknown()` remains
  the escape hatch for renderer-specific extras.

  A custom error map names the offending key(s) and, when a key is a removed
  pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
  `aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
  (`component`, inline `data`), points the author at the dataset shape
  (`dataset` + `dimensions` + `values`).

  Recorded as protocol-16 migration `step16`
  (`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
  strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
  itself was already removed at protocol 9 (single-form cutover), so there is no
  mechanical rewrite — the residue is the strictness, delegated to the author.

  **Breaking:** shipped as `minor` per the launch-window policy (a breaking change
  does not burn a major while the stack is in lockstep), riding the already-pending
  16.0.0 train. The release train's Version-Packages PR must set
  `PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
  (`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

  `@objectstack/lint` — the `widget-legacy-analytics-shape` /
  `widget-legacy-analytics-unrenderable` rules are retained as the friendly,
  suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
  the schema-parsed compile/validate paths); doc comment updated to explain the
  interplay.

- 8923843: Reject view containers that define no views. A flat list-view object (`{ name, label, type, columns, ... }`) parses to an empty `ViewSchema` container because Zod strips unknown keys — zero views register and the Console silently renders nothing. `defineView()` now throws on a zero-view container, and `os validate` gains a `view-container-shape` check (`validateViewContainers` in `@objectstack/lint`) that reports flat or empty `views: []` entries pre-parse with a wrap-it fix hint.
- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
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
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0
  - @objectstack/sdui-parser@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/sdui-parser@15.1.1

## 15.1.0

### Patch Changes

- f531a26: ADR-0085 #2548 follow-ups surfaced by the real-backend browser pass:

  - **lint**: new `field-group-shadowed` warning in `validate-semantic-roles` — a
    declared fieldGroup whose every visible member is hoisted into the detail
    highlight strip (or is the record title) renders on forms but silently never
    on detail pages (detail bodies hide the first 4 highlightFields). Warning
    tier, same as the other semantic-role rules.
  - **plugin-audit**: feed/audit summaries ("Created … / Deleted … / Updated …")
    now name the object by its display label ("Semantic Zoo") instead of its API
    name ("showcase_semantic_zoo") — these strings render verbatim in the record
    Discussion feed and Setup dashboards. Falls back to the API name when the
    object definition isn't resolvable. Existing stored rows are unchanged.

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
  - @objectstack/formula@15.1.0
  - @objectstack/sdui-parser@15.1.0

## 15.0.0

### Minor Changes

- 891ea81: ADR-0089 D3b: make the `visibility-root-mislayered` lint check bidirectional. `validateVisibilityPredicates` now accepts an optional `{ layer }` option — `'runtime'` (default, unchanged) flags a `data.`-rooted predicate on a `*.view.ts` / `*.page.ts` surface, and `'metadata'` flags a `record.`-rooted predicate on a `*.form.ts` metadata-editing form. Both directions of the ADR's binding-root rule are now covered. Adds the `VisibilityLayer` / `VisibilityOptions` exported types. Fully back-compat: existing single-argument callers keep the runtime behavior.
- e62c233: feat(spec,plugin-security): package-level capability declaration API (ADR-0066 D1)

  Packages can now DEFINE their own authorization capabilities explicitly via the
  new `defineCapability` factory and a stack's `capabilities` array, instead of
  relying on the implicit "derive an untitled capability from whatever a permission
  set references in `systemPermissions[]`" back-door.

  - `@objectstack/spec`: new `defineCapability` / `CapabilityDeclarationSchema`
    (`{ name, label?, description?, scope, packageId? }`) and a `capabilities`
    field on the stack definition.
  - `@objectstack/plugin-security`: new `bootstrapDeclaredCapabilities` seeds
    declared capabilities into `sys_capability` with `managed_by:'package'` +
    `package_id` provenance (new `package_id` field on the object). Idempotent,
    upgrade-aware; refuses to hijack curated platform capabilities or another
    package's rows, never clobbers admin-authored rows, and CLAIMS a pre-existing
    derived placeholder (upgrading it to package provenance). The implicit
    derive-from-`systemPermissions` path still runs for back-compat but now skips
    any explicitly-declared name so it can't clobber authored metadata.
  - `@objectstack/runtime`: stack-declared `capabilities` are registered into the
    metadata registry (type `capability`) so the boot seeder can read them.
  - `@objectstack/lint`: `validateCapabilityReferences` treats
    `stack.capabilities` names as a known capability source.

  A capability is not a contract: DEFINE it (`defineCapability`), GRANT it
  (`systemPermissions`), REQUIRE it (`requiredPermissions`) — no `inputs`.
  Aligns with ADR-0094 D5 (retire implicit `managed_by`-guessing back-doors).

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/formula@15.0.0
  - @objectstack/sdui-parser@15.0.0

## 14.8.0

### Minor Changes

- 10e8983: ADR-0089 D3b: add the `validateVisibilityPredicates` lint rule for conditional-visibility keys, wired into `os validate` and `os compile` as advisory warnings.

  Two rules, both `warning` (never fail the build):

  - `visibility-alias-deprecated` — a `visibleOn` (view form section/field) or `visibility` (page component) key in authored source. It still works — the schema normalizes it to `visibleWhen` at parse — but the canonical key is `visibleWhen`. Fix: rename the key (same CEL value).
  - `visibility-root-mislayered` — a runtime view/page visibility predicate rooted at `data.` (the metadata-editing-form root). Runtime record surfaces bind `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted predicate here never matches and the element renders unconditionally. Fix: use `record.`/`page.`.

  The rule runs on the **pre-parse** stack (like `validate-list-view-mode`) so it can see the deprecated alias the author actually wrote before the schema folds it into `visibleWhen`.

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/sdui-parser@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/sdui-parser@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/formula@14.6.0
  - @objectstack/sdui-parser@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/formula@14.5.0
  - @objectstack/sdui-parser@14.5.0

## 14.4.0

### Minor Changes

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

- 7449476: Permission-zoo audit follow-ups:

  **FLS keys must be object-qualified (`security-fls-unqualified-key`, error).**
  The runtime evaluator matches field-permission keys by `<object>.<field>`
  prefix — a bare `budget` key matches NOTHING and the declared masking
  silently never enforces. The showcase itself shipped exactly that bug: its
  contributor FLS block (bare `budget`/`spent`/`budget_remaining`) was a
  runtime no-op, and the "FLS proof" in earlier verification was actually a
  validation-rule rejection. Fixed: keys qualified
  (`showcase_project.budget` …), a new D7 lint rule rejects bare keys at
  compile time with a fix-it, and the permission-zoo dogfood now proves the
  served pipeline denies a contributor's budget write while allowing ordinary
  field edits.

  **Release pipeline: PROTOCOL_VERSION auto-sync.** `changeset version` now
  runs `scripts/sync-protocol-version.mjs`, regenerating the handshake
  constant from the spec package major. Release PRs opened by
  changesets/action with the default GITHUB_TOKEN never trigger CI (GitHub's
  anti-recursion rule), so the lockstep guard could only fire AFTER a release
  merged — the drift class that broke main at 14.0.0 (#2769) is now fixed at
  version time, the one spot that cannot be skipped.

  **D11 `externalSharingModel` honestly marked.** The dial has no runtime
  consumer yet (authoring lint + Studio badges only); its liveness entry
  moves from a bespoke `authorable` status to the documented `planned` +
  `authorWarn`, and the sharing docs / design doc / showcase comments now say
  explicitly that evaluation of external principals lands with the
  principal-taxonomy phase (#2696).

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/formula@14.4.0
  - @objectstack/sdui-parser@14.4.0

## 14.3.0

### Minor Changes

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/formula@14.3.0
  - @objectstack/sdui-parser@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/sdui-parser@14.2.0

## 14.1.0

### Minor Changes

- 5a8465f: SLA escalation `escalateTo` is position-first (ADR-0090 D3 follow-up to the `position` approver type).

  - **spec**: `ApprovalEscalationSchema.escalateTo` is documented as a position machine name or a
    specific user id (was "User id, role, or manager level" — the same pre-D3 'role' trap the
    `position` approver type fixed); the Studio xRef picker kind moves `role` → `position`.
  - **plugin-approvals**: on escalation, `escalateTo` now expands position holders via
    `sys_user_position` ∪ the `sys_member.role` transition source (ADR-0057 D4) for both the
    `reassign` approver hand-off and the `notify` audience. An empty expansion falls back to
    treating the value as a literal user id, so configs naming a specific user keep working
    unchanged. The audit trail keeps the authored target.
  - **lint**: new `approval-escalation-reassign-no-target` warning — `escalation.action: 'reassign'`
    with no `escalateTo` silently degrades to a notify at runtime; the fix-it prescribes a position
    or user id target (or `action: 'notify'`).

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/sdui-parser@14.1.0

## 14.0.0

### Minor Changes

- 216fa9a: Add a `position` approver type so approvals can route to org positions (ADR-0090 D3 fallout).

  Post ADR-0090 D3 the `role` approver type resolves against the better-auth org-membership
  tier (`sys_member.role`: `owner`/`admin`/`member`) — it was never a position. Downstream
  apps that authored `{ type: 'role', value: 'sales_manager' }` silently routed approvals to
  nobody. Now:

  - **spec**: `ApproverType` gains `'position'` — `value` is the position machine name; the
    approver expands to its holders via `sys_user_position`. Authoring guidance: keep
    `type: 'role'` ONLY for membership tiers; for org positions use
    `{ type: 'position', value: '<position_name>' }` (one-line fix for the mismatch above).
  - **plugin-approvals**: the engine resolves `position` approvers via `sys_user_position` ∪
    the `sys_member.role` transition source (same semantics as `PositionGraphService` in
    plugin-sharing). The `department` approver type is now honored by its spec spelling
    (previously only the off-spec `business_unit`/`bu` dialect matched).
  - **lint**: new `validateApprovalApprovers` rule — `approval-role-not-membership-tier`
    warns when a `role` approver's value is not a membership tier and prescribes the
    `position` rewrite; `approval-approver-type-unknown` flags off-spec approver types
    (with a `business_unit` → `department` fix-it). Wired into `os lint`.

### Patch Changes

- 2f3581f: feat(lint): warn when a master-detail child has no object-level CRUD grant (ADR-0090 D7)

  New security-posture rule `security-master-detail-ungranted` (advisory
  `warning`; it does not gate the build). A master-detail DETAIL object derives
  its RECORD-level access from the master (ADR-0055 `controlled_by_parent`,
  gate ②), but object-level CRUD is a SEPARATE gate ① (`checkObjectPermission`)
  that is never derived — a permission set that grants the parent but forgets the
  child denies role-bound non-admin users a 403 before the parent-derived access
  is ever consulted, surfacing as the silent "can't fill in / can't submit the
  subtable" trap (framework#2700, downstream os-tianshun-mtc#43).

  The rule flags a non-system detail (has a `master_detail` field) that NO
  authored permission set grants (explicit entry or `'*'` wildcard). It stays
  silent when the package authors no permission sets, when a package-declared
  `'*'` wildcard grant covers every object, or for `sys_*` / `isSystem` objects —
  keeping the false-positive rate near zero. The residual per-set gap (one role
  grants it, another forgets it) is intentionally out of scope, and CRUD
  auto-inheritance is deliberately NOT adopted (secure-by-default, Salesforce
  parity).

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/formula@14.0.0
  - @objectstack/sdui-parser@14.0.0

## 13.0.0

### Minor Changes

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

- a5a1e41: ADR-0090 P4 — explain engine (D6), access-matrix snapshot gate, recalibrated benchmark.

  **Explain contract (@objectstack/spec).** `ExplainRequestSchema` / `ExplainDecisionSchema` / `ExplainLayerSchema`: `explain(principal, object, operation)` reports the verdict of every evaluation-pipeline layer in order (principal → required_permissions → object_crud → fls → owd_baseline → depth → sharing → vama_bypass → rls), with per-layer contributor attribution (which permission set, reached via which position/baseline) and — for reads — the composed row filter as the machine artifact. Carries the D10 dual attribution (`principalKind`, `onBehalfOf`).

  **Explain engine (@objectstack/plugin-security).** `explainAccess` is "explained by construction": it calls the SAME permission-set resolution, evaluator, FLS mask, and RLS composition the enforcement middleware calls (injected from `SecurityPlugin`), so the report cannot drift from enforcement. Exposed on the `security` kernel service as `explain(request, callerContext)`; explaining another user requires `manage_users` (the target's context is reconstructed from `sys_user_position` / `sys_user_permission_set` with everyone-anchor semantics via `buildContextForUser`).

  **Access-matrix snapshot gate (@objectstack/lint + os compile).** `buildAccessMatrix(stack)` derives the (permission set × object) capability matrix purely from metadata; `diffAccessMatrix` renders semantic review lines ("'crm_admin' gains delete on 'crm_lead'", depth changes, OWD swings, entry add/remove). `os compile` gains an opt-in gate: with `access-matrix.json` committed next to the config, any drift fails the build with those lines until re-snapshotted via `--update-access-matrix` — every capability change becomes a reviewable diff. Seeded for `examples/app-crm`.

  **Benchmark (ADR-0090 Addendum).** `scripts/bench/permission-bench.mts` — single-org 10k users × 1M rows per the recalibrated topology; asserts the O()-shape property (per-request cost independent of user population; unit-depth IN-set cost tracks unit size). Passing at 0.1µs/eval and 59ms/1M-row IN-set scan.

- 466adf6: Author-time capability-reference lint (ADR-0066 ⑨) — `os validate` / `os lint`
  now warn when a `requiredPermissions` names a capability that is registered
  nowhere.

  `requiredPermissions` (on objects, fields, apps, actions) is a free string, so a
  typo like `mange_users` is schema-valid and fails closed at runtime (the caller
  is denied) — safe, but silent. The new `validateCapabilityReferences` rule
  (`@objectstack/lint`) resolves every reference against the author-time known set
  and warns on the unresolved ones:

  - built-in platform capabilities — now sourced from a single canonical list in
    `@objectstack/spec` (`security/capabilities.ts`: `PLATFORM_CAPABILITIES` /
    `PLATFORM_CAPABILITY_NAMES`), which `@objectstack/plugin-security`'s
    `bootstrapSystemCapabilities` also seeds from (one source of truth, no drift),
  - any capability a permission set in the stack grants via `systemPermissions`
    (granting is what declares it — mirrors the runtime derived-defaults rule), and
  - any `sys_capability` row shipped as seed data.

  It is a **warning**, not an error: a single package can't see capabilities
  declared by other installed packages, and the reference fails closed anyway.
  `systemPermissions` itself is never flagged — it is the declaration side, and a
  package legitimately introduces new capabilities there. The object case also
  understands the per-operation `requiredPermissions` map form (ADR-0066 ⑤) and
  points a finding at the exact operation slice.

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
  - @objectstack/formula@13.0.0
  - @objectstack/sdui-parser@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/sdui-parser@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/sdui-parser@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/sdui-parser@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/sdui-parser@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/sdui-parser@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/sdui-parser@12.1.0

## 12.0.0

### Minor Changes

- a8df396: feat(spec,lint): adaptive record surface + semantic field `span` for field-heavy objects (#2578)

  Field-heavy objects need two things the protocol did not express well: multi-column
  forms, and opening create/edit/detail as a full page rather than a cramped popup —
  for _some_ objects, automatically. Because all metadata is AI-authored, the design
  goal is to make AI unable to get it wrong, which reshaped both features away from
  new authored keys.

  **`deriveRecordSurface` (new spec derivation, ADR-0085 §5).** A record's default
  surface — full `page` vs `drawer`/`modal` overlay — is _derived_ from how heavy the
  record is (visible, non-system field count; mobile always pages), not authored. Per
  ADR-0085 §2's admission test a `recordSurface` object key would fail: field count is
  exactly the kind of fact a machine can infer, and modal-vs-page is pure
  re-arrangement, not a business fact. So there is **no new object key** and **no new
  ADR** — just a single shared derivation renderers consume as a default (an explicit
  form/navigation config still wins), plus a one-line clarification to ADR-0085 §2's
  rejected-keys list so `recordSurface` is not re-proposed. Explicit per-object control
  remains the sanctioned assigned-page path.

  **`FormField.span: 'auto' | 'full'` (new, replaces absolute `colSpan` as the
  primary primitive).** Under a per-surface derived column count (mobile 1 / modal 2 /
  page 3-4) an absolute `colSpan: 3` only lines up at the one width the author
  imagined — fragile by construction. The relative `span` is decoupled from the column
  count: `auto` (default; omit it) sizes by widget type × current columns, `full` takes
  the whole row at any count. `colSpan` is retained for back-compat and clamped by the
  renderer; `half` was considered and deferred (weakest AI-safety). The rationale lives
  here rather than in a new ADR, per the fewer-ADRs convention.

  **`validateFormLayout` (new lint, ADR-0078/0019).** Two advisory rules over authored
  form views: `form-field-unknown` (a section references a field not on the bound
  object — silently never renders) and `absolute-colspan-discouraged` (steers authors
  to `span: 'full'`). Both warnings, with fix hints, held to the same bar for AI and
  hand authors.

  **`NavigationConfig.size` (new) replaces pixel `width`.** A T-shirt bucket
  (`auto`/sm/md/lg/xl/full, default `auto`, aligned with `FormView.modalSize`) for a
  drawer/modal detail overlay. `width`/`drawerWidth` (pixel) are deprecated: a pixel
  width cannot be authored blind — the author (often an AI) does not know the client
  viewport. `auto` means the renderer derives the size from field count and clamps to
  the viewport, so AI writes nothing.

  All additive: no exports removed, no behavior change for existing metadata.

- e695fe0: feat(spec,lint): reject userFilters on object list views (ADR-0053 phase 4)

  ADR-0053 reserves `userFilters`/`quickFilters` for page lists ("filters" mode);
  on an object list view ("views" mode — where the `ViewTabBar` is the only nav
  control) they are silently dropped. This lands the phase-4 guardrail as a
  layered defence, so the wrong-context authoring mistake is caught without
  breaking existing metadata:

  - **Type-level (author time):** new `ObjectListViewSchema` = `ListViewSchema`
    minus `userFilters`. Object built-in `listViews` and `defineView`
    `list`/`listViews` now use it, so `userFilters` on an object list view is a
    `tsc` error. The full `ListViewSchema` (page "filters" mode) is untouched.
  - **Runtime (back-compat):** the field is STRIPPED at parse (default strip, no
    throw), so existing metadata keeps loading — `ObjectSchema.parse` never fails
    on a stray `userFilters`.
  - **Author/CI (actionable):** new `@objectstack/lint` rule
    `validateListViewMode`, wired into `os validate`, reports the wrong-context
    field PRE-parse (before the schema strips it) with a fix hint.

  Closes the schema half of objectui #2219; supersedes the interim runtime warn in
  objectui #2220.

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
  - @objectstack/formula@12.0.0
  - @objectstack/sdui-parser@12.0.0

## 11.10.0

### Patch Changes

- 996c548: Load Sucrase lazily in `validateReactPages` instead of at module top level — the same kernel boot-path contract applied to the TypeScript compiler in `validateReactPageProps` (framework#2544).

  `@objectstack/lint` sits on the kernel boot path, so the eager `import { transform } from 'sucrase'` made every boot parse ~1.5 MB of transpiler (~16 ms cold require) for a syntax gate that only runs when a `kind:'react'` page is actually validated — a rare, trusted-tier case. Sucrase now loads on the first validated react-source page via the same deferred-createRequire pattern; the public API stays synchronous and unchanged, `sucrase` stays a regular dependency, and if the package is missing at call time validation fails with an actionable error instead of killing boot.

  The boot-path guard test is generalized from `lazy-typescript.test.ts` to `lazy-deps.test.ts` and now covers both deps at all three levels (structural no-eager-import scan over src, child-process probes of both built dist formats, in-process lazy-load behavior) — verified to go red for each dep when its eager import is reintroduced.

- e82a495: Load the TypeScript compiler lazily in `validateReactPageProps` instead of at module top level (ADR-0081 Phase 2 follow-up).

  `@objectstack/lint` sits on the kernel boot path, so the eager `import ts from 'typescript'` (framework#2482) made every boot parse the ~9 MB compiler (~70 ms+ on a warm laptop, worse on container cold starts) for a gate that only runs when a `kind:'react'` page is actually validated — a rare, trusted-tier case. It also hard-crashed boot in deployments that prune the package from the image (cloud's Docker pruner did exactly that; worked around in cloud#728).

  - The compiler now loads on the first validated react-source page, via a deferred `createRequire` (same bundling-safe pattern as driver-sqlite-wasm's knex-wasm-dialect); the public API stays synchronous and unchanged.
  - Importing the package, and validating stacks with no react pages, no longer touches `typescript` at all — so images that prune it boot fine and only fail (with an actionable error naming the package and the fix) if a react-source page is actually validated.
  - `typescript` remains a regular dependency of `@objectstack/lint`.
  - Guarded by a three-level regression test (structural no-eager-import scan, child-process probes of both dist formats, in-process lazy-load behavior), verified to go red if the eager import is reintroduced.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/sdui-parser@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/sdui-parser@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/formula@11.8.0
- @objectstack/sdui-parser@11.8.0

## 11.7.0

### Minor Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/sdui-parser@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/sdui-parser@11.6.0

## 11.5.0

### Minor Changes

- 5a5bf61: ADR-0081 Phase 2: a build-time prop check for `kind:'react'` pages. After the
  syntax gate, `validateReactPageProps` parses the real JSX (TypeScript compiler)
  and checks each usage of an injected block (`<ObjectForm>`, `<ListView>`, …)
  against the react-tier contract (`REACT_BLOCKS` from `@objectstack/spec/ui`):
  missing a required binding (e.g. `<ObjectForm>` with no `objectName`) is an
  error; a near-miss prop (`onSucces` → `onSuccess`) is a warning. Wired into
  `os validate`. Curated data props are not flagged (low false-positive); a spread
  `{...props}` escapes the required check. (`typescript` moves to `@objectstack/lint`
  dependencies so it externalizes instead of bundling into the CLI.)
- ec7175d: Add the source-page styling guardrail (ADR-0065): `os validate`/`os build` now flags Tailwind `className` in `kind:'html'`/`kind:'react'` page source, which silently produces no CSS because the build never scans authored metadata. New `validatePageSourceStyling` rule with an actionable inline-style/`hsl(var(--token))` fix; also corrects the react-blocks contract, the objectstack-ui skill, the layout-dsl docs, and ADR-0080/0081 away from the "HTML + Tailwind" framing.

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/sdui-parser@11.5.0

## 11.4.0

### Minor Changes

- 5821c51: ADR-0081: split the AI page-authoring surface into honest tiers.

  - `PageSchema.kind` gains `'html'` and `'react'`. `'html'` is the constrained
    parse-never-execute tier (the renamed `'jsx'`, kept as a deprecated alias);
    `'react'` is the real-React tier (executed at render by
    `@object-ui/react-runtime`). It runs author JS, so it is gated by a host
    capability that **defaults ON** (the platform trusts reviewed, draft-gated
    authors) and is disabled **server-side** via the `OS_PAGE_REACT=off`
    env toggle. The completeness gate now requires `source` for all three kinds.
  - `@objectstack/cli` console serving injects the disable global into the served
    HTML when `OS_PAGE_REACT=off` (read per request, no rebuild).
  - `validate-jsx-pages` lints `html`/`jsx` (constrained parse). A new
    `validate-react-pages` transpiles `react` source with Sucrase (transpile-only,
    never executed) so syntax errors fail at `os build` instead of at render.

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/sdui-parser@11.4.0

## 11.3.0

### Minor Changes

- 58e8e31: feat(lint): ADR-0079 record-title gate — deprecate titleFormat + record-title validator

  A record's human title is a structural invariant (ADR-0079): every object
  resolves a primary title from a real STORED field via `nameField` (the
  canonical pointer; `displayNameField` is the deprecated alias) or a
  deterministic derivation. This adds build-time diagnostics so `os build` /
  `os lint`, the MCP authoring surface, and hand-authoring all get the coverage
  cloud graph-lint already has (the ADR-0078 "not cloud-only" principle):

  - `title-format-retired` — flags an object that declares a `titleFormat`. That
    key is a render-only template the server can neither return nor query;
    ADR-0079 retires it in favour of `nameField`. The schema still parses it
    (existing metadata keeps loading), so this is advisory, not an error.
  - `title-unresolvable` — flags an object whose title cannot be resolved from any
    stored field (`objectTitleCompleteness` reports `status: 'none'`).

  `@objectstack/spec` carries the `titleFormat` `.describe()` deprecation note;
  the `@objectstack/cli` `lint` command wires the new validator into its run.

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/sdui-parser@11.3.0

## 11.2.0

### Minor Changes

- 8ea1f4f: ADR-0080 M3b②: `os validate` / `os build` now parse `kind:'jsx'` page `source` via `@objectstack/sdui-parser` (new `validateJsxPages` lint rule) — malformed JSX fails loudly at author time (ADR-0078) instead of being stored and breaking only at render. Parse-level for now (syntax, tag matching, forbidden constructs like event handlers / dangerouslySetInnerHTML); full component/prop whitelist validation arrives once the registry manifest is threaded through `compile()`.
- 21c37d8: ADR-0080 M3b① (consumption seam): the `os build` / `os validate` JSX gate now does **full component/prop validation** (unknown component, missing/wrong prop, bad enum, bindings) when a `sdui.manifest.json` is present at the project root — falling back to parse-level otherwise. `validateJsxPages` accepts an optional manifest; the validate command loads the file when present. Generating + shipping that manifest from the registry's public tier remains a build/CI step.

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
- Updated dependencies [012c046]
  - @objectstack/spec@11.2.0
  - @objectstack/sdui-parser@11.2.0
  - @objectstack/formula@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

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
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0

## 10.3.0

### Minor Changes

- f75943a: feat(lint): SDUI styling validator (ADR-0065)

  `validateResponsiveStyles` — a pure `(stack) => Finding[]` rule wired into
  `os validate` and `os compile`, so hand-authored and AI-generated pages are
  held to the same bar (ADR-0019). Catches the deterministic ways a
  `responsiveStyles` block silently fails: a styled node with no `id` (CSS can't
  be scoped → dropped) is an **error**; warnings cover Tailwind-in-`className`
  (silently dead in metadata), a smaller breakpoint with no `large` base, unknown
  CSS properties, and unknown/typo'd design tokens. Quality/visual judgement
  (is it ugly) is out of scope — that needs render + a VLM gate.

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/formula@10.3.0

## 10.2.0

### Minor Changes

- 63f3219: feat(lint): extract static metadata validators into @objectstack/lint (ADR-0019 P3)

  New public package `@objectstack/lint` holds the pure, build-time metadata
  validators as `(stack) => Finding[]` functions, so the same rules run wherever a
  stack can be assembled — the CLI's `os validate`/`compile` and any other
  consumer (notably AI-driven authoring), instead of being trapped in CLI
  internals where only the CLI could reach them.

  First release moves the two validators the AI build needs:

  - `validateWidgetBindings` — dashboard widget → dataset → measure/dimension
    reference integrity + measure-aggregation coherence (ADR-0021).
  - `validateStackExpressions` — CEL/predicate validity for field conditionals,
    sharing rules, action visible/disabled, lifecycle hooks (ADR-0032).

  `@objectstack/cli` now imports both from `@objectstack/lint` (was `./utils/*`);
  pure move, no behavior change. Dependency direction is one-way `lint → spec`;
  the package never depends on a runtime and is never bundled into a frontend
  (that is why the validators do NOT live in the frontend-facing `@objectstack/spec`).

  Filesystem-coupled checks (`lint-liveness-properties`) and CLI-command-coupled
  ones (`score` → `lintConfig`) deliberately stay in the CLI for now; they can
  move in a later increment.

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/formula@10.2.0
