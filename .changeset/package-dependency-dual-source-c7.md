---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/kernel` 改名 `PackageDependencySchema` → `ResolvedPackageDependencySchema`;裸名 `PackageDependency(Schema)` 现在全包唯一地指 `@objectstack/spec/cloud` 的清单声明形 (#4741, #4535 C7)

`PackageDependency` / `PackageDependencySchema` 曾由 `./cloud` 与 `./kernel` 各自导出一个声明 —— 同名、键集**完全不相交(0 个共享属性)**的**两个概念**(#4411 陷阱):

| 入口 | 键集 | 语义 | 处置 |
|:--|:--|:--|:--|
| `./cloud`(**保名**) | `packageId` / `versionRange` / `optional` | **声明形**:作者写进包清单的依赖行,嵌在 `PackageManifestSchema.dependencies[]` → `sys_package_version.manifest_json` | 裸名唯一归属 |
| `./kernel`(**改名**) | `name` / `versionConstraint` / `type` / `resolvedVersion` | **解析形**:依赖解析器在图上走的边,嵌在 `DependencyGraphNodeSchema.dependencies[]`,并经 `PluginSecurityProtocol` 发布给 SBOM / 冲突报告 | → `ResolvedPackageDependencySchema`,字段与校验逐字不变 |

两边都不是 `.strict()`,所以把一侧的文档粘到另一侧时**不会响亮报错,只会静默剥掉全部外来键**(ADR-0104 silent-strip 类)—— 这正是共用一个名字所掩盖的失败模式,也是本次不留任何别名的原因。

## FROM → TO

```ts
// FROM —— 编译期起以 TS2305 失败
import { PackageDependencySchema, type PackageDependency } from '@objectstack/spec/kernel';

// TO —— 同一声明、同一形状,名字点明它是「解析结果」而非「清单声明」
import {
  ResolvedPackageDependencySchema,
  type ResolvedPackageDependency,
} from '@objectstack/spec/kernel';
```

运行时命名空间对象同步改键:`PluginSecurityProtocol.PackageDependency` → `PluginSecurityProtocol.ResolvedPackageDependency`(指向同一 schema)。

**要的是清单里写的依赖声明?** `import { PackageDependencySchema, type PackageDependency } from '@objectstack/spec/cloud'` —— 本次未动其形状,仅补了一段互指 docblock。

**受影响面实测**:`objectstack` / `cloud` / `objectui` 三仓 import 级扫描,`./kernel` 侧零外部 importer(唯一读者是同文件的 `DependencyGraphNodeSchema` 与 `PluginSecurityProtocol`),预期无人受影响。零 importer 不等于有死侧可删(#4653 判则),故走改名而非删除。

不保留旧名别名:在 `./kernel` 上 re-export 任何一侧的 `PackageDependencySchema` 都会重开本次关闭的陷阱 —— 要么复活双源,要么把清单声明形谎报成解析器合法输入(承接表不变式 3 会在 build 阶段直接拒绝这条路线)。

## 零元数据迁移、零形状变更

本次只动 TS 导出名与内部 JSON Schema def 名(`kernel/PackageDependency` → `kernel/ResolvedPackageDependency`,走 `RENAMED_DEFS` 承接表,**4 keys carry**:`name` / `versionConstraint` / `type` / `resolvedVersion` 在新 def 名下逐个健在)。

- **无字段增删、无类型变更、无词表变化** —— 两个 schema 的 body 一字未改(对照 C10 的 checksum 对象→字符串、C16 的 3→5 词表拓宽:本簇均不适用)。`type` 的 `.default('required')`、cloud 侧 `optional` 的 `.default(false)` 都原样保留,并由新增的 pin 用 `parse` 实测钉住(#4666 默认值盲区的自卫)。
- **无 tombstone**:tombstone 的前提是有 key 退役;本次 4 个 key 全数承接,一个都没离开契约,伪造 tombstone 会污染 ADR-0087 登记(`renamed-defs.ts` 头注明列的第 2 种错误处置)。已按 #4767 的 `retiredKey()` 先例逐条评估后排除,非沉默跳过。
- **无 ADR-0087 conversion**:没有作者路径发生位移,注册迁移等于让消费者跑一次不该跑的转换。
- 发布的 JSON Schema `$id` 随之移动:`…/kernel/PackageDependency.json` → `…/kernel/ResolvedPackageDependency.json`。

⚠️ 同前缀近邻 `PackageDependencyConflict(Schema)` 与 `PackageDependencyResolutionResult(Schema)` 是**不同概念**,一字未动,并由 pin 显式断言健在。
