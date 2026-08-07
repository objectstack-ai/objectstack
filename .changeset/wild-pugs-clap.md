---
'@objectstack/objectql': patch
---

写入载荷里的算子对象在标量字段上被响亮拒收(#5922)

**行为变化**:此前静默入库的算子对象现在被拒绝。`update('task', { title: { $in: ['a','b'] } }, …)` 会抛
`VALIDATION_FAILED`(字段码 `invalid_type`),而不再把 `{"$in":["a","b"]}` 原样交给驱动写进 `title` 列。

原本这条错误的命运取决于字段类型,而不取决于错误本身:`number` 会立刻响亮拒绝(`n must be a number`),
`text` 则零告警落库,之后以「这行的 title 变成了乱码」的形态在读路径上出现,离原因很远。实测(15 种字段类型,
记录型 driver 驱动真实引擎)显示放行的远不止 `text`:`textarea`、未声明 `options` 的 `select`、以及
`lookup` 等引用类(ADR-0104 warn-first)同样放行;而 `select`(有 options)/ `url` / `email` / `phone`
之所以拒绝,只是因为 `String({ $in: […] })` 是 `"[object Object]"`,恰好过不了它们的正则或选项表 —— 一条
在 4 种类型上偶然成立、在另外 11 种上不成立的规则,作者无法从元数据预测。

现在的规则只有一条:**声明值是标量的字段,一律不接受算子对象**。判定复用 spec 已导出的算子词表
(`ALL_OPERATORS` + `RETIRED_FILTER_OPERATORS`),不是第六份手抄的 `startsWith('$')`,所以协议新增算子当天即
自动收口。消息与 ADR-0104 的形状拒绝同族(同一 `invalid_value_shape` 文案,四语言均已本地化),点名字段、
点名算子、点名声明类型。

刻意不动的两处:`json` 等结构化 JSON 类继续放行(`{ "$in": [...] }` 存在 `json` 列里是用户数据,不是写错的
filter);多值字段保留既有的 `invalid_type_array` 拒绝。`insert` 与 `update`(单行与 multi)三个校验入口均已覆盖。
