---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): better-auth 的 `contains` 下译为 `$contains`,比较值不再当正则求值 (#5710)

`convertWhere()` 把 better-auth 的 `contains` 译成 `{ field: { $regex: value } }`,
于是一个**未转义、来自调用方**的比较值(`/admin/list-users` 的 `searchValue`、
SCIM 过滤值)坐进了正则的**模式位**。它的含义随后端分叉:

- `driver-memory` 用 `new RegExp(value)` 求值 —— `contains('a.b')` 命中 `axb`,
  `^x` 变成锚定,而值里一个不配对的 `(` 让模式非法(mingo 查询路径直接抛
  `SyntaxError`,参考匹配器则吞成静默零命中);
- `driver-sql` / `driver-sqlite-wasm` / `driver-turso` 编成子串
  `LIKE '%value%'`(`%`/`_`/`\` 有转义、带显式 `ESCAPE`),元字符是字面量。

同一个认证查询,在应用测试常用的内存替身上和生产的 SQL 后端上给出**不同答案**,
且分叉发生在认证路径上。

现在这一支发出 `$contains` —— 协议 `FILTER_OPERATORS` 里的算子,五后端都必须按
**字面子串**求值,正是 better-auth `contains` 的本意(其 `Where.mode` 默认
`"sensitive"`,与 #5701 Q2=A 裁定的 `$contains` 大小写敏感契约同向)。

**对使用方的影响**:凭 `/admin/list-users?searchValue=…` 之类接口依赖「元字符按正则
生效」的调用会改变结果 —— 那是本次修复的缺陷本身,不是可依赖的行为。搜索
`a.b` 从此只命中含字面 `a.b` 的行,不再命中 `axb`;含非法正则字符的搜索值不再
报错或静默返回空,而是按字面子串匹配。
