---
name: spec-property-retirement
description: >
  Internal playbook for retiring an authorable `packages/spec` property under
  ADR-0049 enforce-or-remove — choosing the removal route, the liveness-ledger
  discipline each route implies, the ADR-0087 conversion, the generated
  baselines, forms, docs and pin tests a removal needs, and the gates that fail
  when any of it is missing. Use when a metadata key is declared-but-unenforced
  and the job is to REMOVE it, or when a ledger `dead` verdict needs confirming
  before you act on it: "retire this property", "enforce-or-remove", "the ledger
  says dead", "remove the inert key", "close out the liveness worklist". NOT a
  customer-published skill — internal agent tooling (lives in .claude/, never in
  the published `skills/` dir).
metadata:
  # Hides this skill from interactive `npx skills add objectstack-ai/objectstack`
  # discovery, same as dogfood-verification. Enforced by
  # packages/create-objectstack/src/template-consistency.test.ts.
  internal: true
---

# Spec 属性退役(ADR-0049 enforce-or-remove)

被解析却不被强制执行的属性是静默 no-op;对安全或能力类属性,它是**假合规** ——
`tool.permissions` 承诺过一道没人强制的调用门,`flow.active: false` 从未停下过任何
flow。ADR-0049 说这样的属性必须**被强制执行**、标 **`experimental`**,或**不存在**。
本技能是第三条路:一次删除真正的代价是什么,按什么顺序付。

删掉键本身也许只占 5% 的工作。其余 95% 在于:一个键可以在 ~14 个地方被编写,而**守
着每个地方的门禁是分别地、串行地失败的** —— 一个过期面遮住其余全部,于是你得到的是
每个面一轮红构建,而不是一轮报出全部。

先读验证侧:`packages/spec/liveness/README.md`(裁定怎么得出、`verifiedAt`、为什么
preview renderer 不算消费者)与 AGENTS.md §"Touched `packages/spec`?"(八个生成产
物)。本文不重复它们。

## 0. 动手删之前:删除是正确的处置吗?

- [ ] **它是安全/能力形状的吗?** 那么 ADR-0049 约束成立,惰性是缺陷不是债。
      `rls.enabled` 曾是「证据错误的 live」而实际**无人读取** —— disabled 的
      policy 仍在贡献它的授权。那个键最后是**被强制执行**,不是被删除。功能存在时,
      强制执行赢。
- [ ] **它是文档形状的吗?** `hook.label`、`hook.description`、`flow.description`
      没有运行时消费者,但被**有意保留** —— 它们为下一个读者(按 ADR-0033,常是模
      型)记录意图。把豁免写进台账 `note`,下次审计不再重审。良性展示元数据
      (`description`、`tags`、`icon`)永远谈不上「误导」;不要标 `authorWarn`,也
      不要退役它。
- [ ] **有已承诺的路线图吗?** 那就是 `experimental` + `.describe()` 里的
      `[EXPERIMENTAL — not enforced]` 标记,不是删除。
- [ ] **同 major 记账。** 同一个*未发布 major* 里更早的 conversion 改名了你现在要删
      的键,就**吸收**它:把改名折进删除,删掉改名条目。二者复合后效果不可观测,而
      conversion 表的 fixture 不相交契约(§3)会因叠放而失败。先例:
      `agent.knowledge` 在发布前吞掉了 `topics`→`sources` 改名。

## 1. 裁判是构建,不是台账

台账的 `dead` 裁定是删除的**输入**,不能替代构建自己的证明。它是一条带时间戳的声
明,代码在它底下双向移动(`flow.status` 与 `action.undoable` 都被*低估*过)。

所以:**先尝试删除,让构建来裁。** #3896 收尾里,`view.form.data` 挂在工作清单上是
dead(「两个仓都没有 form 路径的读者」),而删除打断了 `gen:schema` —— `defineForm`
往每个 `*.form.ts` 写 `data: { provider: 'schema', schemaId }`,`metadata-protocol`
把它喂给 metadata-admin 管线。正确的回应**不是**硬删:把台账条目改回 `live`、附真实
证据与 `verifiedAt`,收窄 conversion,钉上 non-warn。十四个键里有一个是这样被证伪的
—— 给它留预算。

两条推论:

