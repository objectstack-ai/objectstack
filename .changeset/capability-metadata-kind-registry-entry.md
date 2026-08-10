---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

fix(spec,metadata-protocol): `capability` 补齐三处注册 —— 授权面不再接受任意 JSON (#5961)

`capability` 是「enforced but undeclared」——#5271 给 `api` 关掉的那个
`declared ≠ enforced` 的镜像。平台早就把它当成一个 metadata kind 在用:
`PLURAL_TO_SINGULAR` 从 #5870 起就有 `capabilities` → `capability`,
`AppPlugin` 用这个名字注册 stack 声明的 capability,
`bootstrapDeclaredCapabilities` 再读回来 seed `sys_capability`。但三处注册表
里都没有它:`MetadataTypeSchema`(kind 枚举)、`BUILTIN_METADATA_TYPE_SCHEMAS`
(schema 解析)、`DEFAULT_METADATA_TYPE_REGISTRY`(谁可以写、怎么加载)。

后果有两条,第二条才是这个 issue 属于授权缺陷而非整洁度问题的原因:

- `getMetadataTypeSchema('capability')` 返回 `undefined`,于是 `saveMetaItem`
  走了它自己文档化的「未注册类型 → 不校验直接存」分支,
  `PUT /api/v1/meta/capability/:name` 接受**任意 JSON** 落进 `sys_metadata`。
  capability 是靠**名字字符串**被解析的——授予侧 `systemPermissions`、
  要求侧 `requiredPermissions` 都是——所以一行任意 JSON 直接落在活的授权命名
  空间里。
- `isRuntimeCreateAllowed` 镜像 `getMetaTypes()` 的合成规则:没有静态注册表条目
  的类型被当作可运行时创建。所以缺的那一行不只是「没关上门」,它**把门打开了**。
  `/meta/types` 同步发布了这个虚构:`allowRuntimeCreate: true` + 无 schema,
  metadata-admin 引擎据此渲染成一个 raw-JSON 文本框。

### 改了什么

- **`BUILTIN_METADATA_TYPE_SCHEMAS['capability'] = CapabilityDeclarationSchema`**。
  既有的 422 `invalid_metadata` 路径就此覆盖 `capability`,`/meta/types` 发出真
  JSON Schema。
- **`DEFAULT_METADATA_TYPE_REGISTRY` 新增 `capability` 条目,
  `allowRuntimeCreate: false` + `allowOrgOverride: false`**。ADR-0066 D1:包
  DEFINE capability,权限集 GRANT,资源 REQUIRE。管理员在运行时凭空造一个
  capability 在这个三分里没有位置——代码里不会有任何地方 require 那个名字,这行
  只是授权命名空间里一个无人引用的授予目标。这一对标志就是 #5086 的 CODE-ONLY
  声明,`saveMetaItem` 在**任何** kernel 上都以 403 `not_creatable` 拒绝,并从条
  目自己的 `filePatterns[0]` 读回「该去哪儿声明」。`supportsOverlay: false`——
  capability 只是名字/标签/scope,没有 merge 语义,而允许租户 overlay 一个包发布
  的声明等于允许把 `scope` 从 `org` 抬成 `platform`。`loadOrder: 12` 早于
  `permission`/`position`(15),使权限集的 `systemPermissions` 解析时 capability
  已经存在。
- **`MetadataTypeSchema` 枚举补 `'capability'`**。
- **`CapabilityDeclarationSchema` 声明 ADR-0010 保护信封并收紧为 `.strict()`**。
  信封是必须的:loader 对每个已注册类型都调 `applyProtection`,不声明就会 422 掉
  loader 自己的输出(#4001 在 `permission`/`position` 上补过同一个洞)。收紧则与
  `api` 不同——`ApiEndpointSchema` 同时是**存储行**的解析器,所以它留在
  `STILL_STRIP`;而没有任何地方拿这个 schema 重新解析 `sys_capability` 行
  (`bootstrapDeclaredCapabilities` 通过 `capabilityRowFields` 按名读字段),
  所以收紧零成本,买到的是一个授权面本就该有的 declared = enforced 姿态。
  改用 `strictObject` 书写,已知键从 shape 派生,不新增手抄键表。

**包声明通道完全没动。** `AppPlugin` 通过 `registerInMemory` 注册 stack 的
`capabilities[]`,文件系统 loader 按 `filePatterns` glob——两条都不经过
`saveMetaItem`,所以 `bootstrapDeclaredCapabilities` 依旧照常 seed。
`OS_METADATA_WRITABLE=capability` 仍是 ADR-0005 那唯一一道运维逃生门,而在它后面
写入现在由 `CapabilityDeclarationSchema` 判定(422),不再原样落盘。

⛔ `role` / `profile` / `policy` **不搭车**:它们没有 `PLURAL_TO_SINGULAR` 映射、
没有声明 schema、没有读回接缝,是另一个问题,另开单。这条以断言形式钉在
`capability-metadata-kind.test.ts` 里,因为「capability 有了条目,邻居也该有」
正是下一个显而易见却错误的改动。
