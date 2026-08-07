---
"@objectstack/lint": minor
"@objectstack/formula": minor
---

feat(lint): view/page 可见性谓词的裸标识符构建期闸门 —— 坏谓词发不出去(#6128)

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
