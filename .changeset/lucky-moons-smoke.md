---
'@objectstack/metadata-protocol': patch
'@objectstack/objectql': patch
---

fix(metadata-protocol): boot 重水合按行的真实 package 绑定登记对象归属(#4636 裁 B 收官)

`loadMetaFromDb` 的 object 分支从 `engine.find` 返回的行上读 `record.packageId`,而 `sys_metadata` 的列是 snake_case 的 `package_id` —— 该表达式恒为 `undefined || 'sys_metadata'`,于是每次重启都把**绑定了包**的对象 overlay 登记在 `'sys_metadata'` 哨兵下。改为读 `package_id`,与写路径、`getMetaItems`、以及相邻的非 object 分支一致。

用户可见的行为差异:归属键同时就是包过滤键(`getAllObjects(packageId)`),所以此前一个对象在**创建时**出现在自己所属包的侧边栏过滤里,**重启之后就消失**;更要紧的是重启后的第一次编辑——boot 登记 `'sys_metadata'`、保存登记 `app.<slug>`,`registerObject` 抛 `already owned by package …` 被 `applyObjectRegistryMutation` 吞成 `console.warn`,保存回 `success: true` 而内存 schema 停在重启时的版本,这一笔编辑被静默丢弃(cloud#970 的重启面)。两侧统一到真实 id 后,过滤与编辑都跨重启成立。

`@objectstack/objectql` 仅同步 `registry.ts` 中 `isTenantAuthored` 的契约注释:PR1 标注的「这半句描述的是契约,还不是代码」随本次落地摘除。
