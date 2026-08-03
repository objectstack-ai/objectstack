---
"@objectstack/spec": major
---

BREAKING(spec): 退役 L1「Simple Sync」整层(`@objectstack/spec/automation` 的 `DataSyncConfig` 一族,17 个导出名),并把 `@objectstack/spec/integration` 的冲突策略枚举改名 `ConflictResolution` → `ConnectorConflictResolution`;裸名 `ConflictResolution` 现在全包唯一地指 `@objectstack/spec/ui` 的离线同步概念 (#4738, #4535 C13+C15)

`DataSyncConfig(Schema)` 曾由 `./automation` 与 `./integration` 各自导出一个声明,`ConflictResolution(Schema)` 更是**三个入口三个声明**(#4411 陷阱):

| 名字 | 入口 | 词表/形状 | 处置 |
|:--|:--|:--|:--|
| `DataSyncConfig` | `./automation`(**删除**) | 19 键,direction=push/pull,batchSize 默认 100 | 随 L1 整层退役 |
| `DataSyncConfig` | `./integration`(**保名不动**) | 9 键,direction=import/export/bidirectional,batchSize 默认 1000 | 唯一真源(`ConnectorSchema.syncConfig` 活解析路径) |
| `ConflictResolution` | `./automation`(**删除**) | `destination_wins` / `merge` 等 5 值 | 随 L1 整层退役 |
| `ConflictResolution` | `./integration`(**改名**) | `target_wins` 等 4 值 | → `ConnectorConflictResolution(Schema)`,枚举值逐字不变 |
| `ConflictResolution` | `./ui`(**一字不动**) | `client_wins` / `server_wins` / `manual` / `last_write_wins` | 裸名唯一归属(objectui 实活消费) |

**automation 侧是叙事层,不是实现**:L1「Simple Sync」只存在于 `SYNC_ARCHITECTURE.md` 的三层故事里 —— 三仓(objectstack / cloud / objectui)import 语句级零消费者,没有任何引擎解析或执行过 `DataSyncConfig`,8 个 def 从元数据根真 Zod 图不可达(#4650 门禁实测)。整文件删除:`DataSyncConfig(Schema)`、`ConflictResolution(Schema)`、`SyncDirection(Schema)`、`SyncMode(Schema)`、`DataSourceConfig(Schema)`、`DataDestinationConfig(Schema)`、`SyncExecutionStatus(Schema)`、`SyncExecutionResult(Schema)`、`Sync` 工厂。

## FROM → TO

```ts
// FROM —— 编译期起以 TS2305 失败(实测三仓零命中,预期无人受影响)
import { DataSyncConfig, ConflictResolution, Sync } from '@objectstack/spec/automation';
```

- 若你要的是**连接器同步策略配置**(唯一活着的服务端 sync 面):

  ```ts
  // TO —— ConnectorSchema.syncConfig 的类型;裸名保持不变
  import { DataSyncConfig, ConnectorConflictResolution } from '@objectstack/spec/integration';
  ```

- 若你要的是**多源转换管道**:`import { ETLPipeline } from '@objectstack/spec/automation'`。
- 若你要的是**客户端离线冲突策略**:`import { ConflictResolution } from '@objectstack/spec/ui'`(本次未动)。

```ts
// FROM —— integration 侧旧名,编译期起以 TS2305 失败
import { ConflictResolution, ConflictResolutionSchema } from '@objectstack/spec/integration';

// TO —— 同一声明、同一词表,只是名字带上了域前缀
import { ConnectorConflictResolution, ConnectorConflictResolutionSchema } from '@objectstack/spec/integration';
```

**零元数据迁移**:integration 改名只动 TS 导出名,`connectors[].syncConfig.conflictResolution` 的取值域(`source_wins` / `target_wins` / `latest_wins` / `manual`)逐字节不变,已发布的 connector 元数据原样解析(def 改名走 `RENAMED_DEFS` 承接表,0-key carry);automation 删除侧没有任何存量元数据可迁 —— 无解析站点即无作者,conversion 写不出能跑到的(不在 stack 树,`converge-activation-event-schema` 先例论证)。相邻雷勿踩:`@objectstack/spec/api` 的 `ConflictResolutionStrategy`(路由冲突,`error` / `priority` / `first-wins` / `last-wins`)是第四个同族概念、不同名,本次未动。
