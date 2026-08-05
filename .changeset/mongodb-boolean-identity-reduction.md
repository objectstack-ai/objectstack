---
"@objectstack/driver-mongodb": patch
"@objectstack/spec": patch
---

fix(driver-mongodb): 空 `$and` / `$or` / `$not` 按布尔单位元归约,非 filter 节点先响亮拒收 (#5239)

`translateFilter` 过去把组合子数组**原样透传**给 MongoDB。而 MongoDB 对空数组既不答
TRUE 也不答 FALSE,是第三种行为:**直接拒绝整条查询**(`$and/$or/$nor must be a
nonempty array`)。于是 `{ $and: [] }` 与 `{ $or: [] }` 一路走到 `find` /
`countDocuments` / `updateMany` / `deleteMany`,变成一个不带 ADR-0112 错误码的服务端
异常 —— 而 `driver-sql`(#5134 / PR #5243)、`driver-memory`、`formula` 三家早已按单位
元作答。

改成与它们同一套**结构性三值归约**:先把整棵 filter 树判成 `true` / `false` /
`clause`,再据此产出。空 `$and` 归约为 TRUE(不产出条件),空 `$or` 归约为 FALSE 并产出
一个**真实的零行条件** `{ _id: { $in: [] } }` —— 关键在于「什么都不产出」等于 `{}`,而
`find` / `updateMany` / `deleteMany` 把 `{}` 读作**全部文档**,方向正好相反。`{}` 作为
`$or` 的分支仍是 TRUE 析取项,`{ $not: {} }` 仍是零行,这两条 MongoDB 本来就与布尔代数
一致,所以归约按结构做而不是只判 `length === 0`。发出的每个 `$and` / `$or` 数组因此都保
证非空。

**同一改动里的形状拒收**,顺序是先拒收后归约:单位元把「这个节点没有谓词」读作「匹配全部
文档」,所以空节点必须只有一个成因。改前实测,本驱动这一格比 `driver-sql` 当年更糟 ——
`{ $or: [new Date()] }` 译成 `{ $or: [{}] }`,即**每一份文档**;`{ $or: 'x' }` 与
`{ $not: null }` 译成 `{}`,同样是每一份文档。`updateMany` / `deleteMany` 走的是同一个
translate 层,在那里「放宽到全部文档」不是行数不对而是数据丢失。现在这类操作数按
ADR-0112 以 `INVALID_FILTER` / `status: 400` 拒收,并在消息里点出位置
(`filter.$or[0]`)。`Date` / `RegExp` / class 实例都满足 `typeof x === 'object'` 却枚举
为空,故判定按**原型**而非 `typeof`。

`packages/spec` 侧只动文档:`FilterConditionSchema` 的契约 TSDoc 写明 `$not` 的
**NULL-safe** 语义(#5146 维护者拍板 —— 被比较列为 NULL 的行不满足被否定的条件,应当被
返回,即 `NOT (…) OR col IS NULL`),并在 `filter-logic-conformance.ts` 记下三族已裁定但
**尚未进表**的 case 及其实测矩阵。无运行时行为变化,无 API 变化。
