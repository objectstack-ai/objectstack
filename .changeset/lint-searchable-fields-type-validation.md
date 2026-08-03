---
"@objectstack/lint": minor
---

feat(lint): 视图 `searchableFields` 按运行时同一套判定做构建期校验 —— 一个 lookup 笔误不再等到 400 才暴露 (#4830)

视图(list view)的 `searchableFields` 会被客户端逐字回显为 `$searchFields` 覆盖参数,而
REST 入口闸(#4254)会用 `resolveSearchFieldResolution`(`@objectstack/spec/data`)判定
该对象的可搜索集合 —— 声明一个 lookup 等「不可搜索」字段,运行时会把**整条查询** 400
(`INVALID_FIELD`),列表工具栏搜索对全体角色彻底不可用。此前 `compile`/`validate` 只查
字段**存在性**,这类笔误全绿放行,只能靠人肉点搜索框发现。

新增规则 `searchable-field-unsearchable`(error 级,新导出常量同名):对每个视图级
narrowing(对象内建 `listViews`、`defineView` 的 `list`/`listViews`、react 页面的
`<ListView searchableFields>`)按**运行时同一个函数**(`resolveSearchFieldResolution`,
非复制的类型清单,杜绝再度漂移)判定 declared = enforced:

- 对象未声明 `searchableFields`(auto 源):视图里出现 lookup/json/hidden/审计列等
  auto-default 拒绝的字段 → 构建期 error,信息含类型与 400 后果,lookup 给出「镜像到本
  对象 text/formula 字段」的处方;
- 对象已声明(declared 源):视图条目超出对象声明集合 → 构建期 error(视图只能收窄、
  不能放宽,ADR-0061);
- 对象自身的 `searchableFields`(canonical)维持**只查存在性**:运行时 declared 分支按
  存在过滤、不按类型过滤,声明即被引擎执行,构建期拒绝会误伤运行时接受的元数据
  (ADR-0072 D1);
- 注册表注入的系统列在 narrowing 中跳过判定(其运行时元数据对 linter 不可见,宁可漏报
  不可误报)。

内部核心 `checkSearchableFieldList` / `indexObjectSearchTargets`(模块级导出,未入包
barrel)签名有变:索引值从 `Set<string> | null` 变为 `ObjectSearchTarget | null`,并新增
可选 `role: 'canonical' | 'narrowing'`(默认 `'narrowing'`)参数。
