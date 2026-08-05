---
'@objectstack/runtime': patch
---

fix(runtime): `callData('delete', …)` 的 ObjectQL 兜底返回 spec 声明的 `{ object, id, success }`,与 protocol 路径同形 (#5581)

`callData` 是 protocol 优先 + ObjectQL 兜底,两条路径此前对「删除成功」给的是两种形状:

| 路径 | 此前 | 现在 |
|---|---|---|
| protocol(`deleteData`) | `{ object, id, success: true }` | 不变 |
| ObjectQL 兜底 | `{ object, id, deleted: true }` | `{ object, id, success: true }` |

规范只有一个:`DeleteDataResponseSchema`(`packages/spec/src/api/protocol.zod.ts`)声明的是
`{ object, id, success }`,`deleted` 从未被任何 schema 声明;公开的 HTTP 文档
(`content/docs/protocol/kernel/http-protocol.mdx`)也一直写的是 `success`。所以兜底是唯一
的偏离方,protocol 路径与 spec、与文档都无需改动。

这是 #5138 同一族缺陷的成功侧:#5138 收敛的是「记录不存在」的答案,本次收敛的是「删除成功」
的答案 —— 后者是每一次正常请求都会走到的面,而非只在 id 写错时才碰到。此前按
`DeleteDataResponseSchema` 写的客户端,在**未注册 `protocol` 槽**的精简装配上会从一个 HTTP 200
里读到 `success === undefined`,即「删除到底成没成功」读不出来,而调用方无从分辨自己走的是哪条
路径。消费端各自兼容 `success ?? deleted` 两种拼写正是 contract-first 禁止的形状,所以修在
生产方,不在消费方。

## ⚠️ 升级须知(行为变化)

**仅影响没有安装 `MetadataPlugin`(`@objectstack/metadata-protocol`,即注册 `protocol` 槽)的
精简装配。** 装了该插件的部署走 protocol 优先路径,本来就返回 `success`,不受影响。

在这类精简装配上,以下三个面的 `DELETE` 成功体键名由 `deleted` 改为 `success`:

- `DELETE /api/v1/data/:object/:id`
- MCP 的 `delete_record` 工具(`domains/mcp.ts` 的 `remove` 桥)
- 声明式端点(`objectParams.operation: 'delete'`,#5092)

若你的代码读的是 `response.data.deleted`,请改读 `response.data.success` —— 这也是 spec 与
公开文档自始至终声明的键。删除行为本身(含 #5138 落的「记录不存在则 404 `RECORD_NOT_FOUND`
且不发出写」)完全未变,变的只有成功体拼写这一个键。
