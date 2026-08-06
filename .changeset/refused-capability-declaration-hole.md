---
"@objectstack/plugin-security": patch
---

fix(plugin-security): 被拒收的 capability 声明不再连派生占位一起压掉 (#4967 Part 1/3)

`SecurityPlugin` 分两遍种 `sys_capability`:第一遍落包声明的 capability
(`managed_by:'package'` + `package_id`),第二遍种平台 curated 集合 + 从
permission set 的 `systemPermissions[]` **派生**的 back-compat 占位,并**跳过**
第一遍报上来的名字,以免占位把已写好的声明覆盖掉。

问题在于第一遍报的是「读到的每个名字」,而不是「真正落了行的名字」:
`bootstrapDeclaredCapabilities` 在 upsert 作出任何决定**之前**就把
`cap.name` 推进了返回列表。而 upsert 有三条**拒收**路径,一行都不写。其中
「声明没有归属包」这一条既没写行、又占住了名字,于是派生占位也被跳过——
capability **在任何一行里都不存在**。净效果是:**写下这条声明,比不写还糟**
(不写至少还有派生占位)。这正是 showcase 的
`showcase.export_data` 只留下一条 `warn` 的成因。

修法是把「上报」与「读到」拆开:一个名字进入上报列表(现更名为
`materializedNames`)的条件,是本遍**确认它有行**——本遍写成了
(seeded / updated / claimed),或找到一行不能被覆盖的既有行(admin 自建、他包
所有、curated 平台名)。三条拒收路径按「派生是否会覆盖既有 authored 行」分别
处置,理由写在代码里:

- **curated 平台名**:仍然上报。curated 那一遍无条件种这些名字,行必然存在;
  且派生路径本来就够不到 curated 名(它已在 curated 表里)。
- **他包所有 / admin 自建**:仍然上报。行存在且 label/description 是**作者写
  的**,派生会把它们刷成 humanize 出来的占位——压掉派生正是这份列表的用途。
- **没有归属包**:仅当已存在一行时才上报。没有行时回落到派生占位,和「从未
  写过这条声明」时一样。

同时补上这条路径此前缺失的计数器 `skippedUnowned`,于是每条具名声明恰好落在
一个计数器里,列表与计数器可以对账。

**行为变化(升级须知)**:一条被拒收(无归属包)且被某个 permission set 授权
的 capability,此前在 `sys_capability` 里**没有任何行**,现在会出现一行
`managed_by:'platform'` 的派生占位——即它在 Setup 的能力列表里可见、可解析、
带 humanize 出来的 label。注意这不改变**运行时判定**:权限求值一直是按
`systemPermissions[]` 里的字符串取并集的,从不查 `sys_capability`;恢复的是
注册表一侧的 declared = enforced(能力有定义记录、可见、可管理、有 provenance),
不是把一个原本不生效的授权变成生效。若某个部署依赖「那条能力在能力列表里查不
到」,升级后它会出现。

诊断消息同时按 #4632 改进(级别仍为 `warn` —— 功能性降级,非持久性失败):
拒收时点名**授权它的 permission set**,并写明真实后果,例如
`[security] declared capability "showcase.export_data" has no owning package (granted by showcase_ops): falls back to the back-compat derived placeholder …`。
无人授权、或已有行的情形各有对应措辞。
