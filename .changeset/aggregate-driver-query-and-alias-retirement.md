---
"@objectstack/driver-sql": major
"@objectstack/driver-turso": major
---

refactor(drivers)!: `aggregate` 的 query 参数收窄到 `DriverQuery`，并退役 `aggregate` / `func` 两个未声明别名 (#6212 批 B、#6321)

#5181（PR #6076）收窄了 `IDataDriver` 声明的六个方法，#6075（PR #6210）让五个驱动的实现跟上，#6212 批 A+E 处理了 SQL 驱动自有的另两道门。本次是同一条线上的 `aggregate`：`driver-sql`、`driver-turso` 的转发层与 `RemoteTransport` 三处，全部从 `query: any` 收到 `DriverQuery`（`@objectstack/spec/contracts`）。

`any` 在 query 参数上不是「对象名没检查」，而是**检查全关**：`where` 的 filter 方言、`groupBy` 的节点联合、`aggregations` 的节点形状——而这三样恰恰是这几个方法体读的全部内容。

## 一、退役两个协议从未声明的别名（#6321，ADR-0049）

```ts
const aggregates = query.aggregations || query.aggregate;   // driver-sql
const funcName   = agg.function      || agg.func;
const aggregations = query?.aggregations || query?.aggregate || [];   // RemoteTransport
const func         = String(agg.function || agg.func || '');
```

`QueryASTSchema` 声明的是 `aggregations`，`AggregationNodeSchema` 声明的是 `function`；`aggregate` / `func` 在 `packages/spec` 里**一个字都没有**。实测全仓唯一书写者是这两个驱动包自己的 fixture（`sql-driver-advanced` 7 处、`sql-driver-queryast` 1 处、`sqlite-wasm-driver-advanced` 7 处、`sqlite-wasm-driver-queryast` 1 处），非测试面零书写者——#4984 那一家：**fixture 拼着别名，宽容分支就永远绿着活下去，没有任何测试能在删掉它时转红**。fixture 已按已声明拼写重拼，写者归零，PD#12 与 ADR-0049 enforce-or-remove 于是把这两条 `||` 一并删掉。

顺带删掉的还有 `|| ''`：它只在**两个键都没写**时才生效，而那时这一面把名字回引成 `""`、本地面回引成 `"undefined"`，同一份越界输入两种措辞（#5240）。别名在时这条岔路够不着，删别名恰恰让它够得着，所以同一次关掉。

**迁移**：`aggregate:` → `aggregations:`，`func:` → `function:`。写旧拼写的内联字面量现在是编译错误（TS2353）；越过 `tsc` 的 JS 调用方，`aggregate:` 会静默拿不到聚合列，`func:` 则拿到已有的具名 400（`INVALID_QUERY`，#5907）。本仓实测需要改动的非测试调用点为零。

## 二、一处真实行为改动：`RemoteTransport` 现在会编 `GroupByNode` 联合

`GroupByNodeSchema` 是 `z.union([z.string(), z.object({ field, dateGranularity?, alias? })])`，而这一层把它当 `string[]` 读。收窄后 `tsc` 直接把这条假设摆上台面（TS2322）。联合的两半状况完全不同，所以这不是一个 cast 能了事的：

- **无 granularity 的结构化条目**（`{ field: 'region' }`）是 spec 合法、且**今天就会下推到驱动**的形状：objectql 的 aggregate 派发对它一律判为「受支持」（`engine.ts` 里逐字写着 `plain {field} object is fine`），`objectql/src/secret-fields.test.ts:341` 就是这个形状的活体。本驱动的**本地面**把它编成普通的 `GROUP BY "region"`，远端面却把它插值成 `"[object Object]"`、死在标识符安全检查里——一条查询两种答案、由连接串决定，正是 #6203 那个形状，而且**是活体不是休眠**：能力位 `queryDateGranularity` 只管带 granularity 的那一半，管不到这一半。现在读 `.field`，两面收敛。
- **带 dateGranularity 的条目**远端确实编不出来，而这一点是**已声明**的：remote 模式发布 `queryDateGranularity: {}`，引擎据此全部落到内存分桶，因此不会下推。缺的是「绕过能力位、直连驱动」的那个调用方该得到什么答案——现在得到 ADR-0112 信封（`NOT_IMPLEMENTED` / 501），与聚合函数「协议已声明、本后端编不出」用的是同一类，而不是一句 SQL 注入告警。

`alias` **不读**，与本地面一致：`SqlDriver.aggregate` 也不读它，只在这一面读会是新的分叉而不是修复。

## 三、`SqlDriver` 那一面的同一条件也换上了信封

`SqlDriver.aggregate` 对「本方言编不出这个 granularity」原本抛裸 `Error`（`code`/`status` 皆 `undefined` ⇒ `mapDataError` 落默认分支，一个具名能力缺口以不透明 500 到达调用方）。只给远端面加信封就会造出 #5907 花一整个 issue 才关掉的那种分叉——`TursoDriver` 由 `url` 选面，同一条件不能有两种线上身份。两面首句逐字一致（`Date bucketing by '<g>' is not supported by this backend.`），尾句各报**本面**编得出的 granularity，由一条跨包 parity 用例比对两个**运行时**消息钉住。

**消息文本变更**（可能影响按文本匹配的下游断言）：

```
- SqlDriver: dateGranularity 'week' not supported on dialect 'better-sqlite3'. Engine must fall back to in-memory bucketing.
+ Date bucketing by 'week' is not supported by this backend. Bucketed here: day, month, quarter, year (dialect 'better-sqlite3'). … (code=NOT_IMPLEMENTED, status=501)
```

## 定级依据

标 major 与 #5181 / #6075 / #6210 一致：**源码级破坏性**（调用点内联字面量、以及被删的两个别名键），加上第二、三节两处真实的运行期改动。`check:api-surface` 只记录导出的存在与否、不记录签名，所以这条说明是该变更唯一的下游载体。

`driver-sqlite-wasm` 未列入：它整个继承 `SqlDriver.aggregate`，自身源码零改动（改的只有它的 fixture 与一条断言）——与批 A+E 的处理一致。它读的是 driver-sql 的 `dist/*.d.ts`，因此验证时**必须先重建 driver-sql** 再 typecheck/test，否则是假绿。

<!-- adr-0087: registered driver-aggregate-undeclared-key-aliases-removed -->