- **`tsc` 和门禁是你最好的清扫器。** `retiredKey()` 墓碑把键的类型定为 `never`,于
  是 monorepo 里*每个*编写点都编译失败。`examples/app-showcase` 三处
  `template: true` 里有两处是 grep 漏掉、墓碑找到的。让墓碑替你找调用者,再去人肉搜。
- **grep 只能证明存在。** 要证明不存在,要么手工闭合调用图(声明 → 注册 →
  accessor → *调用者*),要么编写该属性并启动应用。见 README 的 "How to verify a
  claim without fooling yourself" —— 包括 macOS 上 `git grep -E` 不认 `\b`。

## 2. 分叉:走哪条删除路线(决定下游一切)

| Schema | 路线 | 机制 |
|---|---|---|
| **非 `.strict()`** | `retiredKey()` 墓碑 | `packages/spec/src/shared/retired-key.ts` 的 `retiredKey(guidance)` —— `z.never({ error: () => guidance }).optional()`。两个通道:`tsc`(输入类型 `never`)与 parse(处方本身,不是 "unrecognized key")。 |
| **`.strict()`** | 删键 + guidance map | 从 shape 里删除;向某个 `*_RETIRED_KEY_GUIDANCE` record 加条目,由传给 `z.object(shape, { error: … }).strict()` 的 `z.core.$ZodErrorMap` 消费。参考:`packages/spec/src/ai/tool.zod.ts:29-93,180`。object 顶层键另见 `object.zod.ts` 的 `UNKNOWN_KEY_GUIDANCE`。 |
| **没人 parse 它** | 都不用 | 没人能收到的处方是噪音。有意删掉 baseline 行并在 changeset 里写明 —— 先例 #3896 与 #4834(PR #4878),都在 kernel plugin-runtime 家族。家族删除后幸存的解释块在 `packages/spec/src/kernel/index.ts`(搜 `plugin-runtime.zod`)。 |

