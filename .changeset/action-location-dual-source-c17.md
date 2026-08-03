---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/studio` 改名 `ActionLocationSchema` → `ActionContributionLocationSchema`;裸名 `ActionLocation(Schema)` 现在全包唯一地指 `@objectstack/spec/ui` 的应用 UI 位置词表 (#4737, #4535 C17)

`ActionLocationSchema` 曾由 `./studio` 与 `./ui` 各自导出一个声明 —— 同名、词表完全互斥的**两个概念**(#4411 陷阱):

| 入口 | 词表 | 语义 | 处置 |
|:--|:--|:--|:--|
| `./studio`(**改名**) | `toolbar` / `contextMenu` / `commandPalette`(3 值) | Studio IDE 外壳里插件 action contribution 出现的位置(唯一嵌入方 `ActionContributionSchema.location`) | → `ActionContributionLocationSchema`,枚举值逐字不变;新增 `ActionContributionLocation` 类型导出(旧 const 从无 type 导出) |
| `./ui`(**一字不动**) | `list_toolbar` / `list_item` / `record_header` / `record_more` / `record_related` / `record_section` / `global_nav`(7 值) | 运行中应用的 UI 上 action 渲染的位置,docblock 自宣全平台唯一真源 | 裸名唯一归属(objectui 按引用钉住 `ACTION_LOCATIONS` 并 re-export 类型族) |

## FROM → TO

```ts
// FROM —— 编译期起以 TS2305 失败(实测 objectstack / cloud / objectui 三仓零外部 importer,预期无人受影响)
import { ActionLocationSchema } from '@objectstack/spec/studio';

// TO —— 同一声明、同一词表,名字点明它唯一的语义
import {
  ActionContributionLocationSchema,
  type ActionContributionLocation,
} from '@objectstack/spec/studio';
```

**要的是应用 UI 的 action 位置?** `import { ActionLocationSchema, type ActionLocation } from '@objectstack/spec/ui'` —— 本次未动。

不保留旧名别名:在 `./studio` 上 re-export 任何一侧的 `ActionLocationSchema` 都会重开本次关闭的陷阱(要么复活双源,要么把应用 UI 词表谎报成 Studio 清单词表)。

## 零元数据迁移

本次只动 TS 导出名与内部 JSON Schema def 名(`studio/ActionLocation` → `studio/ActionContributionLocation`,走 `RENAMED_DEFS` 承接表,0-key carry —— 枚举 def 无 authorable properties)。作者在 Studio 插件清单里写的 `contributes.actions[].location` 取值域(`toolbar` / `contextMenu` / `commandPalette`)逐字节不变,已有清单原样解析。无 tombstone(没有 key 退役)、无 ADR-0087 conversion —— `StudioPluginManifestSchema` 是根 schema,不在 stack 树上,conversion walker 到不了它(`converge-activation-event-schema` 先例论证)。发布的 JSON Schema `$id` 随之移动:`…/studio/ActionLocation.json` → `…/studio/ActionContributionLocation.json`。
