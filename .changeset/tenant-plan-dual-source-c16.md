---
"@objectstack/spec": major
---

BREAKING(spec): 删除 `@objectstack/spec/system` 的整个 tenant-provisioning 家族(`TenantPlan(Schema)` / `TenantRegion(Schema)` / `TenantProvisioningStatus(Enum)` / `ProvisioningStep(Schema)` / `TenantProvisioningRequest(Schema)` / `TenantProvisioningResult(Schema)`)及 `@objectstack/spec/contracts` 的 `IProvisioningService` / `ITenantRouter` / `ResolvedTenantContext` —— `TenantPlan(Schema)` 现在全包唯一地指 `@objectstack/spec/cloud` 的 5 值声明 (#4739, #4535 C16)

`TenantPlan` + `TenantPlanSchema` 过去被两个入口导出,但**不是同一个声明**,拿到哪个词表只取决于 import 路径 —— #4411 陷阱:

| 入口 | 声明位置 | 词表 | 状态 |
|:--|:--|:--|:--|
| `@objectstack/spec/cloud`(**不变,唯一真源**) | `cloud/tenant.zod.ts` | `free / starter / pro / enterprise / custom`(5 值) | **活**:嵌入 `EnvironmentSchema.plan`、`TenantContextSchema.plan`、`ProvisionTenantRequestSchema.plan`,cloud 仓 service-tenant 经这些 schema 实际消费 |
| `@objectstack/spec/system`(**本次删除**) | `system/provisioning.zod.ts` | `free / pro / enterprise`(3 值子集) | **declared-only**:仅嵌入 `TenantProvisioningRequest/Result`,该 provisioning 协议三仓(objectstack / cloud / objectui)零实现零调用 |

system 侧不是孤立的一个枚举,而是一整套从未实现的 provisioning 协议:`TenantProvisioningRequest/Result` 加上 `contracts` 里的 `IProvisioningService` / `ITenantRouter` 契约,import 语句级三仓实测**零实现、零调用、零 importer**(cloud 仓 `service-tenant` 的 `TenantProvisioningService` 是重名的本地类,消费的是 `@objectstack/spec/cloud` 的 `ProvisionTenantRequest`,与被删家族无关)。它已被 cloud 入口的 `Provision*` 家族整体取代,故按维护者裁决(#4739,路线 B)删除 system 侧全家族,cloud 侧一字未动。

## FROM → TO

```ts
// FROM —— 编译期起将以 TS2305 失败(实测三仓零命中,预期无人受影响)
import { TenantPlanSchema, type TenantPlan } from '@objectstack/spec/system';
// TO —— 唯一声明(注意词表从 3 值子集变为 5 值全集:多出 starter / custom)
import { TenantPlanSchema, type TenantPlan } from '@objectstack/spec/cloud';
```

```ts
// FROM —— TS2305
import type { TenantProvisioningRequest, TenantProvisioningResult } from '@objectstack/spec/system';
import type { IProvisioningService, ITenantRouter, ResolvedTenantContext } from '@objectstack/spec/contracts';
// TO —— 活的 provisioning 协议在 cloud 入口
import type { ProvisionTenantRequest, ProvisionTenantResponse, TenantContext } from '@objectstack/spec/cloud';
```

- `TenantRegion(Schema)` / `TenantProvisioningStatus(Enum)` / `ProvisioningStep(Schema)`:无同名替代物。region 与 step 追踪从未接入任何运行时;租户生命周期状态的活表面是 `@objectstack/spec/cloud` 的 `TenantDatabaseStatusSchema` 与 `EnvironmentSchema.status`。
- 类型收窄注意:改从 `./cloud` import 后,`TenantPlan` 联合类型从 3 值**变宽**为 5 值 —— 对 plan 做穷举 switch 的代码要补 `starter` / `custom` 两个分支(这正是双源曾经隐藏的漂移)。

## 定级理由(逐条自证,未照抄前例)

定 **major**,因为这是**已发布导出名的移除**:外部对上述 15 个导出名(`./system` 12 个 + `./contracts` 3 个)的 import 会以 TS2305 编译失败(与 C14 / C6 同形)。

同时它是**零元数据迁移**:

- 被删 6 个 def(`system/ProvisioningStep` / `system/TenantPlan` / `system/TenantProvisioningRequest` / `system/TenantProvisioningResult` / `system/TenantProvisioningStatusEnum` / `system/TenantRegion`)均不从 `BUILTIN_METADATA_TYPE_SCHEMAS` 元数据根可达 —— #4650 门禁对 `authorable-surface.json` 被删 21 行的实跑判定是三组「def no longer emitted by this build」自证路径(输出见 PR),**无 tombstone、无 ADR-0087 conversion / migration**(`spec-changes.json` / upgrade-guide 两 gate 零变化)。
- 已存 `sys_metadata` 数据、运行时校验行为全部不受影响;`cloud/tenant.zod.ts` 与 `system/tenant.zod.ts`(`system/Tenant` 行级租户记录,自带内联枚举、不引用被删文件)一字未动。
- JSON Schema 产物中上述 6 个 def 停止发布(`json-schema.manifest.json` 同步删键,#2978 蓄意移除通道)。

## 基线 12 → 10

`dual-source-exports.baseline.json` 删掉 `TenantPlan — [./cloud (type)] ≠ [./system (type)]` 与 `TenantPlanSchema — [./cloud (const)] ≠ [./system (const)]` 两行,其余行一字未动。
