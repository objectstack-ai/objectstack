---
"@objectstack/spec": major
---

BREAKING(spec): `EnvironmentArtifact` 信封收敛为单一声明 —— `@objectstack/spec/system` 持有活的 wire 形状,`@objectstack/spec/cloud` re-export;从未实现的 v0 家族(`functions` / `manifest` / `payloadRef` 及其 8 个子 schema)退役 (#4740, #4535 C10)

`EnvironmentArtifact` / `EnvironmentArtifactInput` / `EnvironmentArtifactSchema` 过去被两个入口导出,但**不是同一个声明**,拿到哪个形状只取决于 import 路径 —— #4411 陷阱:

| 入口 | 声明位置(旧) | 形状 | 状态 |
|:--|:--|:--|:--|
| `@objectstack/spec/cloud` | `cloud/environment-artifact.zod.ts` | **活的 wire 形**:`checksum` 为 64 位 hex **字符串**,`metadata` = `ObjectStackDefinitionSchema` | **活**:全仓唯一 runtime Zod parse(`packages/metadata/src/plugin.ts` `_parseAndRegisterArtifact`)与 cloud 仓全部 type import 都用这侧 |
| `@objectstack/spec/system` | `system/environment-artifact.zod.ts` | 文档化「v0」:`checksum` 为 `{ algorithm, value }` **对象**、分类袋 `metadata`、内联 `functions[]`、必填 `manifest`、保留位 `payloadRef` | **declared-only**:三仓(objectstack / cloud / objectui)零代码消费者,从未有任何 producer 产出过该形状 |

两侧互相解析不过(checksum 类型硬冲突)。按维护者裁决(#4740,路线 A′):**单一声明落 `./system`、取活的 wire 形状,`./cloud` 改为 re-export 同一声明** —— 两个入口现在解析到同一批符号,对活消费者零迁移。

## FROM → TO

```ts
// 不变 —— cloud 入口的名字与形状都没变,只是声明搬家(re-export)
import { EnvironmentArtifactSchema, type EnvironmentArtifact } from '@objectstack/spec/cloud';

// 不变(形状变了!)—— system 入口同名导出仍在,但现在是活的 wire 形:
//   checksum: string(64 hex) 而非 { algorithm, value } 对象
//   metadata: ObjectStackDefinition 而非分类袋
import { EnvironmentArtifactSchema, type EnvironmentArtifact } from '@objectstack/spec/system';
```

```ts
// FROM —— 编译期起将以 TS2305 失败(实测三仓零命中,预期无人受影响)
import {
  EnvironmentArtifactChecksumSchema, EnvironmentArtifactFunctionSchema,
  EnvironmentArtifactManifestSchema, EnvironmentArtifactMetadataSchema,
  EnvironmentArtifactPayloadRefSchema, EnvironmentArtifactRequirementSchema,
  EnvironmentArtifactHashAlgorithmEnum, EnvironmentArtifactFunctionLanguageEnum,
} from '@objectstack/spec/system';
// TO —— 无替代物:v0 家族从未被任何 producer/consumer 实现。
//   校验 checksum 用 Sha256DigestSchema(现同时从 ./system 与 ./cloud 导出);
//   校验 metadata 用 ObjectStackDefinitionSchema(根入口)。
```

## ⚠️ wire 形状警示(#4666 盲区:key 级门禁不可见的类型变更)

- `EnvironmentArtifact['checksum']`:对 `./system` 侧 import 者是 **`{ algorithm, value }` 对象 → 64 位 hex 字符串** 的类型变更(`./cloud` 侧一直是字符串,不变)。线上 wire 从来只有字符串形;pin 测试钉住「旧对象形 → 拒;hex 字符串 → 过」。
- `EnvironmentArtifact['metadata']`:对 `./system` 侧 import 者从宽松分类袋(passthrough)变为受 `ObjectStackDefinitionSchema` 校验的编译产物。
- 退役键 `functions` / `manifest` / `payloadRef` 走 `retiredKey()` tombstone:作者写入即得升级指引(tsc 处 `never`,parse 处 prescription),不是静默剥离。

## 退役论证(#4734 先例逐条评估,不照抄)

**无 ADR-0087 D2/D3 conversion**:信封是**传输形状**,不是 authorable 元数据 —— 不作为 `sys_metadata` 行落库、不在 conversion walker 走的 stack 树上;且 `objectstack compile` 与控制面从未产出过这三个键(cloud 仓 `cloud-artifact-helpers.ts` 一直写 hex 字符串 checksum;函数代码走独立 runtimeModule,从不内联)。存量行**不可能携带**,conversion 写不出能跑到的 fixture(`converge-activation-event-schema` 同款论证)。tombstone prescription 即迁移文档。

## 定级理由(逐条自证)

定 **major**:`./system` 的 16 个已发布导出名(8 schema const + 8 type)消失,外部 import 将以 TS2305 失败 —— 与 C14 / C16 同形,但**实测三仓 import 级零命中**。同时:

- **零元数据迁移**:被删 9 个 def(`system/EnvironmentArtifact` 全家)均不从 `BUILTIN_METADATA_TYPE_SCHEMAS` 元数据根可达,#4650 门禁对 `authorable-surface.json` 被删 46 行的实跑判定是 7 组「def no longer emitted by this build」自证路径(输出见 PR);无 conversion / migration,`spec-changes.json` / upgrade-guide 零变化。
- **runtime 零行为变化**:`packages/metadata/src/plugin.ts` 的 parse 目标形状就是收敛后的形状,一字未动。
- cloud 仓 3 处 type import(`artifact-api-client.ts` / `file-artifact-api-client.ts` / `registry-reader.ts`,均 `spec/cloud`)名字与形状均不变。
- JSON Schema 产物:`system/EnvironmentArtifact*` 9 个 def 停止发布(`json-schema.manifest.json` 同步删键,#2978 蓄意移除通道);新增 `system/Sha256Digest`(声明随家搬迁,`./cloud` 仍导出)。

## 基线 6 → 3

`dual-source-exports.baseline.json` 删掉 `EnvironmentArtifact` / `EnvironmentArtifactInput` / `EnvironmentArtifactSchema` 三行,其余行一字未动。
