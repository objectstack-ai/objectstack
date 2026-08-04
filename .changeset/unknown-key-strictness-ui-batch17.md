---
'@objectstack/spec': major
---

**`ui/component.zod.ts` 的 29 个站点判定为 `no gate`,不收紧(#4001 批 17,ADR-0078)**

⚠️ **本条没有破坏性变更,没有迁移,没有任何键的行为改变。** 它记录的是一次测量结果:SDUI 组件 props 这块 `ui/` 目录最大的待收紧面,**根本没有 parse**,所以 `.strict()` 在这里不会强制任何东西。

## 为什么不收紧

`.strict()` 是 **parse 的属性**。三条独立测量(2026-08-04,控制组同轮为真):

1. **承载键活着,但它是个开放口袋。** `PageComponentSchema.properties` 是 `z.record(z.string(), z.unknown())`。`PageComponentSchema` 自 ADR-0089 D3a 起确实是 `.strict()`,但**严格性不递归**——它守住 component 节点自己的键,`properties` 里面完全不校验,也没有任何地方按 `type` 分派 `ComponentPropsMap`。
2. **BFS 不可达。** 从 24 个 metadata-type root 加 `ObjectStackSchema` 出发(复用 `build-schemas.ts` 自己的 `zodChildSchemas`/`zodShapeOf`,即 #4650 闭包,6899 个节点),本文件 **52 个目标全部 UNREACHABLE**(21 个导出 schema + `ComponentPropsMap` 全部 31 个条目);同一轮里 `PageSchema` / `PageComponentSchema` / `PageRegionSchema` / `ThemeSchema` / `ChartConfigSchema` / `ResponsiveConfigSchema` 六个正控制组全部 `root-graph`,批 13 的 no-door 形状保持 unreachable。BFS 正好停在 `properties`。
3. **三个仓库无生产 parse 点。** `objectstack` / `objectui` / `cloud` 中,对本文件任何 schema 的 `.parse()`/`.safeParse()` 全部落在本文件自己的单测里。objectui 手写平行的 React interface、只引用推断类型;cloud 引用为 0;`react-blocks.ts` 只用 `Object.keys(ComponentPropsMap)` 取类型名。

经验证据(`definePage()` 就是 `PageSchema.parse()`,活的授权门):example 语料 10/10 个页面上,写进 `components[].properties` 的未声明键**原样通过并被保留**;同一个键放到外面一层(`properties` 的兄弟位)10/10 被拒——这个负控制组才让前一个数字有意义。

## `no gate`,不是 `no door` —— 不要退役

这些词汇是**活的**,不能按 ADR-0049 退役:objectui 的 `SchemaRenderer` 把 `properties` 整个 hoist 到节点上,再把不在固定 deny-list 上的**每一个**作者键 spread 成 React prop。所以拼错的键既不被拒、也不被丢,而是安静地流到渲染器再被忽略——正是 ADR-0078 要消灭的形状,只是位置比本 ratchet 能触及的层更低一层。

这确实是 #4909 的 open-slot 形状,但在一个没人 parse 的 schema 上,`.passthrough()` 和 `.strict()` 一样空洞,所以**没有改任何 posture**。

contract-first 的修法是把 parse 接到承载键自己的闸门上,已单独立为 **#5068**;那个 issue 同时记录了两条使它不能顺手做的约束:`type` 是开放 union(`record:line_items` 这类未注册类型在现实中被使用),以及真实页面已经写了这些 schema 未声明的形状(`record:details` 的 `sections[].fields[]`/`hideFields[]`、record picker 的 `labelField`)。#5068 落地后本文件才重新变成 `authorable`,收紧才有意义。

判定写在三处(文件头、`component.test.ts` 的钉子——含一条 `properties` 一旦获得类型化分派就变红的断言、账本 `ui/` 两张表),改要一起改。

账本连带效果(与 #5042 批 14、#5069 批 16、#5070 批 18 合并后,从存活行重算):`ui/` 的 authorable strip 从 35 降到 **6 of 75**——重分类只是换类不是出列,总数不变,文件保留 29/29 行,`check:strictness-ledger` 的反向钉子仍然管着它;`no gate` 从 2 涨到 **31**。批 18 关掉 15 个真门、批 17 测出 29 个没有门,两件事叠加后 `ui/` 只剩 **6 个** authorable strip 站点。由此得到这个目录现在最大的一个事实:**`ui/` 剩余 75 个 strip 站点里有 69 个(92%)根本不是本 ratchet 的工作**(38 个 `no door` + 31 个 `no gate`)。排后续 `ui/` 收紧批次前请先读这个数——这个目录的 ratchet 已经接近完成,剩下的绝大多数是别的 issue 的工作。
