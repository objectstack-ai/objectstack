---
"@objectstack/spec": major
---

feat(spec)!: 双源 C5 收敛 — `ActivationEventSchema` 归 `./kernel` 结构化形状,`./studio` re-export (#4653)

`ActivationEventSchema` 这个名字过去在两个入口解析到**两份不同的声明**,插件作者拿到哪套校验取决于他从哪个子路径 import(#4411 陷阱):

| 入口 | 声明 | 作者写的样子 |
|:--|:--|:--|
| `@objectstack/spec/kernel` | `z.object({ type: z.enum([...]), pattern: z.string() })` | `{ type: 'onCommand', pattern: 'my.cmd' }` |
| `@objectstack/spec/studio` | `z.string()` | `'onCommand:my.cmd'` |

两侧都在作者面上(kernel 侧嵌在 `DynamicLoadRequest.activationEvents`,studio 侧嵌在 `StudioPluginManifest.activationEvents`,后者正是 `defineStudioPlugin` 的入参),所以没有"死侧"可删。v17 统一到**结构化形状**:`./studio` 现在 re-export `./kernel` 的那一份声明,平台只剩一套激活词表。

**为什么是结构化的那一侧赢。** 字符串那一侧更眼熟(照搬 VS Code),但它什么都不校验:`z.string()` 接受 `''`、`'banana'`,以及真正要命的 `'onMetadatType:flow'` —— 这个文件文档里列的词表(`*`、`onMetadataType:`、`onCommand:`、`onView:`)只活在散文里,拼错永远静默通过。结构化形状用 enum 在**创作时**就把触发器类型钉死,这才是声明它的意义。

## FROM → TO

`activationEvents` 的每一项从字符串变成对象。冒号前的段成为 `type`,冒号后的段成为 `pattern`:

```ts
// FROM (v16 及以前,@objectstack/spec/studio)
defineStudioPlugin({
  id: 'objectstack.flow-designer',
  name: 'Flow Designer',
  activationEvents: ['onMetadataType:flow'],
});

// TO (v17+)
defineStudioPlugin({
  id: 'objectstack.flow-designer',
  name: 'Flow Designer',
  activationEvents: [{ type: 'onMetadataType', pattern: 'flow' }],
});
```

逐条对照:

| FROM | TO |
|:--|:--|
| `'*'` | `{ type: 'onStartup', pattern: '*' }` |
| `'onMetadataType:flow'` | `{ type: 'onMetadataType', pattern: 'flow' }` |
| `'onCommand:myPlugin.doSomething'` | `{ type: 'onCommand', pattern: 'myPlugin.doSomething' }` |
| `'onView:myPlugin.myPanel'` | `{ type: 'onView', pattern: 'myPlugin.myPanel' }` |

`StudioPluginManifest.activationEvents` 的默认值随之从 `['*']` 变为 `[{ type: 'onStartup', pattern: '*' }]`。`'*'` 没有拿到独立的 `type`:它一直就是"立即激活",而 kernel 侧的 `onStartup` 本来就是这个意思,再加一个枚举值只会造出两个同义词。

## 词表 = 两侧并集,没有能力被静默拿掉

enum 取**两侧 v17 前词表的并集**,共 9 个值:

| 值 | 来源 |
|:--|:--|
| `onCommand` | kernel enum + studio 文档 `onCommand:myPlugin.doSomething` |
| `onRoute` | kernel enum |
| `onObject` | kernel enum |
| `onEvent` | kernel enum |
| `onService` | kernel enum |
| `onSchedule` | kernel enum |
| `onStartup` | kernel enum;同时是 studio `'*'` 的落点 |
| `onMetadataType` | studio 文档/测试 `onMetadataType:object` —— kernel 原本没有 |
| `onView` | studio 文档/测试 `onView:myPlugin.myPanel` —— kernel 原本没有 |

**未采纳**:cloud-v1 未发布的 marketplace runtime 里的 `priority`、`onInstall`、`onWebhook`。四仓无人读它们,而新增一个 declared-but-unenforced 的键正是 ADR-0049 在清的债 —— 等真有执行点再单独提。

## 迁移是手工的,但失败是响亮的

**没有随附 ADR-0087 conversion,因为写不出能跑到的那一个。** conversion 层(`applyConversions`)接在 `normalizeStackInput` 上,只走 stack 树;而 `StudioPluginManifestSchema` 和 `DynamicLoadRequestSchema` 都是**根 schema**,没有任何父 schema 嵌入它们(前者由 `defineStudioPlugin` 直接 parse,后者是运行时请求载荷),都不在 stack 里。伪造一个永远不会命中的 conversion 只会制造"已自动迁移"的假象。

手工迁移步骤:按上表把每个字符串改写成 `{ type, pattern }`。**漏改会在 parse 处响亮失败** —— `StudioPluginManifestSchema` 是 `strictObject`,字符串遇到对象 schema 直接抛错,不存在静默吞掉或强制转换。

## 不要与同窗口的 #4509 / #4664 退休项混淆

v17 同窗口的 #4664 退休了五个键。其中 **`app.contextSelectors[].placement`** 与本条变更**毫无关系**,但很容易被读成有关系 —— 那条退休说明里写着「`location` 曾是 `placement` 的别名」,而 Studio 插件的面板贡献点**恰好也有一个 `location` 键**:

| | 被 #4664 退休的 | 本次变更**未动**的 |
|:--|:--|:--|
| 键 | `ui/App.contextSelectors[].placement`(`location` 是它的别名) | `studio/PanelContribution.location` |
| 语义 | app 的上下文选择器渲染在哪(`sidebar_header` / `topbar`) | Studio 插件的辅助面板停靠在哪(`bottom` / `right` / `modal`) |
| 状态 | 已删除 | **原样保留**,仍是可作者化键 |

两者在不同 schema 上、取值域不同、互不相关。写 Studio 插件的作者**不需要**因为 #4664 去动 `contributes.panels[].location`。

其余四个退休键(`mapping.extractQuery` / `mapping.errorPolicy` / `mapping.batchSize` / `app.contextSelectors[].includeAll`)与 `activationEvents` 无任何语义交叉;同窗口的 #4668(ADR-0119 D2 migration journal)亦然。

## 其它影响

- `@objectstack/spec/studio` 现在**额外导出** `ActivationEvent` 类型(此前只有 schema),与 `./kernel` 指向同一份声明。
- `ActivationEventSchema` 从 `dual-source-exports.baseline.json` 移除,基线 22 → 21。
- 零可作者化 key 消失、零 tombstone:kernel 的 `ActivationEvent:type` / `:pattern` 原样存活,`studio/ActivationEvent` 侧新增 2 个 key(字符串没有 key,对象有),属 `gen:schema` 允许的**新增**。
