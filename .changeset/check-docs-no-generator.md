---
"@objectstack/spec": patch
---

`check:docs` 不再以 `gen:schema` 开头 —— 一条名字叫 check 的脚本不该改工作区

`check:docs` 原本是 `pnpm gen:schema && tsx scripts/build-docs.ts --check`。前半截是**生成器**:
`json-schema.manifest.json` 与 `authorable-surface.json` 陈旧时它会把这两个 **tracked** 文件写掉。
于是跑一次「检查」就改了跑它的人的工作区,而且陈旧本身**从未被报告**。这正是 #4711 从 `--check`
里摘掉的缺陷,只是换了个入口(#4723)。

在 `check:generated` 里最难解释:`check:authorable-surface` 排在 `check:docs` 前面,且前者失败**不会**
中止后者。所以 manifest 陈旧时跑一次聚合门禁的结果是 —— 一份红色报告,配一个已经被悄悄修好的文件。

修法与 #4711 同形:**检查只检查,生成交给调用方。**

- `check:docs` = `tsx scripts/build-docs.ts --check`,不再生成任何东西。
- 调用方本来就在生成:CI 的 `check:authorable-surface` 步骤、`check:generated` 的门禁顺序、
  `pnpm build`、`apps/docs` 的 build。它们跑的是 `build-schemas.ts --check`,该模式写 gitignored 的
  `json-schema/`、拒绝碰任何 tracked 文件(#4711),正是这里唯一合格的「显式先跑一步」。
- 顺带省掉一次重复生成:`check:generated` 与 lint.yml 的 typecheck job 原本各跑两遍 ~1600 个 schema。
  实测 `check:docs` 从 8.97s 降到 2.05s。

原来的第一步还**顺手保证了新鲜度**,所以这一半必须补上,否则只是把「改工作区」换成更糟的
「假绿」——对着编辑前生成的树报告「文档已同步」。因此:

- `build-docs.ts` 在**所有模式**下先断言 `packages/spec/json-schema/` 存在且不旧于 `src/`,否则红着退出
  并给出 `gen:schema` 命令。写模式尤其要拒绝:陈旧树上的 `gen:docs` 不会失败,它会**写出**陈旧页面,
  即 `readsDist` 那个坑挪一个产物(AGENTS.md 记着它的代价)。
- 新鲜度规则 `schemaTreeIsStale()` 与 `distIsStale()` 同住 `scripts/check-regen-pending.mjs`:同一个问题、
  三个消费方(生成器、pre-commit 钩子、merge driver 的提示),两份拷贝会朝「拿没人重建过的树渲染出
  一个自信页面」的方向漂移(#4675)。与 `distIsStale` 唯一的有意差别是排除 `.test.ts` —— 测试文件不是
  `build-schemas.ts` 的输入,算进去会让每个纯测试 PR 都被要求跑一次没有意义的 `gen:schema`。
- `check:generated` 的 GATED 表把这条依赖**声明**出来(`readsSchemaTree`),reconciliation 在生产者缺失或
  排在消费者后面时失败 —— 数组字面量的顺序是一条真实依赖,不该靠巧合表达。

对使用者的影响:**`check:docs` 不再自足**。先跑 `pnpm --filter @objectstack/spec build`
(AGENTS.md 里本来就因 `dist` 那条要求先跑),或让 `check:generated` 按顺序跑。忘了也不会得到错的结论 ——
`build-docs.ts` 会指名道姓地拒绝。
