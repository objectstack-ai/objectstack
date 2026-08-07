---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol): 对象 overlay 写路径按真实 package id 记录 registry 归属,并由服务端强制盖 `_provenance: 'org'`

`applyObjectRegistryMutation` 此前把每一次对象写入都硬编码登记在 `'sys_metadata'` 哨兵下。
该归属键同时就是包过滤键(`SchemaRegistry.getAllObjects(packageId)` 匹配的是
`contributor.packageId`),因此通过 Studio 包工作区新建的对象,在自己所属包的过滤结果里
一直是空的,直到有别的路径重新登记它。现在改为使用该行真实的 `package_id`;哨兵只保留
给「没有绑定任何包」的写入,`rollbackMetaItem` 则从行本身读出绑定(而不是从请求读)。

同一次改动里,服务端在**副本**上无条件盖 `_provenance: 'org'`,不再采信请求体里的值:
只搬归属键而不盖章会立刻复活 cloud#970 —— `applyProtection` 会把带包 id 且自身没有
provenance 的 body 默认标成 `'package'`,`getArtifactItem` 据此认定它是代码制品,
`object` 又声明了 `allowOrgOverride: false`,于是用户刚建好的对象在下一次保存时收到
`403 not_overridable`。`metadata-read-decorations.ts` 有意不剥离 `_provenance`,
Studio 的 GET → PUT 往返会把它原样送回,所以这个事实必须由服务端陈述。
