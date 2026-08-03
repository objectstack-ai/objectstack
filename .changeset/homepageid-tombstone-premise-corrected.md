---
'@objectstack/spec': patch
---

docs(spec): `app.homePageId` 的墓碑说清真正的退役理由 —— 「no shell ever read it」是假的 (#4709)

**改的是「为什么删」的表述,不是删本身。** `app.homePageId` 在 17.0.0 依旧退役
(`retiredKey`:编译期 `never`、解析期报错),conversion `app-dead-authoring-keys-removed`
的行为、baseline、`os migrate meta --from 16` 的处方一字未动。

#4667 给出的理由是「no shell ever read it」。这句是**假的**,而且与本仓自己的记录直接
矛盾 —— 2026-06 的 AppSchema liveness 审计
(`docs/audits/2026-06-appschema-property-liveness.md`)把 `homePageId` 明确列在 LIVE
一侧,因为 objectui console 的 `resolveLandingRoute()`
(`packages/app-shell/src/console/AppContent.tsx`,objectui @785b8a5d)一直在读它,而且
它是**唯一**决定「app 打开时落在哪」的地方。两份文档矛盾了两个月无人发现,直到有人做
cloud pin 对账时先信了这句、再去核渲染器才发现不对(#4709)。

真正让这个键该走的是它的**形状**,不是无人使用:它把落地页编码成指向 `navigation` 的
ID 交叉引用,没有引用完整性 —— id 悬空时**静默**回退到第一项(objectui 的实现正是如此),
于是同一件事有两个来源,而错的那个不出声。将来若要「落地页 ≠ 第一项」,正确形状是导航项
自身的标记(`navigation[].landing`:单一来源、不可能悬空),并按 enforce-first 设计
(先有渲染器与测试,再进 schema)。

墓碑文案改为诚实版本后,作者看到的处方**保持不变**:删掉这个键;要改 app 从哪里打开就
重排 `navigation` 让目标项排第一;根落地由 `isDefault` 决定。同步纠正:conversion 摘要
(经 `gen:upgrade-guide` / `gen:spec-changes` 重生成到 `docs/protocol-upgrade-guide.md`
与 `spec-changes.json`)、生成文档 `content/docs/references/ui/app.mdx`、
`content/docs/ui/apps.mdx`、liveness ledger 的 `homePageId` note、`examples/app-showcase`
里那句「has no console consumer yet」,并给 6 月审计补了一条指向 #4667/#4709 的后续注记
(审计结论本身是对的,原文不动)。新增一条 pin 测试,防止「无人读过」这类假前提回潮。

objectui 侧那段永远进不去的 `if (homePageId)` 死分支单独清理:
`objectstack-ai/objectui#3264`。
