---
"@objectstack/spec": patch
---

fix(spec): `aria` 墓碑不再把作者指向同一个大版本里已经退休的落点（#6756）

`dashboard.widgets[].aria` 的 `retiredKey()` 提示告诉升级中的作者，共享的
`AriaProps` 形状「stays live on `app.aria`」。但 `App.aria` 自己就是一个
`retiredKey()` 墓碑，和它在**同一个 17.0.0** 里被 2026-06 app liveness 审计移除了。
于是这条提示把作者送向一扇不存在的门，然后在两行之后递给他们
`os migrate meta --from 16` —— 而 `app-dead-authoring-keys-removed` 这个转换恰好
会把 `aria` 从源里**剥掉**。按提示操作的代价是两轮返工外加一次静默的数据丢失。

反向的一半同样是坏的：`App.aria` 的处方说「declare `aria` on the
**component/widget**」，而 widget 那一半指的正是 #5010 退休掉的
`dashboard.widgets[].aria`。两个墓碑互相指向对方已经退休的键。

按实测（而非沿用原 issue 的猜测）重新校准了落点。`packages/spec` 里
`aria: AriaPropsSchema` 共 25 处活声明，liveness ledger 的判定是：`page.aria`、
`page.components[].aria`、list view 的 `aria` 为 `live`；`action.aria` 为 live 但
标注 PARTIAL；`app.aria` / `dashboard.aria` / `dashboard.widgets[].aria` /
form view 的 `aria` 为 `dead`；`chart.aria` 没有 ledger 行。因此处方只列举了
前三个无歧义的活载体 —— 多列一个没有渲染器读的面，就是在重犯本 issue 修的错。

同时把 `os migrate meta --from 16` 的动词从 "rewrite it" 改为 "remove it"：该转换
调用的是 `stripKeys(..., ['actionUrl','actionType','actionIcon','aria'])`，fixture 的
`after` 里 `aria` 已被删除，它做的是剥离而不是搬迁。

**接受集合逐字节不变。** 改动的每一处都是 `retiredKey()` 的 guidance 参数、注释或
ledger 的 `note` 散文；`retiredKey()` 无论字符串是什么都返回
`z.never({ error: () => guidance }).optional()`。`gen:schema` 亦独立复核了
1308 个 authorable default 未变。
