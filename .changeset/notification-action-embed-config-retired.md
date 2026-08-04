---
'@objectstack/spec': major
---

退役 `NotificationActionSchema` / `EmbedConfigSchema`——两个从来没有授权门的 `./ui` 词汇表形状（ADR-0049 enforce-or-remove，#5015）

## FROM → TO

| 移除 | 改为 |
|---|---|
| `NotificationActionSchema` / `NotificationAction`（`@objectstack/spec/ui`） | **无替代形状**。删掉 import 和值。通知的呈现词汇仍在：`NotificationTypeSchema` / `NotificationSeveritySchema` / `NotificationPositionSchema` 三个枚举原样保留 |
| `EmbedConfigSchema` / `EmbedConfig`（`@objectstack/spec/ui`） | **无替代形状**。删掉 import 和值。表单的公开访问由**活门** `FormView.sharing`（`SharingConfigSchema`）授予，该门未受本次变更影响 |

一行修复:删除 import 与值本身 —— 没有任何一份元数据源码需要改写,因为这两个形状**从来就没有键可以写进去**。升级后再 import 是 TS2305。

## 为什么是移除而不是收紧

这一档比「声明了但没人读」还要低一级:**连键都没有**。#4001 批 14 在 2026-08-03 对这两个形状做了三条独立测量,本次退役在 `origin/main` 上把三条全部重跑,每条都带同一次运行内通过的阳性对照:

1. **承载键** —— `packages/spec/src` 里没有任何 schema 声明这两个类型的键。`ui/notification.zod` 的非测试 importer 只有 barrel;`ui/sharing.zod` 的是 barrel 加 `ui/view.zod.ts`,而后者点名的是它的**兄弟** `SharingConfigSchema`。匹配按 specifier **解析**而非子串比对 —— 仓里有两个 `sharing.zod`,子串法会把 `stack.zod.ts` 误记为 UI 那个的 importer。
2. **图可达性** —— 从 24 个 metadata-type root 加 `defineStack` 的 `ObjectStackSchema` 做 BFS（`build-schemas.ts` 自己的走法,含 derived-clone 桥接）两个都走不到,而 `Page` / `Action` / `DashboardWidget` / `Webhook` 以及 `SharingConfig` 本身在同一次运行里全部 `root-graph`;注入一个合成承载键后两个都翻成 `root-graph`。
3. **调用点** —— objectstack / cloud / objectui 三个仓里,除各自单测外零 `.parse()`。

所以没人写得进去,也从来没有东西校验过它们:这正是 #3950 记录的形状 —— 一个没有消费者的导出 schema 会被当成能力来读,而 ADR-0033 的 AI 作者会把 `EmbedConfigSchema` 出现在发布包里当作「平台支持 iframe 嵌入」的证据。

批 14 **故意没有**用 `.strict()` 收紧它们:strict 是一次 **parse** 的属性,对没人 parse 的形状收紧什么也不强制,只会留下*「一个被精确校验的死槽位 —— 更有说服力的谎言」*（#4583）。批 14 把判定挂成 #5015,本次是该判定的执行,裁决 REMOVE（2026-08-04）。

两个形状各自都是**上一层退役留下的孤儿**,这也是它们成为孤儿的原因:

- `NotificationAction` 在 #4610 失去了两个 wrapper（`NotificationSchema` / `NotificationConfigSchema`,因零消费者被删）;
- `EmbedConfig` 在 17.0.0 失去了它的键 —— 2026-06 liveness audit 退役了 `App.embed`（从来没有 iframe 路由读过它),该键至今作为 `retiredKey()` 墓碑立在 `app.zod.ts`。也就是说**写了那个键的作者早就会撞到处方**,本次删掉的是比键活得更久的值形状。

## ⚠️ 范围:按 SCHEMA 退役,不是按文件

两个模块都**存活**,并且都保留活导出:

- `ui/sharing.zod` 保留 `SharingConfigSchema` —— 这是一个**活门**:`FormViewSchema.sharing` 承载它,`rest-server.ts` 真的读 `sharing.allowAnonymous` / `sharing.publicLink` 来挂匿名表单路由,两个示例应用都在写。**公开表单分享不受影响**;
- `ui/notification.zod` 保留三个呈现枚举。

`packages/spec/src/ui/notification-embed-retirement.test.ts` 把两侧都钉住:缺席按 resolved symbol identity across 每个 public entry 断言,**存活侧同样是承重的** —— 一次连文件一起删掉的「退役」能满足全部缺席断言,却会摧毁正在工作的面。

## 运行时行为

字节级不变:从来没有一个 notification action 被从元数据里解析出来,也从来没有 iframe 路由读过 embed config。

## 生成物基线的删除是有意的

`json-schema.manifest.json` 少 2 个 key,`authorable-surface.json` 少 10 行,`api-surface.json` 少 4 个导出。这是**整 def 删除**路线的预期读数（而非枚举值收窄那种四张 ratchet 全无变化的形态):`#2978` manifest ratchet 先开火要求有意删除 manifest key,删完重跑后 per-key ratchet 自行判定为 #4650 路径 3（`def no longer emitted by this build`）。

## objectui 侧

objectui 的 `animation-notification-spec-parity.test.tsx` 把 `NotificationActionSchema.shape.variant` 当**词汇表**读（不是 parse),用来双向 pin 它自己手写的 `NotificationActionButton` 接口。这恰好说明「有消费者」不等于「有授权门」。该 pin 会在 objectui 刷新本依赖时失去 spec 侧锚点,适配在 objectui 侧单独跟进 —— 本次变更不碰 objectui。
