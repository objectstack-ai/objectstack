---
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

fix(drivers): refuse an `undefined` filter comparand instead of crashing (SQL) or silently answering `IS NULL` (Turso remote) (#6050)

**⚠️ 行为变更(升级说明在最后一节)。** 比较数位置上的 `undefined` 从「静默/崩溃」变为 `INVALID_FILTER` / 400 拒收。作者侧的修法是显式判空,或改用 `null` / `$null`。

## 实测到的毛病

同一个 `TursoDriver`,同一条过滤器,答案取决于它是用哪个 `url` 构造的 —— 四行 fixture(`d` 在 1-2 有值、3-4 为 NULL),`origin/main` @ `cba7454df`:

| filter | LOCAL(继承 `SqlDriver`) | REMOTE(`RemoteTransport`) |
|---|---|---|
| `{ d: undefined }` | 抛裸 knex `Undefined binding(s)` | `['3','4']` |
| `{ d: { $eq: undefined } }` | 抛裸 knex `Undefined binding(s)` | `['3','4']` |
| `{ $not: { d: undefined } }` | 抛裸 knex `Undefined binding(s)` | `['1','2']` |
| `{ d: { $ne: undefined } }` | `['1','2']` | `['1','2']` |
| `{ $not: { d: { $ne: undefined } } }` | `[]` | `['3','4']` |
| `{ d: { $in: [undefined] } }` | 抛裸 knex `Undefined binding(s)` | `[]` |
| `{ d: { $gt: undefined } }` | 抛裸 knex `Undefined binding(s)` | `[]` |

两个可分开的毛病:

**A —— 抛出的那几格没有 ADR-0112 信封。** knex 的 `Undefined binding(s) detected when compiling SELECT` 既没有 `code` 也没有 `status`,`mapDataError` 落默认分支,于是一条「调用方把 filter 写坏了」的错误以不透明 500 的形态到达客户端。#1116 / #4436 为这条通路清点过同类形态,唯独漏了这一格。

**B —— 守卫与它自己的发射器分裂。** `$ne` 发射器读 `coerced == null`(宽松,所以 `undefined` 编译成 `IS NOT NULL` —— 一条 TOTAL 谓词),而必须钉住这个发射器的两张极性表 `operatorIsNullTotal` / `nullValueSatisfiesOperator` 读 `=== null`(严格,于是判它「不 total」且「NULL 行满足它」)。`nullGuardForFieldSpec` 因此把一条已经 total 的谓词包成 `d IS NULL OR d IS NOT NULL` —— 恒真 —— 取反后恒假,答 `[]`。这正是 #5298 立的不变量(每张极性表钉的是它自己发射器的拼写)在它自己的定义处被破坏。

## 修法

一道闸,落在比较数进入**任何**发射器或守卫之前,两个毛病同闸消灭:knex 再也见不到 undefined 绑定,守卫与发射器对 undefined 的分歧变成**不可达**而不是「被修好」。

- `driver-sql`:闸落在 `reduceFilterKey` 的校验走查上(与 `$null` / `$exists` 的拒收并排),外加 `applyFilters` 的平铺映射分支 —— `{ d: undefined }` 进不了走查(`typeof undefined` 不是 `'object'`,构不成 `hasMongoOperators`),而它恰恰是这个 bug 最常见的拼写。两处共用一个函数。
- `driver-turso`:`buildWhereSQL` 入口做一次整棵子树的前置走查。必须前置,否则 `{ $not: { d: undefined } }` 会先把操作数交给 `nullSafeNegationOperand`(一个守卫)。
- 顺带把两侧的 `== null` / `|| === undefined` 拼写统一收严成 `=== null`(#5347 收紧 `$null` 臂时给的理由:宽松拼写在闸被挪走后会悄悄恢复回答一个没人裁决过的取值)。

拒收的位置逐个清点:直接比较数、单值算子的比较数(`$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` 与 LIKE 族)、列表算子数组的**成员**(`$in`/`$nin`/`$between`)、以及嵌在 `$and`/`$or`/`$not` 里的以上各位。`$null` / `$exists` 的 `undefined` 保持它们**自己**的拒收措辞(比较数是声明的布尔量,那条消息更贴切 —— #5240「一个条件一种措辞」两个方向都适用)。两个驱动的拒收句子逐字一致。

## ⛔ `null` 一字未动

`{ f: null }`、`{ $eq: null }` → `IS NULL`;`{ $ne: null }` → `IS NOT NULL`;`$null: true/false` 不变;`null` 仍是合法的 `$in` 成员。`null` 是声明过的比较数,拒的只是 JS 里与「没有这个键」不可区分的那个值。

## 升级说明

如果你的进程内代码这样拼过 filter:

```ts
// 之前:id 缺失时 —— 本地崩、远端静默匹配全环境行
await ql.find('deal', { where: { owner_id: ctx.user?.id } });
```

现在会收到 `INVALID_FILTER` / 400,消息里带修法。两种正确写法:

```ts
// 1) 显式判空 —— 键不存在就是「不约束」
const where: Record<string, unknown> = {};
if (ctx.user?.id !== undefined) where.owner_id = ctx.user.id;

// 2) 真的想要空值谓词 —— 写出来
await ql.find('deal', { where: { owner_id: null } });          // 或
await ql.find('deal', { where: { owner_id: { $null: true } } } );
```

`where` 整体缺席仍然是「没有过滤器」(`query?.where` 为 `undefined` 是它唯一合法的位置),不受影响。

⚠️ 本次只覆盖 `driver-sql` 与 `driver-turso`(含 remote)。`driver-memory` / `driver-mongodb` 是 #5499 的投入冻结面,按裁决只测不改;`@objectstack/formula` 与 `service-analytics` 的 `read-scope-sql.ts` 对同一形状各有一种不同读法,实测记录在 #6125,留待单独裁决。
