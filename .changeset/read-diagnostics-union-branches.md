---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 读路径 `_diagnostics` 保留 union 分支给出的真实拒绝理由 (#5598)

`computeMetadataDiagnostics` 给 `getMetaItems()` / `getMetaItem()` 服务出去的每份
文档挂 `_diagnostics` 信封,模块头写明它的用途是让 Studio 渲染 validity badge、
**内联字段错误**和治理看板。但它把 zod 的 `error.issues` 直接 `.map()` 成信封条目,
而 zod 会把一个失败 `z.union` 的**全部分支**折叠成一条顶层 issue —— `path` 是 `''`,
message 是字面量 `"Invalid input"`。`ViewMetadataSchema` 顶层本身就是 union
(`z.preprocess(stripViewConsoleDecorations, z.union([...]))`),所以库里**每一个**
有缺陷的 view 文档读出来都退化成这一条没有字段名的记录,内联字段错误无处可标。

这不只是"少了点信息",而是**同一份文档在两条路径上判决不一致**:#5364(PR #5596)
修好写路径之后,作者**保存**一个有缺陷的 view 能看到出错的键名,**打开**同一份已存
在库里的文档却仍然只得到一条 `Invalid input`。

改法是复用而不是再抄一份策略:读路径改调同包 #5596 已落地的
`zodIssuesToMetadataIssues`,分支选取口径(丢弃只报根部 KIND 不匹配的分支;报得最少
的分支胜出;`unrecognized_keys` 破平局;并列全出且有上限;嵌套 union 按绝对路径递归)
由该函数**单点定义**,读写两路径按构造一致。这是同一机制的第 5 个消费者
(#4971 / #5014 / #5341 / #5364 是前四个)。

对消费者是**纯增量**:union 自己那条记录仍然排在 `errors[0]`,只是后面跟上了解释它的
分支条目,所以任何读 `errors[0]` 的既有代码读到的还是同一条。没走 union 的普通字段级
拒绝(`path` / `message` / `code`)逐字节不变;spec 合法的文档仍然是 `{ valid: true }`,
展开不会凭空造出拒绝。
