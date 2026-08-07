---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata-core': patch
---

fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

`sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

- **名额可回收**——归档视图不再占用名额，同名视图可以重建；
- **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
- **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
- **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

`metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。
