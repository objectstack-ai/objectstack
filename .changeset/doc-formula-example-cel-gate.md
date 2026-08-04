---
"@objectstack/lint": patch
---

fix(docs,lint): 修正两处裸引用公式样例,并给公式样例补一道 CEL 语义门 (#5116)

#5026 把字段公式校验从 `f.formula`(spec 按名拒绝的别名)收敛到声明的
`f.expression`,**激活了一条从未跑过的检查**。它的真实元数据扫描顺带发现文档和博客
里有两处公式样例写的是**裸引用**:

- `content/docs/data-modeling/fields.mdx` — `'quantity * price * (1 - discount / 100)'`
- `content/blog/context-window-is-the-constraint.mdx` — ``cel`amount * probability` ``

裸引用在 CEL 里不报错,而是**静默求值为 null**:公式表达式把记录绑定在 `record`
命名空间下,顶层的 `quantity` 什么也解析不到。照这两行写出来的元数据,在 #5026
之后会被 `os build` / `os validate` 判红 —— 文档教的写法和平台的门直接矛盾。两处
都已改成 canonical 的 `record.` 前缀形式。

**新增 `@objectstack/lint` 的 `check:doc-formula-expressions`**,堵住让这两条长期
存活的那个洞。`check:doc-authoring` 看的是字面量的**形状**,`check:skill-examples`
对标记块跑 `tsc --noEmit` —— 两者之间,"能编译但 CEL 写错"的样例没有任何门:
`expression` 的类型就是 `string`,`'quantity * price'` 和
`'record.quantity * record.price'` 编译得一样好,而只有后者能用。

判决直接 import `@objectstack/formula` 的 `validateExpression` —— 和 `os build`
走的是同一个调用,不是仿制品。于是文档是被**规则本身**把关,而不是被规则的一种方言
把关(Prime Directive #12)。

门的难点不在判决而在**判据**:同一个 `expression:` 键在语料里承载至少三种互不相干的
契约 —— 记录作用域的 CEL 公式、flow 的扁平作用域谓词(那里裸引用是**对的**)、以及
`schedule` 下压根不是 CEL 的 cron 串。按键名匹配会把后两类全部误判为红。所以它只认
**解析后的结构**,且只认两种不可能有歧义的形状:`Field.*({ expression })`,以及
`type: 'formula'` 与 `expression` 并列的对象字面量。无法提取的块**报错而不是跳过**
("absence must be loud")。

覆盖面是明说的,不含糊:只看 TS/TSX 代码块、只看能静态取出的表达式源、不做字段存在性
校验(文档片段没有对象声明)、flow / action / validation 谓词**刻意不在范围内**。
