---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 元数据审计历史与全局搜索按 `order` 排序,不再按 `direction` (#4674)

`protocol.ts` 里两处内部 `engine.find` 调用把排序写成 `{ field, direction: 'desc' }`。QueryAST 的排序形状是 `SortNodeSchema` = `{ field, order }`,两个真实驱动都只认 `.order` 且没有 `direction` 回退——`undefined === 'desc'` 为假,于是两个查询实际都在**升序**运行。`direction` 是 `IReportService` 的词汇,是另一份契约,这正是错误拼写看起来合理的原因。

由于两个查询都带 `limit`,方向错误不只是把一页重排,而是**改变了哪些行会被返回**:

- **元数据审计历史**取到的是最旧的 `limit` 条事件——一个对象生命的开头,而永远不是它最近的变更。在长期存在的对象上,编辑者要找的东西一条也看不到。
- **全局搜索**取到的是最陈旧的 `perObject` 条匹配,最近编辑过的记录恰好被 `limit` 截断掉——而那正是搜索者最可能想要的。

两处的 `as any` / `: any` 一并去掉:`EngineQueryOptions.orderBy` 是 `SortNodeSchema[]`,本来就会拒绝 `direction`,而类型擦除正是让它溜过去的原因。恢复类型是这次改动价值的大头,因为对内部调用方来说 `tsc` 就是那条被执行的渠道。
