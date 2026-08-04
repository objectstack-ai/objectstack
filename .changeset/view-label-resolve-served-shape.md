---
"@objectstack/spec": patch
---

fix(spec): 视图标签 / 描述现在能真正解析出译文(#4854)

`resolveViewLabel` / `resolveViewDescription` 读取的两个字段,运行时实际下发的
视图文档一个都没有,因此**任何按正常方式(`defineView`)编写的视图,标签永远
落回英文字面量**,无论翻译包里写了什么。列表视图切换器横在每个对象列表页顶部,
所以在纯中文部署里,这是屏幕上最显眼的一处残留英文。

两处失配互相独立,任何一处都足以让解析失败,现已一并修复:

1. **对象名取不到。** 旧代码读 `view.objectName ?? view.data?.object`;而
   `GET /api/v1/meta/view?object=…` 下发的文档把对象放在**顶层 `object`**,
   授权配置嵌在 `config` 下。于是 `objectName` 为 `undefined`,函数在
   `if (!bundle || !objectName)` 处就返回了字面量,根本没走到查找。
   现在按 `objectName → object → data.object → config.data.object` 依次取值,
   与 i18n 提取器(`packages/cli/src/utils/i18n-extract.ts`)判定对象的顺序
   一致 —— 写 `_views` 键的那一端和读它的这一端,从此对"哪个字段代表对象"
   有相同答案。
2. **查找键也是错的。** 旧代码用 `view.name` 直接查;而下发文档的 `name` 是
   注册表分配的全局唯一身份 `<object>.<viewKey>`(如
   `crm_account.account_gallery`),翻译包按**裸键**存放
   (`objects.<object>._views.<viewKey>.label`)。现在查找前先剥掉
   `<object>.` 前缀 —— 这是对 `expandViewContainer` 组装规则的**反解**,不是
   容错别名;没有前缀的名字(手工构造的视图)原样使用,行为不变。

**非破坏性。** `ViewLike` 仅新增两个可选字段(`object`、`config`),既有调用
方式全部照旧;之前能解析的场景没有一个改变结果 —— 在此之前,下发文档这条路径
上本就没有任何东西能解析成功。应用侧无需改动:`_views` 的键仍然是编写视图时
用的裸键。

已知遗留(不在本次修复范围,另行跟踪):只声明了默认 `list`(没有 `listViews`)
的容器仍解析不出译文 —— 提取器写的键是 `list`,而组装器给它的注册名是
`<object>.default`。这是两个**生产方**之间的分歧,须在生产端统一,不能靠消费端
再加一层兼容。
