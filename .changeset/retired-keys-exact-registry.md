---
"@objectstack/spec": patch
---

fix(spec): 退休登记按**确切 key** 判定 —— 无关簇的同名叶子不再让 tombstone 冒充「已登记」(#4659)

`scripts/build-schemas.ts` 的检查 (b)(`check:authorable-surface`)保证一件事:
一个 authorable key 从 live 翻成 retired(`retiredKey()` 墓碑)时,这次退休必须
被登记下来,否则 `spec-changes.json`(ADR-0087 D4)、生成的升级指南、`spec_changes`
MCP 工具全是空的,消费者只能靠失败才知道。

它此前是这样判定「已登记」的:取 key 的**叶名**,拿去和**全部 major** 的所有
conversion / migration `surface` 子句做 `endsWith('.' + name)` —— 完全不看 key
属于哪个 def。于是任何一条无关登记,只要 surface 以同名叶子结尾,就把这个墓碑判为
「已登记」:

- #4658 实测:`automation/Event:type` 被 tombstone、零 conversion,门禁全绿 ——
  命中的是 protocol 11 的 `flow-node-http-callout-rename`(`flow.node.type`),
  一个 flow 节点的 `type`,和状态机事件毫无关系。
- #5509(ADR-0087 D2 `page-header-subtitle-alias`)登记
  `page.component.page-header.description` 之后,任何叶名为 `description` 的 key
  也进了同一个免检名单。`type` / `name` / `config` / `filter` / `schema` /
  `description` 都是 authorable 形状上最常见的叶子,这条保证对它们整体失效。

现在登记有了自己的表:

- **新增导出 `RETIRED_KEYS_BY_MAJOR`**(`@objectstack/spec`,
  `src/migrations/registry.ts`),值就是确切的 `` `${defKey}:${name}` `` 字符串 ——
  `authorable-surface.json` 怎么写它就怎么写,去掉 `[RETIRED]` 标记。
- 检查 (b) 改为对这张表做**精确集合判定**:不再有 `endsWith`,不再取叶名,不再从
  相邻的 key 辐射过来。门禁失败时直接打印要粘贴的那一行和它该进哪个 major。
- 新增检查 (b2):表里登记了一个**当前仍然 live** 的 key —— 一次没有任何东西消费的
  登记 —— 直接失败;它会替一次尚未发生的退休提前放行。登记了一个本次构建**已不再
  产出**的 key 则不是错误:墓碑满 ~2 个 major 之后由检查 (c) 放行其基线行,登记条目
  留下,这是预期稳态。

conversion 的 `surface` 保持散文形态、一个字没动:它面向作者、按作者书写元数据的
形状表达(`flow.nodes[].outputSchema`),本来就无法可判定地映射回 def key。所以
搬走的是机器事实,不是散文。一次退休仍然两样都要写:登记条目是**声明的凭据**,
conversion 是**消费者照着做的处方**。

不回填历史:检查 (b) 只在相对已提交基线的 live → retired **新**跃迁上触发,而更早的
墓碑在基线里已经是 `[RETIRED]`,不会再触发它。所以这张表读作「在确切-key 门禁下登记的
退休」,不是「历史上的全部退休」—— 空表在 `main` 上实测全绿。