永不从非 strict schema 上裸删一个键:zod 会静默剥掉它,你只是用一个静默 no-op 换了
另一个(#2169 "Mark Done does nothing" 的形状)。

### ⚠ 台账纪律按路线是相反的 —— 两种失败也不对称

liveness 门禁走的是 **schema 的 shape**,逐个属性去
`packages/spec/liveness/<type>.json` 里查。`retiredKey()` 在那个 shape 里仍是一个属
性。因此:

| 路线 | 键还在被走的 shape 里? | 它的台账条目 |
|---|---|---|
| `retiredKey()` 墓碑 | **在**(`z.never()` 是属性) | **保留** —— `status: "dead"`、一个 `verifiedAt`、一条 `note` 写明 REMOVED + 条目为何还在 |
| strict 删除 | 不在 | **删除**,连同 CLI advisory-lint 的预期 |

现在两个方向都会红 CI,搞反了两边都很响:

- 删掉**墓碑**键的行,报 **UNCLASSIFIED**(#3896 清扫一次 14 个 —— 本节就是防它);
- 留着 **strict 删除**键的行,报 **ORPHAN** 行。

orphan 这条腿是新的(`scripts/liveness/orphans.mts`)。它落地之前这个方向从不失败
—— 门禁走 schema 再查行,键已离开 shape 的行根本不会被问到,原地腐烂。report 的
`aria`/`performance` 行就这样比它们的键多活了一整个 release,靠有人恰好读到那个文件
才手工删掉。你撞上 orphan 报错而属性确实还可编写时,要修的是 **walk**,不是行:
walk 看不见的属性就是 ratchet 管不到的属性。

墓碑条目的 note 模板(house style 原文,如 `liveness/action.json`):

> `REMOVED <date> (#<issue>) — tombstoned at the schema (retiredKey carries the prescription; authoring it is a tsc error and a parse error) and stripped from sources by the protocol-<N> conversion. The entry stays because retiredKey keeps the key in the walked shape (the rls.priority precedent); <what to do instead>.`

### ⚠ 四张 ratchet 的可见性,按路线是**相反**的 —— 拿错对照就会判错

验收时最常问的一句是「四张 ratchet 零变化,正常吗?」。**答案完全取决于你走的是哪条
路线**,2026-08-03 一天内两种形态各实测到一例,正好互为对照:

| 退役形态 | `api-surface` / `authorable-surface` / `json-schema.manifest` / `api-surface-signatures` | 实例 |
|---|---|---|
| 枚举**值**收窄(def 还在,少一个 value) | **字节完全相同 —— 仪器上不可见** | #4391 `crypto.hash`(PR #4871) |
| 整 **def** 删除(schema 不再被 emit) | **必须变化** | #4834(PR #4878):`api-surface −12` / `authorable −23` / `manifest −5` |

为什么会这样:这四张 ratchet 记录的是**导出面与 def 的存在性**,不是 def 内部的取值
集合。枚举少一个 value,导出的名字、schema 的 key、def 的数量都没变,于是四张全都
一模一样。

后果是双向的,两边都很贵:

- 把「枚举值收窄」的零变化**判成异常** → 白折腾,以为 agent 漏做了生成物;
- 把「整 def 删除」的零变化**判成正常** → 放过一个**根本没真正删掉**的 def。

所以验收顺序是:**先确定路线,再决定该期待什么读数**,不要反过来用读数去猜路线。
整 def 删除还有一条自证信号:`json-schema.manifest/`(#5837 起按 category 分片)的
ratchet(#2978)会先开火,
要求你**有意删除**对应的 manifest key;删完重跑,per-key ratchet 会自行判定为 #4650
路径 3(`def no longer emitted by this build`)。这串输出本身就是路线的证据,留在 PR 里。

枚举值收窄既然对四张 ratchet 不可见,它的处方就只能挂在**枚举自己的 `error` map**
上、按 `issue.input` 分派(`packages/spec/src/data/hook-body.zod.ts` 的
`HookBodyCapability`,沿用 `object.managedBy: 'system'` 的先例)—— 三条路线里没有一条
适用于「def 存活、只少一个值」。

### guidance 字符串怎么写

五条惯例,树上 ~28 个墓碑全部遵守:

1. 反引号包着的**全限定**键打头 —— `` `flow.errorHandling.fallbackNodeId` ``,不是裸尾段。
2. `was removed in @objectstack/spec <version> (#issue[, ADR-XXXX Dn])`。
3. 一个破折号从句讲**它为何惰性或错误** —— "it never had an effect"、"no renderer ever read it"。
4. 祈使句修复:改名写 "use `<replacement>`" + "Rename the key; the value (…) is unchanged.";删除写 "Delete the key." + **真正生效的机制是什么**。
5. ``Run `os migrate meta --from <N-1>` to rewrite it automatically.`` —— **仅当**有 conversion 重写 sources。消息不点名 conversion id;conversion 由 CLI 命令引用。

这个字符串*就是*撞上它的人的迁移文档 —— 包括一次跳好几个 major、load-path
conversion 已不再覆盖的那位。

## 3. 注册面(ADR-0087 D2/D3)—— 否则门禁拦你

`scripts/build-schemas.ts` 的门 (b) 会打红任何没按**精确** `${defKey}:${name}` 注册
进 `RETIRED_KEYS_BY_MAJOR` 的新墓碑键:墓碑只对*撞上*它的人可闻,而
`spec-changes.json`、生成的 upgrade guide 与 `spec_changes` MCP 工具才是主通道,不
注册它们就一直空着。

⚠ **这是两个独立义务,其中只有一个是字符串匹配。** registry 条目是门禁读的;
conversion 是消费者跟的。两个都要写。

- [ ] **一条 `MetadataConversion`**,在 `packages/spec/src/conversions/registry.ts`:
      kebab-case 的 `id` 以 `-removed` 结尾、`toMajor`、每键一条
      `emit({ from, to: '(removed)', path })`(用共享的 `stripKeys` helper),以及一
      个 `fixture`,其 `expectedNotices` 等于**键**数,不是条目数。walker
      (`mapCollection`、`mapFlowNodes`、`renameKey`)住在 `conversions/walk.ts`,
      copy-on-write —— 没命中就原样返回输入引用。
- [ ] **一条 `RETIRED_KEYS_BY_MAJOR` 条目**,在
      `packages/spec/src/migrations/registry.ts` —— 字面 `'<defKey>:<name>'`,拼法照
      `authorable-surface/<category>.json`(去掉 `[RETIRED]` 标),挂在本 major 下。
      这就是门 (b) 按精确集合成员读的字符串;不做推断,也不从邻键辐射。门禁的失败输
      出会打印该粘贴的那一行。⚠ **不要**在墓碑落地前先加条目:点名一个还活着的键的
      条目,会以「无人消费的注册」打红门 (b2)。
      *为什么要第二张表:* #4659 之前门 (b) 拿键的**叶名**去比对每条已注册的
      `surface`(`endsWith('.' + name)`,全 major,def 忽略),于是 `dashboard.aria`
      注册中了 `ui/FormView:aria`,protocol 11 的 `flow.node.type` 注册中了任意
      `.type`(#4658)。对每个常见叶名,保证早已失效。
      *条目同时启动老化时钟(#5898):* 门 (c) 读同一张表来决定这个墓碑的
      `authorable-surface/` 行何时可删(~两个 major),所以你把它写在哪个 major 下,
      时钟就从那个 release 数起。比这张表更老的退役是**未申报的、因此不可删的** ——
      没有东西能诚实地给它们定日期(叶匹配曾把 `data/Index:type` 的日期从一个不相干
      的 `flow.node.type` 定到 major 11,而 baseline 文件自己的 git 历史始于
      17.0.0-rc.0)。要删那类行,先考证它真实的 major、补条目、在 PR 里写明。
      ⚠ 永不加一行你定不了日期的:这里的估计会被之后每个门当成事实读。
- [ ] **`surface` 保持散文 —— 它不再被匹配。** 按作者写元数据的方式写
      (`flow.nodes[].outputSchema`),那也是 upgrade guide 打印的。多键 conversion
      仍用恰好 `' / '` 连接子句(tool 清扫以来的 house style)。下游不再有任何东西
      从它解析归属 —— 那个职责移给了上面的条目。#5898 起这对**每个**消费者都成立:
      门 (c) 的 *aged-out tombstone* 证明曾是最后一个叶匹配者,现在也读同一张精确键
      表,再没有任何规则从 `surface` 解析归属。
- [ ] **`retiredFromLoadPath: true`** —— 退役恒真。两种论证,不可互换:对*改名*它意
      味着「没有 alias 窗口,故意的」(拒绝由墓碑负责;条目存在是为了
      `spec-changes.json` 与 `os migrate meta` 仍携带它);对**默认值翻转**它承重正
      确性 —— 自动应用 `field-required-notnull-explicit` 的 loader 会把 NOT NULL 盖
      到 17 时代编写的 `required: true` 上,静默恢复 ADR-0113 删掉的三重绑定。只有
      `migrate meta --from <old>` 可以应用翻转 —— 在那里「这份 source 早于拆分」是
      事实而不是猜测。
- [ ] **一步 D3 链**,在 `packages/spec/src/migrations/registry.ts` —— 把 id 加进
      `MIGRATIONS_BY_MAJOR[N].conversionIds`,扩写该步的 `rationale`。
      `conversion.toMajor` **必须等于**该步的 major。⚠ 没有东西直接断言「每个
      conversion 都接进了某一步」,拼错的 id 在 replay 时被**静默跳过**;
      chain-replay 测试抓得到它,只因为没接线的 fixture 永远到不了自己的 `after`。
      所以把那个测试的失败读作「没接线」,不是「transform 坏了」。
- [ ] **fixture 必须不相交 —— 两重。** 每个 fixture 都被整张表 replay,必须恰好等于
      自己的 `after`,每条 notice 都归属自己的 id。`before` 保持最小、避开其它条目
      的键(新的 `objects[].fields` fixture 不许带裸 `required: true`,否则 notNull
      conversion 在它上面开火)。第二重容易漏:`retiredFromLoadPath` 的 fixture 还必
      须不被任何 *live-window* conversion 碰到,因为另有测试断言它以零 notice 走过
      默认加载路径。这条不相交契约正是逼出同 major 吸收(§0)的东西。
- [ ] **幂等靠构造,不靠测试。** 没有测试把 conversion replay 两遍。`stripKeys` 删
      除天然幂等(`if (!(key in next)) continue`),`renameKey` 拒绝覆盖已存在的
      canonical 值;默认值翻转**不是**幂等安全的,靠它自己的守卫加
      `retiredFromLoadPath`。你的 transform 不属于这些形状,就自己证明幂等 —— CLI
      e2e(`packages/cli/test/migrate-meta.e2e.test.ts`)会 replay 迁移后的快照并断
      言 `applied` 为空。
- [ ] **没有 source 可重写的响应面键**,改注册成 `SemanticMigration`(D3
      `semantic[]`),`reason` 与 `acceptanceCriteria` 非空 ——
      `EnhancedApiError.fieldErrors` 是成品示例。

## 4. 面清单

从上往下做;每一行背后都有一个门。

- [ ] **Schema** —— 墓碑或 strict 删除(§2),外加 schema 内注释:删了什么、真正生
      效的机制是什么。
- [ ] **孤儿值 schema** —— 一个键的 `XxxConfigSchema` 没有别的消费者就随它一起走
      (`PerformanceConfigSchema`、`AIKnowledgeSchema`、`ToolCategorySchema`)。没有
      消费者的导出 schema 会被发现它的人读成能力(#3950 先例)。这 —— 且**只有**这
      —— 会动 `api-surface/`:那份快照打印的是类型*引用*,不是展开的 shape,对键级收
      窄全盲(#3883 从 `defineAction` 的输入删了三个键,快照没动)。它的门还住在另
      一个 workflow(`TypeScript Type Check`,不是 `Check Generated Artifacts`),读
      的是构建出的 `dist/*.d.ts`。
- [ ] **Conversion + 链步 + 精确键 `RETIRED_KEYS_BY_MAJOR` 条目**(§3)。
- [ ] **Liveness 台账** —— 按 §2 的路线表,带 `verifiedAt`。更新 README 的按类型行
      **连同计数**(那张表狠狠漂过一次;用 README 里的 python 片段重新生成计数,不
      要手改)。
- [ ] **生成 baseline** —— `pnpm --filter @objectstack/spec gen:schema` 会动
      `authorable-surface/<category>.json`(墓碑 → 一条新的 `… [RETIRED]` 行;
      strict 删除 → 该行**消失**,这是门 (a) 的绊线,所以同一个 PR 里有意删掉它)与
      `json-schema.manifest/<category>.json`。#5837 起两者都按 category 分片 —— 门
      禁把整个目录读成一个集合,退役流程不变;变的只是那一行住在哪个文件。然后
      `gen:spec-changes`、`gen:upgrade-guide`、`gen:api-surface`、`gen:docs`。
      「改了 X → 重新生成 Y」的表见 AGENTS.md。
- [ ] **Forms** —— 从 `packages/spec/src/**/*.form.ts` 剪掉 `{ field: '<key>' }` 输
      入。未强制能力的表单输入是假合规的 UI 半边。原位留一行注释。
- [ ] **i18n bundle** —— 剪掉表单输入会改变抽取出的标签:`pnpm i18n:extract` 重新生
      成 `packages/platform-objects/src/apps/translations/*.metadata-forms.generated.ts`
      (merge 模式;退役是纯删除)。由 `pnpm check:i18n` 把门。
- [ ] **CLI advisory lint** —— `packages/cli/src/utils/lint-liveness-properties.ts`
      是台账驱动的,退役键会自动停止告警;更新它的**测试**去断言 non-warn(「strict
      parse 现在接管它们」)。
- [ ] **Pin 测试** —— 一条阴性,断言处方本身
      (``.toThrow(/<key>.*removed.*use `<replacement>`/s)`` —— `s` 标志是 house
      style,因为消息跨行),一条阳性,对非 strict 剥除路径断言
      `not.toHaveProperty(key)`。参考 `packages/spec/src/ai/agent.test.ts:69-95`。
- [ ] **Examples** —— `examples/app-showcase/**` 必须停止编写该键。墓碑路线上
      `tsc` 替你找齐。
- [ ] **已发布 skills** —— 教这个键的 `skills/*/SKILL.md`(表格、`defineX` 示例)
      —— 由 `check:skill-examples` 与 `check:skill-refs` 把门。
- [ ] **Docs** —— `content/docs/**` 的散文、表格与代码块 —— **除了
      `content/docs/releases/`,代码 PR 永不碰它**(AGENTS.md Documentation
      Guardrails)。release notes 在发布时从 changesets + D2/D3 registry 集中编写;
      本清单曾要求的逐 PR 加行,把 `releases/v<major>.mdx` 变成了全仓最热的冲突磁
      铁。你的 changeset(下一项)才是通往它们的输入。`content/docs/**` 的其余部
      分:先 grep 键名,再读周边文件 —— 被删的键会藏在离参考表三节远的一个
      `defineFlow` 示例里。
- [ ] **Changeset** —— `@objectstack/spec` 用 `major`。AGENTS.md:breaking
      changeset 必须带 FROM → TO 映射与一行修复;它作为 npm 包里的 `CHANGELOG.md`
      发出,是升级中的 agent 撞上墓碑报错后 grep 的东西。
      `.changeset/tool-inert-keys-removed.md` 是样板 —— 抄它的 "The retirement
      kit:" 段。
- [ ] **`check:generated` 明确不跑的源码审计 —— 整组跑,永不单点。** 它的输出会点名
      它们;陷阱是跑了五个漏了第六个。咬退役的是 `check:variant-docs`:删掉一个
      discriminated union 会孤儿化它的 variant/doc-ledger 条目,本地跳过则只在 CI
      变红(#5552 / PR #6078:`type:cast|constant|javascript|lookup|map` 条目比它的
      union 多活了一轮复核)。
- [ ] **`packages/qa/dogfood` 在退役的默认消费半径之内** —— 不只是 import 该
      schema 的那些包。它持有 ADR-0058 D7 表达式面 conformance 台账
      (`test/expression-conformance.test.ts`),删掉任何带表达式面的 schema 成员都
      会搁浅一条 `covers` 条目("STALE covers — surface no longer in source",同一
      个 PR,第二次漏)。推送前跑它的定向套件,不管你的 import 图怎么说。

**更正(§1)也必须传播到上面每一行。** `form.data` 翻回 `live` 时,台账、
conversion 与测试都改了 —— 但 release-notes 行与台账 README 行还写着它已删除,教作
者去删一个 `defineForm` 会写的键。一个 PR 之后才被发现修掉。更正路径是没有人给它准
备清单的那条;用这一份。

## 5. 把门禁跑到真能失败

```bash
cd packages/spec && pnpm build          # REQUIRED first — see the dist trap below
for c in check:liveness check:empty-state check:authorable-surface check:docs \
         check:api-surface check:spec-changes check:upgrade-guide \
         check:skill-refs check:skill-docs check:skill-examples; do
  pnpm -s "$c" >/dev/null 2>&1; e=$?     # capture BEFORE anything else runs
  printf '%-28s %s\n' "$c" "$( [ $e -eq 0 ] && echo PASS || echo FAIL )"
done
cd ../.. && pnpm check:i18n && pnpm --filter @objectstack/spec test
```

`check:liveness`、`check:empty-state`、`check:skill-examples` 没有生成器 —— 那里的
失败是真发现,不是过期产物。

## 6. 各费过一轮红构建的陷阱

- **过期 `dist`(一条工作线上 5+ 次假警报)。** 包从 `dist` 加载。改了 `src` 之后本
  地套件红,通常是 dist 旧了,不是你改坏了 —— `check:api-surface` 读
  `dist/*.d.ts`,会报幻影 "breaking removals"。相信任何本地红之前、去立「main 坏
  了」的单之前,先 `pnpm turbo run build --filter=<pkg>...`。
- **`| tail -1` 吃掉退出码。** 门禁的管道接上 `tail`,报的是管道的状态,失败的门读
  成绿。显式抓 `exit=$?`(上面的循环就是)。一次 liveness 失败曾藏在这后面。
- **截断的 grep 漏掉编写者。** `| head -8` 藏掉了 `SKILL.md` 的 `defineSkill` 示
  例;`examples/` 有三处 `template: true`,不是一处。先按上下文找文件,再进文件里
  grep 键 —— 且把 `tsc` 和门禁当权威清扫器。
- **串行门禁互相遮蔽。** `Check Generated Artifacts` 与 `TypeScript Type Check` 各
  自按序跑门、停在第一个失败。提前把全部重新生成;不要一次红构建迭代一个。
- **绿 CI 可能是休眠的门。** `check-generated` 在 `ci.yml` 里跑在 `paths` 过滤器后
  面;路径不在过滤器里,门恰好对打破它的那些 PR 沉默(过滤器整体携带
  `packages/spec/src/**` 就是这个原因)。你新增生成产物或某产物的新输入,同一个 PR
  里把路径加上。
- **只改 conversion 的 `summary` 也会过期。** 那个字符串被逐字抄进
  `spec-changes.json` 的 `to` 字段与 upgrade guide 的表行,所以纯散文改动也要
  `gen:spec-changes` + `gen:upgrade-guide`,和任何别的改动一样。
- **`--check` 模式是门;裸模式重写。** `gen:*` 修文件,`check:*` 是同一脚本断言它已
  提交。永不靠手改生成文件去「修」一个 `check:*` 失败。
