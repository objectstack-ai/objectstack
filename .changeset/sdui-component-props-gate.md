---
"@objectstack/lint": minor
"@objectstack/spec": minor
---

feat(lint,spec): SDUI 组件 props 接上解析闸门 —— `ComponentPropsMap` 不再是「声明了、从不被 parse」(#5068)

`PageComponent.properties` 是 `z.record(z.string(), z.unknown())` 这个开放口袋。
`PageComponentSchema` 自 ADR-0089 D3a 起是 `.strict()`,但**严格性不递归**:它守住
component 节点自己的键,`properties` 里面一个字都没人看。于是 `ComponentPropsMap`
里 31 个 typed props schema 从来没有被任何东西 parse 过(#4001 批 17 的 `no gate`
判定:载体活着、parse 缺席)。后果不是无害的 —— objectui 的 `SchemaRenderer` 会把
`properties` 整个 hoist 到节点上,再把 deny-list 之外的每个键 spread 成 React prop,
所以一个拼错的键既不被拒绝也不被丢弃:它一路走到渲染器,在那里被忽略,而作者拿到
的是一张成功回执。这正是 ADR-0078 要消灭的形状。

**新规则(两个诊断 id,均为 warning 级)**,落在 `@objectstack/lint`,按维护者对
#5068 的裁定走方向 A —— 在载体自己的授权门上分派解析,而不是改 `page` 协议的形状:

- **`component-props-unknown-key`** —— props schema 未声明的键,包括 props 包自身
  这一层和它底下每一个 strip 姿态的对象。走的是 `lintUnknownKeysAgainstSchema`
  (本次从 `@objectstack/spec` 导出,即 `lintUnknownAuthoringKeys` 用在每个 metadata
  集合上的同一个 walker),所以 strip/strict/passthrough 的姿态规则与改名建议都是
  单一实现,这里不重新推导一遍。
- **`component-props-invalid`** —— props schema 拒绝的值:类型不对、必填缺失、枚举
  越界。

配套的一条契约细节:走到第二层。`readonly`(#5176)挂在 `RecordHighlightsField`
联合体的对象成员上,即 `fields[]` 数组项里面 —— authorable-surface walk 严格一层、
到不了那里(#5607 的更正)。本闸门到得了,并且两个方向都钉了测试:声明过的
`readonly` 必须静默,拼错的 `readOnly` 必须报出来并指名正确拼法。

**未注册 type 一律跳过**,这是必须语义而不是宽松:`PageComponentSchema.type` 是
`z.union([PageComponentType, z.string()])`,光是仓内 example 语料就授权了 10 种本
map 不承载的类型、共 87 个节点(`flex`、`grid`、`object-metric`、`object-chart`、
`record:line_items` …),它们的契约在 objectui 注册表和 ADR-0080 manifest 里。拿一个
不存在的 schema 去审判它们,只会把每一个都报成坏的。

**为什么本步只落 warning。**接上 parse 是执法的前置条件,不是执法本身(#5020 在隔壁
表面上的同一课)。闸门落在真实语料上会报 52 条:其中 34 条是三个已发布平台页把
`{ en, 'zh-CN' }` 内联多语言 map 写进了声明为纯 `z.string()` 的 `I18nLabelSchema`
(#5728,裁定中),另有 8 条是 `element:text.content` 上同一形状。今天就 gate 掉它们,
等于用平台自己都不遵守的声明去否掉平台自己的页面。warning 期的违例清单就是 error
升级的验收基线,升级本身是独立一步。

作者侧不变:`properties` 仍然照原样解析、原样保留,没有任何东西开始被拒绝 ——
`os validate` / `os build` / `os lint` 多了一类建议性诊断而已。存储路径(`saveMetaItem`
/ REST `/meta`)仍然不校验 props 包,这一点被如实记录、未在本次修复。
