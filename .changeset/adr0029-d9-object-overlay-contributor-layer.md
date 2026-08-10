---
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
"@objectstack/spec": minor
---

ADR-0029 D9: a tenant object overlay registers as its own contributor LAYER instead of splicing the packaged owner out

租户对 `object` 的定制（`sys_metadata` 行）此前以默认的 `own` 身份进入 `SchemaRegistry`。当该行的 `package_id` 与代码包所有者相同时，`registerObject` 会走"重复注册"分支把**打包的 contributor 直接摘掉**——打包定义不是被遮蔽，而是在写入时被销毁，注册表里不存在第二份副本；`loadMetaFromDb` 每次启动都无声重放这次销毁。

D9 把这个层次关系显式化：

- **第三种非拥有的 contributor 种类 `overlay`**，对基础层是替换语义。解析变成 `base = overlay ?? own`，extender 照旧叠在上面。**解析结果逐字节不变**（含 `_provenance: 'org'`）——变的只是注册表"记得"什么：打包的 owner 依然在下面。
- `assertSingleOwnerPerObject` **一字未改**（overlay 不是 owner），新增一类违规：孤儿 overlay（有 overlay 没有 owner）。
- **基础层的选择问"种类"，永远不问优先级**。`DEFAULT_OVERLAY_PRIORITY = 150` 只用于列举顺序：extender 的优先级是作者声明的，不能让某个包用 `priority: 140` 把租户的 overlay 挤出基础层。
- **artifact 身份改为读 owner contributor 的层**，而不是合并后的文档。这一条不是层次化改动的自然推论：合并结果按设计仍带 `_provenance: 'org'`，所以只有从 owner 层读，`isArtifactBacked` 才不再说谎。
- `provisionPrimary` / `provisionSearchCompanion` 的门从"是不是 `own`"改成"**是不是基础层**"，否则每个被 overlay 的对象的 `nameField` 都会变。
- 行上的 `package_id` 是层的**来源标记**，从来不是所有权主张：同包正常；**无包（`sys_metadata` 哨兵）予以接受**（此前的抛错是借用 `own` 槽位的副产品）；绑定到**其他包**的行在生产者侧被明确拒绝，新错误码 `OBJECT_OVERLAY_PACKAGE_MISMATCH`（422），启动时计入 `loadMetaFromDb` 的 `errors`。
- **迟到安装**：代码包为一个租户行已占据的对象名注册时，代码层成为 owner，租户的贡献被重新归类为它的 overlay 层——不再抛 "already owned by"，也不再把租户的定制吞掉。
- 删除退化为**减法**：`SchemaRegistry.removeObjectOverlay(name)` 只摘掉 overlay 层，打包 owner 原地不动，因此"恢复"根本不是一次重新注册。

**行为变化（记录在案的成本）**：谓词诚实之后，`object` 声明的 `allowOrgOverride: false` 会被**一致地**执行——对打包对象的 overlay 写入**每次**都以 `NOT_OVERRIDABLE` 拒绝，而不是只拒第一次（此前第一次被拒、并因销毁证据而让后续每次都从 `allowRuntimeCreate` 那一档混过去）。同一谓词也喂给 `deleteMetaItem` 的两档鉴权与仓库的 `assertAllowed`，所以重置该定制同样需要那道文档化的运维口子 `OS_METADATA_WRITABLE=object`——现在它必须在定制的**整个生命周期**内保持打开，而不只是第一次保存时。

`ObjectContributor.ownership` 与 `ObjectOwnershipEnum` 的联合类型因此加宽（loader 设定，永不可由作者书写），这是 `objectui` / `cloud` 消费方可见的公开类型变化。
