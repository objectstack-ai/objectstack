---
"@objectstack/formula": patch
"@objectstack/lint": patch
---

字段级 `*When` 的未绑定根检查:黑名单翻成白名单,并把因果句按槽位分档

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
