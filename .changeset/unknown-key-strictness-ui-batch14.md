---
"@objectstack/spec": major
---

feat(spec)!: 收紧 action param 选项、公开分享、报表排序、数据集语义层与仪表盘小组件的嵌套未知键（#4001 批 14）

`ui/` 方向第二波。账本重测记的 11 个 strip 站点，逐个做门测量后：**9 个收紧，2 个改判**。

## 破坏性变更 —— 9 个形状不再静默丢弃未知键

| 形状 | 文件 | 之前 |
|---|---|---|
| `ActionParamSchema.options[]` | `ui/action.zod.ts` | `{ label, value }` 之外的键被剥 |
| `SharingConfigSchema` | `ui/sharing.zod.ts` | 同上 |
| `ReportSortSchema` · `JoinedReportBlockSchema` | `ui/report.zod.ts` | 同上 |
| `DatasetDimensionSchema` · `DatasetMeasureSchema` · `.derived` | `ui/dataset.zod.ts` | 同上 |
| `DashboardWidgetSchema.compareTo`（对象分支）· `.layout` | `ui/dashboard.zod.ts` | 同上 |

**升级方式：把被拒的键改成错误信息点名的那个。** 拒绝本身就带处方 —— 它点名面、原样回显写错的键，并在可能时给出规范拼法。没有任何键被移除，也没有任何合法形状变得不合法：这些 schema 接受的键集合完全没变，变的只是「写了别的会怎样」。

其中四个是 **strict 外壳套 strip 子块** —— 容器早就 strict，但**严格性不递归**：

- `ActionParamSchema` 自 #3746 起 strict，而它的 `options[]` 条目不是。实测一个带 `color` / `visibleWhen` / `icon` / `disabled` 的选项过 `getMetadataTypeSchema('action')`，出来是 `{"label":"Overload","value":"overload"}` —— 四个键在任何 renderer 看到之前就没了，报告成功。
- `DashboardWidgetSchema` 自 ADR-0021 起 strict，而 `compareTo` 的对象分支和 `layout` 不是。
- `DatasetSchema` / `ReportSchema` 同理，漏的正是承载语义契约的那几个子形状。

### 为什么 `action` 的选项走 strict，而兄弟 `bulk-action` 走 `.passthrough()`

两边不同是**测出来的，不是照搬的**。#4909 给 bulk-action 选项条目 `.passthrough()` 的两条理由在这里都不成立：那边的 def「left as-authored」逐字到达 grid（中间没有 spec 门），且 objectui 的 `BulkActionParam` 声明了显式 `[key: string]: unknown` 兜底；这边有一道**已经在剥**的门，落点是**封闭**的 `SelectOptionMetadata` 接口。目标词汇封闭，正是「声明」胜过「容忍」的场合。action param 选项是否该讲字段级的逐选项词汇，是独立的能力问题（#5016），不在本批猜。

## 两个形状改判为第四类 `no door`，**不**收紧

`NotificationActionSchema`（`ui/notification.zod.ts`）与 `EmbedConfigSchema`（`ui/sharing.zod.ts`）**没有授权门**：没有承载键、从 24 个 metadata-type root + `defineStack` 做 BFS（6860 节点）不可达、三个仓里除自测外零 `.parse()`。收紧它们会花掉一次破坏性变更去留下「一个被精确校验的死槽位 —— 更有说服力的谎言」。ADR-0049 定去留：#5015。

`ui/sharing.zod.ts` 是账本第一个**一行两判**的文件：同一文件里 `SharingConfig` 是活门（`FormViewSchema.sharing` 承载，`rest-server.ts` 靠 `sharing.allowAnonymous` + `sharing.publicLink` 挂匿名表单路由，两个示例应用都在写），`EmbedConfig` 没有门。按文件下判断，无论落哪边都会错一半。

## 策展依据是同仓的兄弟契约，不是编辑距离

- **dataset** 锚在本模块自己 header 点名的 `data/analytics.zod.ts` Cube 层：Cube metric 的 `type` **就是**聚合函数，所以 `{ name: 'revenue', type: 'sum', field: 'amount' }` 过去 parse 干净、算出来是 `count`。`sql` 只给 guidance 不给别名 —— 把 `SUM(amount)` 指向吃字段路径的 `field`，是本战役自己要消灭的那种错误处方。
- **report** 的排序键是作者会遇到的**第三种** sort 拼法（`SortNodeSchema` 的 `{field, order}`、小组件的扁平 `sortBy`/`sortOrder`、这里的 `{by, direction}`），而且映射方向相反，任何一种都推不出来。
- **dashboard `layout`** 锚在 React-Grid-Layout：`minW`/`static`/`i` 等给逐键 guidance，而不是改名到无关的位置键上。
- **sharing** 的别名全是 camelCase 目标，兜底系统性够不着（#4990）。`allowAnonymous` 写错拼法的后果是**表单保持私有而作者以为公开**。

## 已知触及面限制（实测记录，非推断）

`compareTo` 是 union。zod 把失配 union 折叠成一条顶层 `invalid_union`（message 是裸的 `Invalid input`），分支错误挂在 `issue.errors`，而 `zodIssuesToFields` 只映射顶层 —— **处方产生了但送不到作者手上**。拒绝不受影响，这仍是 #4001 的收益。传输缺陷是 #5014，影响本战役放进 union 分支的每一条策展文案。测试对这两半**分开** pin，免得一个绿测试冒充一条没人打印的消息。
