---
---

docs(ui): `ui/apps` 停止教 17.0.0 已退役的 `App.version` 与 `App.mobileNavigation`,两个 `os:check` 示例改用 `defineApp()` 以便退役键在 tsc 就红 (#5313)

`content/docs/ui/apps.mdx` 有四处仍把 17.0.0(2026-06 liveness audit / ADR-0049
enforce-or-remove)已退役的键当作可作者化面在教:「Basic Structure」示例里的
`version: '1.0.0'`、App Properties 表里的 `version` 行、整节 `## Mobile Navigation`
(含 `mobileNavigation: { mode, bottomNavItems }` 示例与 `mode` 取值说明),以及
「Complete Example」里的 `version: '2.0.0'`。

墓碑是 `retiredKey()`(`z.never().optional()`),所以照抄这两个示例不是「多写一个没用
的键」,而是**整条 save 硬失败**。实测把「Basic Structure」块原样喂给
`getMetadataTypeSchema('app')`:

    version :: `App.version` was removed in @objectstack/spec 17.0.0 (2026-06 liveness
    audit — no consumer in framework or objectui). An app is versioned by its owning
    package: use `manifest.version`. Delete the key.

处置按墓碑自己的处方:`version` 删键(应用的版本是其所属包的 `manifest.version`);
`mobileNavigation` 没有替代能力——它是完全未实现的键,连 `packages/mobile` 都没读过,
`mode` 选择器不改变任何东西——故整节删除,并在 App Properties 表后新增 Callout 点名这
两个键、给出各自处方,顺带指回已在正文交代过的 `homePageId`(#4667 / #4709)。

同时给该页两个 `{/* os:check */}` 块加上 `defineApp()` 标注。此前两块都是无类型标注的
对象字面量(`const crmApp = { … }`),没有任何东西把它们和 `AppSchema` 关联起来,
`retiredKey()` 赖以在编译期开火的 `never` 入参类型永远不参与推断——`check:skill-examples`
只做 tsc,于是对退役键这一类恒绿。加标注后同一个门在旧示例上会红:

    ✗ Prose TypeScript examples do not compile against @objectstack/spec:
      content/docs/ui/apps.mdx:19:3  error TS2322: Type 'string' is not assignable to type 'undefined'.
      content/docs/ui/apps.mdx:239:3 error TS2322: Type 'string' is not assignable to type 'undefined'.

改后 `✅ 204 prose examples type-check against @objectstack/spec`,两个块喂 schema 也都
`parses: true`。这条标注是本次修复的护栏:此后该页示例里任何退役键都在门里当场红,而不是
等作者照抄后在 save 时才发现。

门本体(`packages/spec/scripts/check-skill-examples.ts`)不动——issue 里的 B 方案(对能
推断出 schema 的块追加一次 `safeParse`)覆盖更广,但需要先解决「哪个块对应哪个 schema」
的归属推断,是独立的一次设计。不碰 `packages/spec/**`、`content/docs/references/**`
与 `content/docs/releases/`。Docs-only。
