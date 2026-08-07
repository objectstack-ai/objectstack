---
'@objectstack/spec': patch
---

tooling: strictness 台账新增第九个判定词 `covered` —— 给「无门、无 parse,但每个消费者都已把守」的形状片段一个诚实的格子 (#5249)

`docs/audits/2026-07-unknown-key-strictness-ledger.md` 的 `Class` 列是**机读**的(按类小计是对它做算术),枚举值此前只有八个。`ui/app.zod.ts` 的 `BaseNavItemSchema` 八个都不合适,而这不是标签精度问题 —— **是词汇表返回了错误的动作**:

- 两轴表(carrier / parse)把「carrier 缺席 + parse 缺席」解析成 `no door`,其规定的后续动作是 ADR-0049 退役。**在这里是破坏性的**:这个基底的键被九个导航分支共享,九个分支各自 `.strict()` 并带 `navItemUnknownKeyError`,退役等于删掉九个活着的分支的共享键。
- `no gate` 反向错(门是存在的,就在成员上)。`authorable` 是 `view.zod.ts` 里 `FormFieldBaseSchema` 的先例,但**那个基底真的被 `.extend()`**,姿态会继承,所以它是一扇真门;把这个也记成 `authorable`,等于邀请下一轮 sweep 去「把活干完」—— 收紧一个没有任何 parse 的形状。
- `verify` 的语义是「待检查」,而检查在批 19 就做完了。

维护者 2026-08-06 裁定取 A:**加词,而不是四舍五入到最近的错误答案** —— 与批 15 加 `no gate` 同一条理由。同一个测量第二次返回相反方向的后续动作,说明缺的是一格判定,不是这个站点特殊。这一格的读者主要是后续 agent,一个指向错误**动作**的分类,会被执行它的人放大,正是「消费者侧宽容」在分类层的镜像。

**`covered` 的定义**:carrier 缺席、parse 缺席,但词汇在**每个消费者处都被完整把守**;后续动作是**无**。它拿到自己的桶而不是并入 `no door`:两者测量相同,但小计是一张工作清单,而两行规定的工作相反 —— 合并会把刚刚消除的歧义原样搬到上一层。

改动面:

- `packages/spec/scripts/lib/strictness-ledger-doc.ts` —— `VERDICTS` / `BUCKETS` / `BUCKET_OF` / `emptyBuckets()` / 渲染标签。`verify` 的**语义与归桶完全不动**(仍计入 authorable),它继续为下一个需要挂起的站点保留。
- 台账 `ui/app.zod.ts` 行 `verify` → `covered`;头部散文补上词表变更的出处一行(批 13 `no door` / 批 15 `no gate` / #5249 `covered`),分类表与两轴表各补一行。
- `.counts.md` 走 `gen:strictness-ledger` 整体重算:全局 authorable 43 → 42、新增 `covered` 1;`ui/` authorable 34 → 33、`covered` 1。总数仍是 197,分桶仍恰好划分。

**改判范围是测量出来的,不是走过场。** 判据是机械的:`covered` 要求键通过 `...X.shape` **展开**到达消费者 —— 展开把逐键 schema 复制进一个全新的 `z.object`,姿态是新对象自己的,所以基底是惰性的;而 `.extend()` / `.merge()` / `.omit()` **继承**姿态,基底就还是一扇真门。对五个已分诊目录的全部 **197** 个 strip 站点跑了这条判据,**只有一个**站点是展开的,就是本行。另外三个模块私有的 strip 基底各有归宿且**维持原判**:`view.zod.ts` 的 `FormFieldBaseSchema` 在 `:1475` 被 `.extend()`(姿态继承 → 真门 → 仍 `authorable`);`query.zod.ts` 的 `BaseQuerySchema` 在 `:485` 被 `.extend()` 成 `QuerySchema`(同理 → 仍 `open`);`component.zod.ts` 的 `EmptyProps` 作为**值**挂在 `ComponentPropsMap` 的十一个 carrier 键下(carrier 存在 → 根本不满足「carrier 缺席」)。其余约 50 个站点是属性下的内联嵌套字面量,天然自带 carrier,不可能是 `covered`。

不改任何 schema 姿态 —— 批 19 已测定关掉这个基底是保证的 no-op,而 #4583 明确 no-op 收紧并非中性(*"a precisely-validated dead slot is the more convincing lie"*)。
