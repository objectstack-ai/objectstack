---
"@objectstack/service-analytics": patch
---

fix(analytics): read scope 里非布尔的 `$null` / `$exists` 比较数改为拒收，不再按真值性编成相反的谓词 (#6387)

**⚠️ 行为变更。** `compileScopedFilterToSql` 遇到 `$null` / `$exists` 上的非布尔比较数，从「按 JS 真值性归入两个声明答案之一、静默编出合法 SQL」改为 `READ_SCOPE_COMPILE_FAILED` / **500** 拒收。今天靠这个静默翻转在跑的 read scope，从此会响亮地失败。

## 实测到的毛病

发射器读的是 `val ? … : …` —— **真值性**，不是 `@objectstack/spec` `FieldOperatorsSchema` 声明的 `z.boolean()`。在 `5faa23ca3` 上直接调 `compileScopedFilterToSql`，alias `t`：

| read scope | 编译结果 | |
|---|---|---|
| `{ owner_id: { $null: "false" } }`   | `"t"."owner_id" IS NULL`     | ⛔ 与作者写的意思**相反** |
| `{ owner_id: { $null: "true" } }`    | `"t"."owner_id" IS NULL`     | |
| `{ owner_id: { $null: 0 } }`         | `"t"."owner_id" IS NOT NULL` | |
| `{ owner_id: { $null: null } }`      | `"t"."owner_id" IS NOT NULL` | |
| `{ owner_id: { $null: undefined } }` | `"t"."owner_id" IS NOT NULL` | |
| `{ owner_id: { $exists: "false" } }` | `"t"."owner_id" IS NOT NULL` | ⛔ 与作者写的意思**相反** |
| `{ owner_id: { $exists: 0 } }`       | `"t"."owner_id" IS NULL`     | |
| `{ owner_id: { $exists: "no" } }`    | `"t"."owner_id" IS NOT NULL` | |

两行 ⛔ 是要害：字符串 `"false"` 是**真值**，于是它落在它被写下来所要表达的 `false` 的**对面** —— `{ $exists: "false" }` 写来表示「没有 owner 的行」，编出来是「**有** owner 的行」。这与 #6125 那一格方向相反：那边是 fail-**closed**（匹配零行、只是安静），这边是**加宽** —— admit 了策略要排除的行，出现在一个自述「A read-scope predicate must never be silently dropped、fail-closed」的模块里。

## 修法

按 #5347（`$null`）/ #5369（`$exists`）在 `driver-sql` 面确立的先例，理由逐字适用：非布尔比较数**按声明拒收**，不做强转。闸落在 `compileField`，紧挨 #6125 的 `undefined` 闸 —— 两道闸的作用域互不相交（那一道按名字跳过这两个算子），所以谁也盖不住谁的措辞。

两个算子**共用一条措辞**（#5240「一个条件一种措辞」），只有算子名与 `path` 不同：`driver-sql` 给孪生实现两条措辞，是因为各自要指名**自己**发射器默认倒向哪边；本模块只有一条规则（真值性）同时管着两个算子，两者失败方式完全一样，所以一条措辞才是诚实的写法。测试里有一条断言把「只有这两处不同」钉死。

信封沿用本模块自述的那一个（`READ_SCOPE_COMPILE_FAILED` / 500），不是 #5347 的 `INVALID_FILTER` / 400：read scope 由平台自己从 CEL 与库存 metadata 编出来，报 400 等于让调用方去修一个他既没写、也改不动的东西。继承的是**处置**（拒收），不是信封。

极性表**同 PR 一起改**：`nullValueSatisfiesOperator` 的 `$null` / `$exists` 两臂从真值性（`Boolean(value)` / `!value`）改为恒等（`value === true` / `value === false`）。每张极性表钉的是它**自己**发射器的拼写（#5146 / #5298），只改发射器不改表，不变量会安静地断在定义处。这条差异消失后，本编译器与 `driver-sql` 的同名表第一次逐臂一致。

## ⚠️ 触达性：实测结论是**库存 metadata 走不通**

定级依据是测量，不是立单时的措辞。`{ $null: <非布尔> }` **无法**从库存 metadata 走到本编译器，三道闸各自独立关死：`RowLevelSecurityPolicySchema` 把 `using` / `check` 声明为 `z.string()`（CEL 谓词，不是 FilterCondition），存对象直接被拒；CEL 下降只在两处发射 `$null` 且比较数是**硬编码布尔**（`== null` → `{$null: true}`，`!= null` → `{$null: false}`），`$exists` 一次都不发射；绕开 schema 塞裸对象会在 `sqlPredicateToCel` 里抛错，被 `getReadFilter` 的 catch 变成 `RLS_DENY_FILTER`。其余 read scope 生产者（Layer 0 租户过滤、`plugin-sharing` 的 `buildReadFilter`、controlled-by-parent、deny 哨兵）压根不含这两个算子。

**仍然开着的那条**：`getReadScope` 是 `AnalyticsPluginOptions` 上有文档的公开扩展点，宿主自带的 read scope（来自 JSON 配置或没走类型检查的 JS）与本编译器之间没有任何闸 —— 本单也确认了 `plugin-security` 全路径无 `FilterConditionSchema` / `safeParse`。所以：今天不从库存 metadata 触达，但没有任何结构性的东西挡住下一个生产者。在编译器处拒收，才让「声明为布尔」等于「强制为布尔」，与谁写这条 scope 无关。

## ⛔ 一字未动的邻居

- **合法布尔**：`$null: true/false`、`$exists: true/false` 的 SQL 逐字节不变（`IS NULL` 下降正是 RLS 用来圈无主行的写法，也是 CEL 唯一能产出的四种形状）。有自己的对照组回归 pin。
- **比较数位置上的 `null`**：`{ d: null }`、`{ $eq: null }`、`{ $ne: null }`、`$in: [null]` 等 #6125 的 `NULL_CONTROL` 全部保持绿。
- `driver-sql` / `driver-turso`（#5347 / #5369 已落地）、`packages/spec`（声明已是 `z.boolean()`）、以及本包的 `where` 门 `strategies/filter-normalizer.ts` 均未触碰。
