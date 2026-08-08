---
"@objectstack/spec": minor
---

feat(spec): 定形 `multi: true` 批量写在 `before*` 阶段的按行 hook 契约(#6462)

#5574 的维护者裁决(2026-08-06,方案 B)把「批量写按行语义为平台契约」(#4800 /
#4862,after 侧已由 #5038 交付)延伸到 `before` 型 hook,并指定 **contract-first
拆分:spec 契约子单先行,engine 实现随后**。本次变更是该拆分的 spec 半边 —— 只落
契约、pin 测试与 ADR 附录,**engine 一行未动**。

**为什么需要这条契约。** 谓词写路径上 `ctx.previous` 在 before 阶段从未被绑定,于是
每一个按守卫写法写出来的 hook —— `if (ctx.previous?.locked) throw` —— 在批量写上
静默放行。hotcrm 实测:一次批量编辑绕过全部 15 个守卫 hook,把单行路径会拒绝的
`readonly: true` 字段写成 `null`。失效方向是 fail-open,而让它静默的可选链正是 AI
会写出的形状。

**新增契约面** `@objectstack/spec/data` → `bulk-write-hook-conformance.ts`:

- `BULK_WRITE_HOOK_DISPATCH_CONTRACT` —— 四个写事件的按行派发表(before/after ×
  update/delete),逐条声明 per-row 上下文携带哪些键、载荷作用域,以及 **`delivered`
  标记**:after 半边由 #5038 交付(`true`),before 半边为已裁未交(`false`,
  engine 半边 = #5574 engine 卡)。契约先行必须能被读出「尚未交付」,否则它就是一次
  declared ≠ enforced。
- `MAX_BULK_PER_ROW_HOOK_ROWS` / `BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE` /
  `resolveBulkPerRowHookBudget()` —— `assertBulkPerRowHookBudget` 先例的契约级表述:
  **两个阶段共用一个上限**,超限在**首次按行派发之前**整单拒绝(什么也不写、一个
  handler 也不跑),永不降级成「整批一次派发」。

**载荷可改写语义(裁决必答项 1)的答案是:载荷仍然只有一份,作用域是整批。** 每个
per-row 上下文拿到的是**同一个** payload,而不是逐行副本 —— 于是 N 份载荷不可能分叉,
没有合并步骤,谓词写永远不会被拆成 N 次单行写(仍是一次 `updateMany`、一个受影响行数
#4639)。逐行副本 + 「一致则合并、分叉则拒绝」这条更显然的路线被实测证据否掉:objectql
自带的 `sys_stamp_audit_update` 注册在 `'*'` 上,且在**每行**的 stamp 内部读
`new Date()`,跨毫秒的两行 `updated_at` 天然不同 —— 该规则会非确定性地拒绝正常批量写。

**行为不变。** 本次不改任何 Zod schema 的接受面,不新增可授权键,不动 engine:今天能
通过校验的元数据,改动后逐字节仍然通过。`hook.zod.ts` 的 `input` 形状表继续描述引擎
**当前**的构造(由 objectql 对真实派发钉住),只是补了一条指向新契约的前瞻说明 ——
表与引擎不允许抢跑,这正是 #5273 的教训。

ADR-0058 新增 **Addendum II**,同时收纳裁决指定的 #5748 半边(`data.id` 与
`where.id` 统一走标量测试,已由 PR #5919 交付),并把 Addendum I 中「`before*` hooks
are NOT per row」一段标记为 **SUPERSEDED**(原文保留 —— 被推翻的决策本身是记录)。
