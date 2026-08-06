---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): `convertWhere()` 补齐 `not_in` / `starts_with` / `ends_with`,未识别算子改为响亮拒收 (#5813)

`convertWhere()` 的分支链只覆盖 better-auth 十一个算子里的八个。
`not_in` / `starts_with` / `ends_with` 落在链尾之外:**`filter` 里不写任何键**,
不告警,链尾也没有 `else` 兜底。一个只带这类条件的 `where` 因此编成 `{}`。

**丢谓词不是把结果变窄,是变宽 —— 而且发生在身份表上**(#3948 反复论证过的形状,
driver-memory 的匹配器 `default:` 臂与 objectql 的 `having` 都为此改成了拒收):

- `findMany` / `count` 变成**全表**(仅受 `limit` 截断)。已挂载的
  `GET /api/v1/auth/admin/list-users`(`auth-route-ledger.ts:161`)把查询参数直接
  推进 `where`,而 `searchOperator` 的枚举是 `contains | starts_with | ends_with`、
  `filterOperator` 的枚举**就是整张算子表**。于是
  `?searchValue=abc&searchOperator=starts_with` 返回的是「全部用户」而不是「以 abc
  开头的用户」,`?filterField=email&filterOperator=not_in&filterValue=…` 不排除任何人。
  管理台的用户检索是它的主要消费者。
- `update` / `delete` / `consumeOne` / `incrementOne` 走的是「先 `findOne(filter)`
  再按 id 写」,`{}` 让 `findOne` 返回**任意一行**(实测是第一行),于是写到了错误的
  记录上。实测证据:对四行表执行「删除 `name` 以 `zed` 开头的用户」,修复前删掉的是
  `u_abc1`(第一行),不是 `u_zed`。

## 改了什么

**一、三个算子按词表直译**(三个 ObjectQL 算子都在 `FILTER_OPERATORS` 里,
五后端都必须求值):

| better-auth | ObjectQL |
|:--|:--|
| `not_in` | `$nin` |
| `starts_with` | `$startsWith` |
| `ends_with` | `$endsWith` |

大小写语义两侧同向,直译不开契约缝:better-auth 的 `Where.mode` 默认
`"sensitive"`,`$startsWith` / `$endsWith` 按 #5701 Q2=A 在契约层也是大小写敏感。

**二、链尾未识别算子响亮抛错**,不再静默丢。错误信息带算子名、字段名与受支持算子
清单,本身就是操作指引。这是 restore-invariant:否则 better-auth 下次加算子时,
这个洞会以完全相同的方式重开一次。

## 对使用方的影响

- 用上述三个算子的查询**从「返回全表 / 写错行」变成「按谓词正确过滤」**。这是缺陷
  修复,不是可依赖行为的移除 —— 但依赖「`starts_with` 检索能列出全部用户」的脚本会
  看到结果变化。
- 传入**词表之外**的算子从「静默忽略该条件」变成**抛错**。今天没有活体调用方能命中
  这一支(`/admin/list-users` 的两个参数都由 better-auth 自己的 zod 枚举把关),它面向
  的是将来:better-auth 长出第十二个算子时,查询会在第一次执行就失败,而不是悄悄放大。
  该分支同时是编译期哨兵(`never` 收敛),`pnpm --filter @objectstack/plugin-auth
  typecheck` 会先一步报错。
- `Where.mode: 'insensitive'` **不在**本次范围内,也不会被这条拒收波及 —— `mode` 是
  `operator` 的兄弟字段而非算子,今天仍被忽略(#5814,决策箱中)。
