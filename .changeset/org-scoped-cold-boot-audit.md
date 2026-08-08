---
'@objectstack/metadata-protocol': patch
---

冷启动跳过的 org 作用域元数据行不再无声消失

`loadMetaFromDb` 按 ADR-0005(2026-05 修订)只水合 `organization_id IS NULL` 的行,
per-org overlay 由 `getMetaItem`/`getMetaItems` 按需加载——对注册表里
`allowOrgOverride: true` 的类型(`view`/`dashboard`/`report` 等)这是设计本身。但对
**其余类型**,一条 org 作用域的行是平台根本没有 per-org 通道的行,而在此之前这个跳过
是**完全静默**的。

实测标本是 `flow`:它是 `allowOrgOverride: false`(#6283 / PR #6478 按 ADR-0005:57
回滚),同时 `allowRuntimeCreate: true`,所以租户在 Studio 里新建一条 flow 仍会写出
`sys_metadata.organization_id = '<org>'`——运行时 `PUT /metadata/:type/:name` 把
`resolveActiveOrganizationId` 透传给 `saveMetaItem`,而 `SysMetadataRepository.put`
对任何类型都按 `organization_id: this.organizationId` 落库。该 flow 在本进程内一直正常
触发(发布时写穿进了进程级 registry),下一次重启后被这条过滤器丢掉,`kernel:ready` 的
绑定器读的是 `getMetaItems({ type: 'flow' })`(不带 org),于是它**再也不触发,且没有任何
日志说它消失了**——`kernel:bootstrapped` 的 unbound 审计也看不见它(它压根没注册)。

现在冷启动会打一条聚合的 `warn`,按类型给出计数、抽样的 `name@org`,以及后果本身
(「A 'flow' listed here will NOT bind its triggers in this process」)和处置建议。
查询默认为空:两个收窄谓词(`organization_id IS NOT NULL` + 类型清单,清单由
`DEFAULT_METADATA_TYPE_REGISTRY` 派生而非手写)让健康部署读不到行、也不打印任何东西;
驱动若无法下推其中一个谓词,退化为多读几行而不是打出误报(JS 侧会复核两个谓词)。

加载行为**未改变**:这次只是把缺席变响亮。这类行到底该不该存在(写入侧拒绝 / 强制写成
env-wide / 让绑定器按 org 读)是 #6190 上待裁决的契约问题。
