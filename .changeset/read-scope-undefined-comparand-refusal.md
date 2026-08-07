---
"@objectstack/service-analytics": patch
---

fix(analytics): read scope 里的 `undefined` 比较数改为拒收，不再编成绑了 `undefined` 的合法 SQL (#6125)

**⚠️ 行为变更。** `compileScopedFilterToSql` 遇到比较数位置上的 `undefined`，从「编出合法 SQL、绑一个 `undefined`、匹配零行、零日志」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。

## 实测到的毛病

#6050 于 2026-08-07 裁定（B 案）：比较数位置的 `undefined` 一律拒收，并落在了**已证实可触达**的 `driver-sql` / `driver-turso` 两面。#6125 在同一轮把仓内其余求值面逐格实测，同一个形状拿到五种读法；本条改的是其中一格 —— `service-analytics` 的 `read-scope-sql.ts`。在 `d8e8d9cbc` 上把本次拒收关掉复测，alias `t`、字段 `d`，四格与 #6125 正文表一致：

| read scope | 编译结果 | 绑定表 |
|---|---|---|
| `{ d: undefined }` | `"t"."d" = ?` | `[undefined]` |
| `{ d: { $gt: undefined } }` | `"t"."d" > ?` | `[undefined]` |
| `{ d: { $in: [undefined] } }` | `"t"."d" IN (?)` | `[undefined]` |
| `{ $not: { d: undefined } }` | `NOT (("t"."d" IS NOT NULL AND "t"."d" = ?))` | `[undefined]` |

绑定表里是 JS 的 `undefined` 本身，不是 `null`：`applyReadScope`（`native-sql-strategy.ts`）在把 `?` 改写成 `$N` 时原样 `push(scopeParams[i])`。所以 NULL 是**驱动**对一个 JS `undefined` 的读法 —— 同一格在不肯猜的驱动上则是一句裸 `Undefined binding(s)` 崩溃。一次绑定、两种败法，取决于数据源恰好挂的是哪个驱动，这正是它该在编译器处拒收、而不是在某一个消费者处修补的理由。

方向与 #6050 不同，如实记：那边是**越权**（`{ owner_id: ctx.user?.id }` 在 Turso remote 上编成 `IS NULL`，匹配全环境行）；这边是 fail-**closed** —— 匹配零行，永远不会多给行。所以它不是潜伏的权限绕过，#6125 也没有按那个级别定级。之所以照样拒收：一个「答了没人问的问题、且一条日志都不报」的 read scope，与一个真的生效了的 read scope 在外部完全无法区分。本次改动的价值就是把沉默变成响亮。

## 修法

一道闸落在 `compileField` 的开头 —— 在 `quoteIdent` 之后（不安全标识符是注入向量，保留它自己的措辞与优先级），在任何 `bind()` 之前。

拒收的**位置**逐个清点，因为「比较数」是位置而不是类型：直接比较数（`{ d: undefined }`）、单值算子的比较数（`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族）、列表算子数组的**成员**（`$in`/`$nin`/`$between`）。四格共用**一条**措辞，只有 `path` 不同（#5240「一个条件，一种措辞」）。

信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #6050 的 `INVALID_FILTER` / 400：read scope 的 filter 由平台自己从 CEL 与库存 metadata 编译而来，不是调用方输入 —— 报 400 等于让调用方去修一个他既没写、也改不动的东西。消息里指名要修的是**生产者**（管理员写的共享规则 / 权限集、它的 CEL 下降、或进程内拼这条 FilterCondition 的代码），并按 #5367 只进日志、不进响应体。

三个位置**故意不扫**，各自因为本模块已经用更贴切的诊断拒了它：`$null` / `$exists`（比较数是声明的布尔量，不是比较数位置）、直接位置上的裸数组（`compileField` 整体拒「用 `{ $in: [...] }`」）、以及约束对象里的非 `$` 键（那是嵌套关系，改写成 `null` 一样编不过 —— 这一条是与 `driver-sql` 孪生实现的唯一有意分歧，来自本模块拒收嵌套关系，而不是对 #6050 的另一种读法）。

## ⛔ `null` 一字未动

`{ d: null }` / `{ $eq: null }` → `IS NULL`；`{ $ne: null }` → `IS NOT NULL`；`$null` / `$exists`、`$in: [null]`、`$nin: [null]`、`$between: [null, 5]`、`$contains: null`（`%null%`，#5526）、以及 `$not` 下的各式 —— SQL 与绑定表逐字节不变。这是本次改动唯一可能造成伤害的方向（模块里每张极性表都只用一个 `===` 把 `null` 与 `undefined` 分开），所以它有自己的对照组回归 pin。

## 刻意不动的邻居

- ⛔ `@objectstack/formula` 把同一个 `undefined` 读作「这个键在记录里不存在」—— 那是**第三种语义**，不是第三个 bug 拼写，也正是 #5299 在争的问题。在这里顺手改掉等于替 #5299 拍板。
- ⛔ `driver-memory` / `driver-mongodb` 维持 #5499 投入冻结，只 pin 不改。后果是本编译器与 `driver-memory` 在这一格上从此不一致 —— 这是裁决接受的代价，解冻时一并还，账记在 #6125。
- ⛔ `driver-sql` / `driver-turso` 已由 #6050 落地，未触碰。
