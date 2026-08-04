---
"@objectstack/lint": minor
---

fix(lint): 字段公式校验首次对 spec 合法元数据生效 —— `f.formula` 收敛为 `f.expression` (#5026)

`validate-expressions.ts` 的字段公式校验(`validateStackExpressions` 里的
field-formula pass)一直读 `f.formula`。`FieldSchema` 声明的是 `expression`,而
`formula` 恰是 `field.zod.ts:333` **按名拒绝**的别名之一
(`aliases: { formula: 'expression', calculation: 'expression', compute: 'expression' }`)。
该规则以 `input: 'parsed'` 注册,compile/build/validate 路径上看到的是
`ObjectStackSchema` 的解析产物,所以 `f.formula` 恒为 `undefined` ——
**整段检查对任何 spec 合法 stack 从未执行过一次**。

这不是删死代码,是**启用一条从未跑过的检查**。字段公式从此真正受
ADR-0032 §1a/1b 的三条判决管辖:CEL 语法、`record.<field>` 字段存在性、
以及 #1928 的裸引用 / 类型健全性。对 AI 生成的元数据这一条最要紧 ——
`amount * probability`(而不是 `record.amount * record.probability`)正是公式槽位
最常见的错法,它在 CEL 里静默求值为 null,过去没有任何门拦得住。

**覆盖面扩大,但对现有元数据零新红。** 激活后在仓库全部真实元数据上实测过:
`examples/app-showcase`(3 个 `expression` 槽)、`examples/app-crm`(5 个)、
`examples/app-todo`(0 个)全部 `ObjectStackSchema` 解析通过,新增判决 0 条;
`platform-objects`、`plugin-security` 的 default-permission-sets 不含公式字段;
`skills/` 里的公式样例全部已是 canonical 拼法。

**Authoring impact.** 之前拼 `formula:` 的字段本来就无法解析,schema 会按名拒绝
并给出 `Did you mean \`formula\` → \`expression\`?`——该行为不变,本规则不再对同一个键
给出第二套说法。诊断定位串同步改名以免继续传播错拼法:

```
FROM  object 'X' · field 'Y' formula
TO    object 'X' · field 'Y' expression
```

`validate-null-guards.ts` 的 surface ledger 相应把该行从 `Field.formula` 正名为
field `expression`(`Field.formula({ expression: … })` 写入的槽)。null-guard 判决
**仍然**排除该 surface(公式是 `value` 角色、天然可空,`guard ? value : null` 是祝福
写法),排除的只是 null-guard 这一条,语法 / 字段存在性 / 裸引用判决从此生效。

`validate-expressions.test.ts` 的 `TRACKED_UNDECLARED_READS` 记账随之清空 —— 这
份"只缩不长"的清单现在是零条,规则读的每一个键都是 spec 声明的键。
