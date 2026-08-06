---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): 分层读的 overlay 读失败不再被画成「这一项没有定制」(#5707)

`getMetaItemLayered` 是 Studio「code / overlay / effective」对比视图背后的那次读
(`GET /api/v1/meta/:type/:name?layers=true`)。它的 `sys_metadata` overlay 读裹着一个
裸 `catch`,注释写着 "DB unavailable — overlay stays null" 然后照「没有 overlay 行」
返回。

那不是一个中性的兜底值。这个信封在**同一次响应里同时给出三个正面断言**,而且是 200:

- `overlay: null` —— 「这一项从来没有被定制过」;
- `overlayScope: null` —— 「org 和 env 两个作用域都没有行」;
- `effective === code` —— 「现在生效的就是打包件原样」。

对比视图存在的意义正是回答作者「我改过什么」。故障期它回答「什么都没改过」——
和 #5532 同一个错误(可用性故障被讲成作者的声明事实),只是落在 diff 视图而不是 404 上。
本次沿用 #5532 / PR #5705 的判定,补上该 PR 按 scope 刻意没有覆盖到的这一处读。

**改了什么**:这一处 `catch` 改为调用同文件的 `rethrowUnlessMetadataStoreUnprovisioned`
—— `isMissingTableError`(表尚未建 → 确实没有 overlay 行)良性放行,其余上抛
`status: 503` / `code: SERVICE_UNAVAILABLE`,驱动原始错误挂在 `cause` 上。没有新增
判定逻辑,也没有新的返回形状:分层信封仍是 code / overlay / effective 三**层**,而不是
每层三**态** —— 「读不到」不是一层,所以照失败上报,不再冒充某一层的取值。

**wire 可见变化**

| 场景 | 之前 | 之后 |
|---|---|---|
| `sys_metadata` 不可达 | `200` + `overlay: null` / `overlayScope: null` / `effective = code` | `503` + `SERVICE_UNAVAILABLE`(`cause` 带驱动报文),可重试 |
| org 作用域读失败、env 行本可读 | `200`,连那行 env overlay 也一并报告为「没有」 | `503`,同上 |
| `sys_metadata` 尚未建表 | `200` + 只有 code 层 | 不变 |
| 存储正常 | 不变 | 不变 |

REST 侧无需改动:`?layers=true` 与普通读共用同一个 `handleRouteError`,#5437 / #5464
的消毒与日志口原样接住。已测量的消费方处置也都已就位:objectui 的
`MetadataClient.layered()` 对非 2xx 一律 `throw`(只有 404 映射为空信封),
ResourceEditPage 的加载 `try/catch` 把它渲染成错误态而不是空白页;
`plugin-security` 的三个消费点里,两处本就有 `catch` 兜底,唯一没有的
`projectPermissionMutation` 在 503 化后反而更安全 —— 此前的静默 `null` 会让权限集
投影悄悄退回打包基线(`customized: false`),没有 declared body 时甚至会把记录
retire,而协议的 `runMutationProjector` 契约是 never throws,会把 503 收敛成
`projectionApplied: { success: false }`。
