---
'@objectstack/spec': patch
---

fix(spec): `waitEventConfig` 的两处 wait-timeout 处方改写成能真正解析的形式（#6758）

`waitEventConfig.timeoutMs` 墓碑（`retiredKey()`）与 `timeout` 拼写错误的 `guidance` 条目都让作者写 `timerDuration: 60000`，而 `timerDuration` 是 `z.string()`。照着写的作者先在编写处吃一个 TS2322，再在解析时吃一个不带任何处方的裸 `invalid_type` —— 正是墓碑本该替他们挡掉的那两个错误。ADR-0087 转换早就知道正确答案：它写的是 `String(next.timeoutMs)`，其文档注释直言「Moving the number unstringified would produce a block that no longer parses」。

两处处方现在都印引号形式 `timerDuration: '60000'`（并给出等价的 ISO 8601 写法 `'PT1M'`），并说明为什么要加引号：该键是字符串，裸数字字符串按毫秒读取。同一段的 TSDoc 一并订正——「retired in 18」改为 17（两处墓碑与转换的 `toMajor` 都是 17），以及把「`parseIsoDuration` accepts a bare number」改为「reads a bare numeric *string*」，因为作者遇到的是 schema 而不是那个 helper。

**接受面逐字节不变。** 改动全部落在 `retiredKey()` 的 guidance 参数、`strictObject` 的 `guidance` 取值和 TSDoc 注释里；`retiredKey()` 返回的始终是 `z.never({ error: () => guidance }).optional()`，`guidance` 也只为一个已被拒绝的键提供文案，因此 `WaitEventConfig` 接受的输入集合完全没有变化。
