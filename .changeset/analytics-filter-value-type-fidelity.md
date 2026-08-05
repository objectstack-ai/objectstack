---
"@objectstack/service-analytics": patch
---

fix(service-analytics): 过滤值不再被降级成字符串 —— `{code: {$eq: '007'}}` / `'null'` / `'true'` 按作者写的字面值绑定 (#5526)

analytics 的 `filter-normalizer` 内部把每个比较数(comparand)压成 `values: string[]`
再由消费方**猜**回类型:出口是 `stringifyForCube`,入口是 `recoverNumber` 与
`coerceFilterValueForSql` / `coerceFilterValueForObjectQL`。字母表是"全体字符串"、
解码规则是"这串看起来像不像数字/布尔/null"的编码没有任何转义机制,于是作者写的字符串
和编码器为其他类型写下的 token 撞车。`{code: {$eq: v}}` 在 `main` 上实测:

| 作者的 `v` | SQL 绑定 | 引擎绑定 |
|---|---|---|
| `'007'`  | `7`(#5528 已修) | `7`(#5528 已修) |
| `'1.50'` | `1.5`(#5528 已修) | `1.5`(#5528 已修) |
| `'null'` | 真 NULL | 真 `null` |
| `'true'` | `1` | `true` |

每一行都是一个缺陷:存着作者那种写法的 TEXT 列不再匹配。`'007'` 在 SQLite 上是
整数与 TEXT 列的跨类型比较、恒不相等,在 Postgres 上 `text = integer` 直接报类型错;
`'null'` 那一行比"空"更糟 —— 与真 NULL 的比较对任何行都是 UNKNOWN,图表永远画不出东西。
零填充串、当枚举码用的 `'true'`/`'false'`、当字面标签用的 `'null'` 都是真实业务形状
(订单号、SKU、邮编、国际长途区号)。

**修法**:`NormalizedFilterNode` 的 leaf `values` 由 `string[]` 改为 `unknown[]`,
作者写的值原样穿过整棵树,不再有任何东西去解码它。仅在边界真正要求时才转换:

- `toSqlBindValue`(唯一留下的转换,且是**单向**的:值 → 它的 SQL 绑定形态,不是解码器)
  ——只处理驱动绑不了的 JS 类型:`boolean` → `1`/`0`(better-sqlite3 拒绝 JS 布尔)、
  `Date` → ISO 文本、其他对象 → JSON 文本。它不检查任何字符串。
- LIKE 族的比较数被 `filter.zod.ts` 声明为 `z.string()`,所以在发射点字符串化 ——
  与 `driver-sql` 的 `applyLike` 同一个 `String(value)`,两个面上 `$contains` 仍是一件事。

ObjectQL 引擎路径现在不需要任何转换:引擎按**存储**的运行时类型比较,而它拿到的就是
作者写的值。`stringifyForCube` / `recoverNumber` / `coerceFilterValueForSql` /
`coerceFilterValueForObjectQL` 一并删除。

两处读法作为直接后果改变了,方向都是 fail-closed:

- `{name: {$contains: null}}` 原先编译成 `LIKE '%%'` —— 匹配**每一个**非 NULL 行,
  因为 `stringifyForCube(null)` 是 `''`;现在是 `LIKE '%null%'`,与 `driver-sql`
  一直以来的编译结果一致。
- `{amount: {$gt: null}}` 原先编译成 `amount > ''`(一次针对空字符串的真实比较);
  现在绑定 NULL,谓词为 UNKNOWN、图表画不出行 —— 无序比较数的诚实答案,也是
  `driver-memory` / `formula` 给出的答案。(#5332 明确指出这个比较数位置没有任何裁决
  覆盖、`''` 只是占位符;删掉编码器就按构造把它定了。)

`timeDimensions[].dateRange` 的两个边界现在按 spec 声明的类型(`string[]`)原样传递:
原先它们也过 `coerceFilterValueForObjectQL`,其文档宣称"epoch-ms 边界会还原成数字"——
那是消费方在宽容地兜一个契约并未声明的形状,和把 `'007'` 读成 `7` 是同一个猜测
(Prime Directive #12:epoch-ms 窗口要么在生产者、要么在 spec 里声明,不在这里猜)。

`{stage: null}` / `{$eq: null}` / `{$ne: null}` / `{$null:}` / `{$exists:}` 的空值
谓词语义(#5332 / #5525)不变:真 `null` 比较数编译成 `notSet` / `set`,从不进入
`values`。#5567 的 LIKE 转义契约不变。
