---
"@objectstack/driver-sql": major
"@objectstack/driver-sqlite-wasm": major
---

refactor(driver-sql)!: `SqlDriver.distinct` 的第三参收成裸 `FilterCondition`，一个静默返回全集的写法就此编译不过 (#6320)

`distinct` 不在 `IDataDriver` 上，所以 #5181（PR #6076）与 #6075（PR #6210）的收窄都没走到它，#6212 批 A+E（#6355）收的是 `analyzeQuery` / `findWithWindowFunctions`，也没覆盖它。它的方法体一直说得很清楚——`applyFilters(builder, filters)` 拿的是**实参本身**，因此它要的是 `find()` 放在 `query.where` 里的那个值，**不是 query 信封**；`filters?: any` 只是没把这句话写进类型里。

```ts
// 收窄前后都成立，一处调用点都不用改
await driver.distinct('orders', 'product', { status: 'completed' });
```

**收窄真正买到的东西，是实测出来的，不是推断的。** 三行数据（`Laptop`/`Mouse` 为 `completed`，`Ghost` 为 `pending`），逐个形状喂给 `distinct('orders','product', …)`：

| 第三参 | 收窄前 | 收窄后 |
|:--|:--|:--|
| `{ status: 'completed' }` | 返回 `["Laptop","Mouse"]` | 不变 |
| 省略 | 返回全集 | 不变 |
| `'completed'`（标量） | **编译通过，返回全集** | **编译错误** |
| `{ object, where }`（信封） | 抛 `INVALID_FILTER` / 400 | 不变 |
| `['status','=','completed']` | 抛 `INVALID_FILTER` / 400（#5158） | 不变 |

第三行就是本次消掉的那一格：一个真心想问「completed 订单里有哪些商品」的调用，编译通过，然后拿到**每一个**商品。`applyFilters` 对「真值但非对象、非数组」的 filter 不发射任何谓词（该方法尾注写着这件事），于是过滤条件被整条丢掉。方向是**放宽**——这正是 #6320 与 #5234 同族的那类「静默错答案」。

**有一格是任何类型都关不上的，本次如实写进注释而不是假装关上了。** `FilterCondition` 的键**就是字段名**，所以它是开放映射（`[key: string]: any`）：`{ object, where }` 在结构上是一个完全合法的 filter——约束两个分别叫 `object` 和 `where` 的列。没有任何注解能把它和正当 filter 分开。#6320 提出的「让反向错配也编译不过」在这个参数上**不可达**，实测确认；能拿到的保证是**运行期响亮失败**：信封里的 `where` 是对象，而没有任何比较值可以是对象，于是 `assertCompilableComparand` 抛 `INVALID_FILTER` / 400。这半边 driver-sql 从来就不是静默的；`driver-memory` 那半边（裸 filter 交给它会静默返回全集）留在 #5499 冻结面内，本次不碰。

**零运行时改动**：非测试改动 100% 是一个类型注解加一段注释，无逻辑、无行为、无 emit 差异。

**逐处复核了全部 14 个调用点**（本单正文记的是 3 处，实测偏低）：driver-sql 11 处、driver-sqlite-wasm 3 处、driver-turso 0 处；其中真正传第三参的是 4 处（driver-sql 2 + driver-sqlite-wasm 2），全部本来就写的裸 filter，**零报错、零 fixture 改动**。

**driver-sqlite-wasm 也标 major**：`SqliteWasmDriver extends SqlDriver` 且不覆写 `distinct`，所以它**已发布的 `.d.ts`** 里这个方法的签名同样收窄，它的使用者看到的是同一个变化。该包读的是 driver-sql 构建后的 `dist/*.d.ts` 而非源码，是一处已知门禁盲区，本次用「往参数类型里临时塞一个调用方不可能满足的成员、重建、看调用点是否逐一变红」证明它确实读到了新 d.ts：driver-sql 6 处红、driver-sqlite-wasm 3 处红，与预判逐一相符。

### 迁移

调用点若把**标量**（或任何非 `FilterCondition` 值）交给第三参，编译器会指出来：

```
error TS2345: Argument of type 'string' is not assignable to parameter of type 'FilterCondition'.
```

改法是把它写成它本来就该是的裸 filter 对象（`'completed'` → `{ status: 'completed' }`）。⚠️ 这类调用点在收窄前拿到的是**未过滤的全集**，所以这不是一次等价改写：修完之后返回值会变，而变化后的那个才是调用方本来想要的答案。本仓零处这样的调用点。

⚠️ 无类型的 JS 调用方**既不会拿到编译错误、也不会有任何行为变化**（本次零运行时改动）。对他们而言，上面那条是「你一直没在过滤」的**唯一通知渠道** —— 这也是本次记台账条目的理由，见下。

<!-- adr-0087: registered driver-sql-distinct-bare-filter-typed -->
