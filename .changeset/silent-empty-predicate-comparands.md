---
"@objectstack/driver-sql": minor
"@objectstack/service-analytics": minor
---

fix(driver-sql,service-analytics)!: 两类无意义比较对象不再编译成「静默空谓词」——`$in`/`$nin` 的对象成员与 LIKE 族的对象比较值一律拒收 (#5234)

两个形状此前都**编译通过、执行、并给出一个作者没写过的答案**,而且没有任何东西记录这件事:

| filter | 改前 | 改后 |
|---|---|---|
| `{status: {$in: ['a', {foo: 1}]}}` | 该成员绑不上任何行,查询答得**就像第二个成员从没被写过** | `INVALID_FILTER` / 400,点名 `index 1` |
| `{status: {$nin: [{foo: 1}]}}` | `NOT IN ('[object Object]')` —— **一行都没排除**,作者写下的排除悄悄没发生 | 同上 |
| `{name: {$contains: {}}}` | `LIKE '%[object Object]%'` —— 对一行文本恰好是 `[object Object]` 的记录,**真的命中了** | `INVALID_FILTER` / 400,点名 `StringOperatorSchema` |
| `{name: {$notContains: {}}}` | 反过来:为一个没人记录的理由**排除了一条真实记录** | 同上 |

#5041(PR #5223)在 `assertCompilableComparand` 的头注释里把这两个形状写为 "Deliberately NOT
extended",理由是它们 fail-closed(只收窄结果集)、比 #5041 实测的裸 `TypeError` 低一级。**实测下来这
两条理由都不成立**:`$nin` / `$notContains` 方向是**放宽**(该排除的没排除,在 read-scope 下即 #5347 /
#5324 判过的 over-reach);而 `$contains: {}` 给的从来不是「零行」,是**错行**。

## 三份实现一起动,否则修完仍是方言

同一个 `String()` 宽容在本仓有多份;只收紧 `driver-sql` 会变成「哪个面接的就是哪个答案」——
#5146 / #5332 / #5567 各花一轮消掉的那类分叉。守卫因此落在**每个包自己的收口点**,而不是三个发射器:

- **`driver-sql`** —— `assertCompilableComparand`,#5041 已有的那一个门。
- **`service-analytics` 的 `where` 门** —— `filter-normalizer.ts` 的 `fieldLeaves`。它是本包**唯一**的
  leaf 生产者,所以一处拒收同时覆盖三个消费方:`NativeSQLStrategy`(真正执行的语句)、
  `ObjectQLStrategy.generateSql`(`/analytics/sql` 回显)与 `ObjectQLStrategy.convertFilter`(引擎路径)。
  这个顺序是关键而非顺手:`convertFilter` 是**生产者**,在那里 `String()` 会把对象洗成一个类型完全正确
  的 `'[object Object]'` 字符串交给驱动,下游再严格的驱动也永远看不到它该严格的那个形状。
- **`service-analytics` 的 read-scope 门** —— `read-scope-sql.ts` 的 `compileOperator`,它编译的
  `FilterCondition` 不经过上面那个门。

`like-pattern.ts` 与 `applyLike` 里的 `String(value)` **原样保留**:它们不再是缺陷所在,因为门前已经没有
渲染不出来的值能到达。两包的谓词由 `like-metacharacter-escape.test.ts` 逐值互锁——正是该文件已经用来锁
转义表达式的同一套办法。

## 围栏是 allow-list,而且每一条都是实测后决定的

抄 `driver-turso` `RemoteTransport` 的形状(cloud#1004 / #1058):deny-list 会把下一个被发明出来的值形状
悄悄放进来,这正是那个 bug 熬过第一次修复的原因。顺带说明,**turso 自 #1058 起就已经拒收这两个形状**,
所以本地 SQLite 与远程 SQLite 此前对同一条查询给的是不同答案;本次改动把它们收敛到一起。

留在围栏内的(逐条实测,不是假设):

- **数字 / 布尔 / `null`**:`{$contains: 5}` → `%5%`、`{$contains: null}` → `%null%` 在 `driver-sql`、
  `driver-memory` 与 analytics 两个面上**今天答案一致**,#5526 还专门把 `null` 这条钉住了。拒收它们是在
  **破坏**一致,不是建立一致——所以只拒**对象**。
- **`Date`**:turso 的 allow-list 把它作为唯一的对象转换保留,拒收会重新叉开本地与远程。
- **binary**:`$in` 成员照收(`isBindableComparand` 与写路径 `formatInput` 同一套分类),LIKE 拒收——它
  绑得上但渲染不出作者想要的东西。这就是两个谓词而不是一个带 flag 的原因。
- **`undefined`**:不可授权(JSON 没有 `undefined`),analytics 门按 #5526 / #5332 归一为 `null` 而非拒收;
  在 `driver-sql` 拒收它会**造出**一个分歧而不是消除一个,故照旧。

被拒的**数组**是本次唯一一个「拒收即消分叉」的形状:`{name: {$contains: ['al','be']}}` 在 `read-scope-sql`
(与 `driver-sql`)绑 `%al,be%`,在 analytics 的 `where` 门却绑 `%al%`(它读 `values[0]`,后面的成员被
静默丢弃)。同一个包对同一条 filter 有两个答案,两个门现在都拒。

## 作者需要知道的迁移

这两个形状本来就没有能用的读法——`filter.zod.ts` 的 `StringOperatorSchema` 早就把 LIKE 族比较数声明为
`z.string()`,本次只是让声明变成强制(Prime Directive #12,declared = enforced)。改后它们答 400 而不是
一个错答案;把比较数换成字面值即可。`{$eq: {…}}` **不在本次范围**,仍按 `toSqlBindValue` 绑 JSON(#5526
钉住的行为)。
