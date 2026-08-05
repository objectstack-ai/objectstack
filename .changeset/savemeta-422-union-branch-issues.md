---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 元数据保存的 422 保留 union 分支处方,Studio 重新拿得到字段名 (#5364)

`saveMetaItem` 的 spec-conformance 检查在自己的注释里承诺 "structured Zod issues
so the Studio form can highlight the offending field"。顶层 `z.union` 让这句承诺
彻底落空:zod 把一个失败 union 的**所有**分支折叠成**一条**顶层 issue,`path` 是
空串、`message` 是字面量 `"Invalid input"`,而旧代码的 `parsed.error.issues.map(…)`
映射的正是这一条。

代价不是"文案不够好",而是**字段定位本身消失了**。`ViewMetadataSchema` 顶层就是一个
union(`view.zod.ts` 的 `z.preprocess(…, z.union([…]))`),所以**每一次** view 保存
失败都退化成:

```json
[{ "path": "", "message": "Invalid input", "code": "invalid_union" }]
```

一个字段名都没有到达作者,Studio 表单没有任何东西可以高亮;422 的摘要行也只是
`... failed spec validation: <root>: Invalid input`。被丢掉的分支里躺着的恰恰是
#4001 那批策展处方(点名真实键名的 unrecognized_keys)和带绝对路径、带合法枚举的
逐槽位判决。

现在这些分支被展开进 `issues[]`:union 自己那条**保留不动**(展开是严格叠加的,
今天读 `issues[0]` 的消费者不会少读到任何东西),后面跟上真正解释这次拒绝的分支,
路径按绝对路径拼好——分支 issue 的 `path` 是**相对于 union** 的,这是 #5014 付过
学费的坑。422 的 `message` 摘要行随之变得可读。

分支选择策略与已落地的两处**逐条一致**:丢弃只报根部 kind 不匹配的分支;报得最少
的分支胜出;`unrecognized_keys` 破平局;声明顺序决定其余;并列的全部输出(上限 3);
嵌套 union 递归展开(上限 3 层)。这是同一机制的**第三份**拷贝——`packages/spec`
的 `formatZodError`(#4971)只导出字符串渲染器,`packages/rest` 的
`zodIssuesToFields`(#5014)产出 ADR-0114 的 `{field, code}` 目录条目,而本处的信封
是 `{path, message, code}` 且 `code` 透传 zod 原码——形态不同,**判决必须相同**,
否则同一个错误会因为作者是从终端发布、还是 POST 数据 API、还是在 Studio 里保存,
拿到三套说法。

行为边界:合法的元数据照常保存,非法的元数据照常被 422 拒绝且不落库;变的只是
`issues[]` 从"一条无字段的 `Invalid input`"变成"那一条 + 真正解释它的分支"。
