---
"@objectstack/spec": patch
---

docs(spec): 修正两处 `.describe()` —— `ExecutionContext.preserveAudit` 补上描述，RLS `using` 改按编译器实际下推的形态描述 (#6881, #6762)

两处同类问题：已发布的 `.describe()` 说明不足。`.describe()` 是唯一进入生成参考文档的属性级文本（属性上方的 TSDoc 块不进生成器），所以这两处直接决定
`content/docs/references/**` 里那一格渲染出什么。仅文本改动 —— 没有任何 key、类型、枚举成员、refinement 或默认值变动，acceptance surface 逐字节不变。

**`ExecutionContextSchema.preserveAudit`（#6881）** 此前是裸声明 `z.boolean().optional()`，语义只写在上方块注释里，于是
`references/kernel/execution-context.mdx` 的描述列渲染为**空**（同族的 `DriverOptions.preserveAudit` 有 `.describe()`，渲染正常）。
现在补上描述，并按 #6640 收窄后的契约措辞，与已合入的两处（`FieldSchema.readonly`、`protocol/objectql/security.mdx` 的 callout，均出自 PR #6823）
保持同一口径：豁免**仅在 UPDATE 路径成立**；INSERT 侧在 DataProtocol ingress 更早剥离，只认 `context.isSystem`，非 system 的 create 请求即便携带
`preserveAudit`，字段仍被剥离并记 WARN。

**`RowLevelSecurityPolicySchema.using`（#6762）** 此前宣称「四种编译器支持的形式之一」，且四种拼写全是 SQL 方言。两个方向都不准：

- **实测比宣称的宽。** `isSupportedRlsExpression` 之下，`!=`、`<`、`<=`、`>`、`>=`、对内联字面量列表的 `in`、`&&`、`||` 以及裸 `true` 都会真正生效。
- **它把作者导向正在退役的方言。** ADR-0058 D1 定 CEL 为规范方言，`sqlPredicateToCel` 标记 `@deprecated`。

改为按**能被下推的形态**描述（而非重新数一个固定数目 —— 换一个同样错的计数是同一个缺陷），并把 SQL 拼写降格为过渡桥接：`=` → `==`、`IN` → `in` 仍被接受，
而 SQL 的 `AND` / `OR` / `NOT IN` / `IS NULL` / `LIKE` 不在桥接范围内、fail-closed。
