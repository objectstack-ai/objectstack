---
"@objectstack/rest": patch
---

fix(rest): 联合类型分支里的拒绝理由现在能到达调用方,不再只剩 `Invalid input` (#5014)

zod 会把一个失配的 `z.union([...])` 折叠成**一条**顶层 `invalid_union` issue,它自己的
`message` 是裸的 `"Invalid input"`;每个分支真正的抱怨——包括 #4001 那批 `strictObject`
写下的处方文案——躺在 `issue.errors` 里(每分支一个数组)。`zodIssuesToFields` 过去只映射
顶层 issue,于是 `POST /api/v1/data/:object/query` 对着
`{"search": {"fields": ["name"]}}` 只回一条

```
{ "field": "query.search", "code": "invalid_shape", "message": "Invalid input" }
```

——说清「缺的是 `query` 这个键」的那句话被生产出来,然后被丢掉。同一个坑在
`QuerySchema.groupBy` 的联合分支上一样:`dateGranularity` 写错值,作者拿不到那份
「可选 day/week/month/quarter/year」的清单。

现在 `fields[]` 会在联合条目**之后**追加解释它的分支条目,`field` 用分支路径拼上联合自身
的路径(`query.search.query`),`code` 照常走 ADR-0114 D3 的目录映射——所以缺键报
`required` 而不是 `invalid_type`(这一判定要走绝对路径去读入参,分支路径是相对的)。

分支选择策略直接沿用 #4971 给 CLI/spec 侧 `formatZodError` 落的那一套:只报根部
KIND 不匹配的分支整支丢弃(全部如此则不展开,输出和以前逐字一致);剩下的**报得最少的
分支胜出**——这条是防止「一个拼错的键被 N 个分支各报一遍」的机制本身;`unrecognized_keys`
破平局;声明顺序破剩下的;真正并列的分支全部输出(上限 3 条);跨分支重复的相同结论只
出现一次;嵌套联合按绝对路径递归,深度上限 3。两侧必须给出**同一个判定**,否则同一个错误
从终端发布和从 API 提交会得到两套说法。

对 wire 而言这是**纯追加**:原有的每一条 `fields[]` 条目——包括联合自身那条——`field` /
`code` / `message` 和相对次序都不变,新条目插在它解释的那条之后。信封形状仍与
`mapDataError` 同形(ADR-0114),数组长度从来不是契约的一部分。
