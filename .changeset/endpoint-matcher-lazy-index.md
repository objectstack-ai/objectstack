---
"@objectstack/metadata": minor
---

feat(metadata): 端点匹配器 —— `MetadataManager.matchEndpoint` 惰性索引实现 (#5089)

`IMetadataService.matchEndpoint?` 的契约在 #5080/#5097 落地(声明先行),本变更补上
`metadata` 槽位占位者 `MetadataManager` 的实现:把已声明的 `api` 元数据条目编成
**METHOD → 精确路径 → 端点** 的惰性索引,供 HTTP 分发器在「没有内建域认领这条路径」
与「回答语义 404」之间做一次查表。这是 #5040 端点执行器程序的 E2 单。

**结构性不可达,零行为变更。** 17.x 里没有任何东西会调用 `matchEndpoint`:挂载 seam
是 #5090 的面,而 publish/validate 对非空 `apis:` 仍然硬拒(#4936)。新代码在真实组合
里不暴露任何 HTTP 行为;测试直接驱动服务,这正是 #5040 设计选定的验收姿态。

实现要点(逐字实现契约文本,`packages/spec/src/contracts/metadata-service.ts`):

- **匹配维度**:`method` 大写规整后比较(请求动词大小写不敏感);`path` 去掉**一个**
  尾斜杠后**整串精确**比较,两侧同规则。17.x 不做百分号解码、不做 Unicode 规整、
  不做大小写折叠 —— 原串即键。词表(ADR-0121)未定义任何路径模板语法,因此
  `params` **恒为 `{}`**;此处不发明只存在于实现里的方言。
- **答案是 parse 后的形状**:每条经 `ApiEndpointSchema.safeParse`,默认值已物化 ——
  作者省略 `authRequired` 时消费方拿到的是 `true`,不可能把「缺省」误读为放行。
- **坏条目响亮缺席**:解析失败的存量条目被跳过并以 `error` 级点名(说明该路由将回 404
  及如何修),绝不返回半合法形状,也绝不牵连同批的好条目。
- **重复声明确定性收敛**:两条条目声明同一 METHOD+path 时,`name` 字典序在前者保留
  路由,被弃者连同规则一并 `error` 级点名 —— 不是静默 last-write-wins,每个节点、每次
  启动的解析结果一致。
- **断存储抛错,不伪装 404**:`undefined` 只表示「无声明拥有这条路由」;读不到存储时
  抛出(与 `loadDiagnosed` 的 miss/outage 之分同源,ADR-0110 D3),因为 miss 会变成
  404,而故障不得伪装成 404。构建失败不缓存,下次调用重试。
- **失效**:挂在仓内既有机制上,不新造事件系统 —— `invalidateListCache('api')` 覆盖
  全部本地写入(含 artifact 装载 / HMR 的 `{ notify: false }` 写入,这些按构造不经过
  watcher),`subscribe('api', …)` 覆盖集群对端回放(它只经 `notifyWatchersLocal`)。
  失效后下次调用整体重建。

`ApiEndpointSchema` 与 `packages/spec` 未做任何改动(词表冻结)。
