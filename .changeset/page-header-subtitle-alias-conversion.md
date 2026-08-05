---
"@objectstack/spec": minor
---

feat(spec): `page-header` 节点的 `description` 在加载期改写为 canonical 的 `subtitle` —— ADR-0087 D2 条目 `page-header-subtitle-alias`(#4827,objectui#3226)

「页面副标题」这一个概念长期有两套 authorable 拼写,一套渲染器一套:`@objectstack/spec`
的 `PageHeaderProps` 只声明 `subtitle`,而 objectui 的 kebab 遗留别名 `page-header`
在注册 `inputs` 里宣告 `description`,渲染器用一个裸 `subtitle ?? description` 兜住 ——
正是 Prime Directive #12 描述的「producer 写方言、consumer 用 `??` 兜」。

现在按 ADR-0087 D2 收口:protocol 17 的 **live window** 条目
`page-header-subtitle-alias`,在加载期(`defineStack` / `validate` / `lint`,以及
`applyConversionsToStoredItem` 覆盖的 `sys_metadata` 存量行)把 page-header 节点
`properties` 上的 `description` 改写为 `subtitle`,每次改写发出一条结构化
`ConversionNotice`。消费端因此只需读 `subtitle`;objectui#3226 随后删掉那个 `??`。

FROM → TO:

- `pages[].regions[].components[]`,`type` 为 `page-header`(kebab 遗留别名)或
  `page:header`(协议 canonical 键):`properties.description` →
  `properties.subtitle`

两点语义按既有惯例、并有测试钉住:

- **canonical 优先**:`subtitle` 已在场时不改写、不发通知,被遮蔽的 `description`
  原样留在那里(与 `flow-node-crud-object-alias` 一致)。
- **只动 header 节点**:`description` 在同一层的其他组件上是活的已声明属性
  (`element:text_input` 的辅助文本),不受影响。

本条目**不**改写节点 `type`:kebab 别名的存废是 objectui 侧的事,按其自身节奏推进。
`description` 从未在 `PageHeaderProps` 上声明过,因此没有 schema 键被移除,也无需
tombstone;老拼写在 protocol 17 全程被接受,18 退出加载路径并转入 D3 迁移链。
