---
"@objectstack/driver-turso": patch
---

fix(driver-turso): remote 模式拒收条件层的 `$`-算子键 —— 不再编译成静默空集/全表写 (#5769)

`RemoteTransport.buildWhereSQL` 只认 `$and` / `$or` / `$not` 三个组合算子;条件
层其余任何 `$` 开头的键都掉进**字段路径**,被双引号引成一个**列名**。在
`origin/main`(`5c94f833c`)上用捕获客户端 + 三行 fixture 实测:

```
{ $eq: 'won' }                 → SELECT * FROM "deal" WHERE "$eq" = ?         → []
{ $gt: 5 }                     → SELECT * FROM "deal" WHERE "$gt" = ?         → []
{ $where: 'return true' }      → SELECT * FROM "deal" WHERE "$where" = ?      → []
{ $and: 'x' }                  → SELECT * FROM "deal" WHERE "$and" = ?        → []
{ $or: [{}, { $where: 'x' }] } → SELECT * FROM "deal"(整句没有 WHERE)        → 全部三行
```

前四行是**静默空结果集**:SQLite 的向后兼容规则把「解析不到列的双引号标识符」
降级成字符串字面量,于是语句编得出、跑得通、一行不匹配 —— 和「确实没有匹配的
行」在调用侧完全无法区分(在关掉该规则的构建上,`find()` 自己的 `no such column`
兜底也会把它吞成 `[]`,两条路一个答案)。

第五行不依赖任何方言怪癖,也是代价最大的一种:`{}` 是 `$or` 的 TRUE 单位元,
整组被吸收,连同它那个畸形兄弟已经编出来的子句一起被丢掉,语句**整个丢掉了
WHERE**。读路径上这是把过滤器本要排除的行原样交还;`deleteMany` / `updateMany`
上这是**全表写** —— 实测三行全部被一个一行都没点名的过滤器改写。

现在:条件层任何非 `$and`/`$or`/`$not` 的 `$` 键,在 find / findOne / count /
aggregate / deleteMany / updateMany 六个建 WHERE 的入口上一律以
`INVALID_FILTER` / 400 响亮拒收,且**不发出任何语句**。消息分两种 —— 是字段算子
写高了一层(`$eq`/`$gt`/…)就指路 `{ <字段名>: { <算子>: <值> } }`;协议根本没
声明的键(`$where`/`$nor`/`$expr`/`$elemMatch`)就点名拒收。声明正确但值不是数组
的 `$and` / `$or`(`{ $and: 'x' }`)同样落在这个闸里,按「需要条件数组」拒收 ——
它此前从两个 `Array.isArray` 判断底下漏进同一条字段路径,结局一模一样。

这条规则本来就是 objectstack#5348 的裁定,PR #5368 已在 `SqlDriver` 的校验遍历
(`reduceFilterKey`)落地,`driver-sqlite-wasm` 与 Turso **local** 继承。
`RemoteTransport` 是独立的过滤器编译器,什么都继承不到,所以同一个
`TursoDriver`、同一个过滤器,只因 `url` 不同就给两个答案,而且方向是反的:local
严、remote 松。本次补的正是这最后一面,新增的 local/remote 一致性用例把这条叉
钉死。

合法过滤器一个字节都没变:三个组合算子的嵌套、`$and: []` / `$or: []` / `$not: {}`
的布尔单位元、字段层算子、隐式相等、`IS NULL`,以及既有的六种拒收(未知字段算子、
不可绑定比较值、空算子映射、非节点子过滤器、非节点顶层 `where`、非布尔 `$null`)
各自的措辞,全部照旧。
