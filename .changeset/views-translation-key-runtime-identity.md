---
'@objectstack/cli': minor
---

i18n 提取器改用运行时视图身份来命名 `_views` 翻译键(#5164 第 1 棒 / cli 段)

**BREAKING(已发布翻译包的键):容器默认 `list` 的 `_views` 键由 `list` 改为运行时裸键。**

`objectstack i18n extract` / `os lint` 过去用 `view.list.name ?? 'list'` 推导一个
`defineView` 容器默认列表的翻译键,而运行时注册表(`expandViewContainer`,
`packages/spec/src/ui/view.zod.ts`)给同一个视图的身份是 `<object>.default`。两者是
两个不同的字符串,于是「只声明了默认 `list`、没有 `listViews`」的应用会拿到一份键为
`list` 的翻译骨架、一个键为 `default` 的运行时视图,界面上永远显示英文原文 —— 无论作者
按哪一侧编写都命中不了。

提取器现在**向组装器本身查询**这个键,而不是第二次自行推导。因此它同时继承了组装器
仅有的两条规则:

- 无 `name` 的默认列表键为 `default`(不再是 `list`);带 `name` 的沿用作者的 `name`;
- 结构上与某个 `listViews` 条目**完全相同**的默认列表会被组装器按签名折叠进该条目,
  因此它没有自己的键 —— 提取器不再为它多写一个谁也读不到的骨架条目
  (`examples/app-crm` 正是这个形状:`list` 与 `listViews.all` 同签名,真实键是 `all`)。

维护者 2026-08-06 裁决:`_views` 翻译键的 canonical 拼写 = 运行时身份的裸键。

## 升级:翻译包键的 FROM → TO

只影响用 `defineView({ list: … })` 声明了**默认列表**、且为它写过翻译的包。

| 容器形状 | FROM | TO |
|---|---|---|
| 默认 `list`,无 `name` | `objects.<object>._views.list.*` | `objects.<object>._views.default.*` |
| 默认 `list`,带 `name: 'x'` | `objects.<object>._views.x.*` | 不变 |
| 默认 `list` 与某个 `listViews.<k>` 结构相同 | `objects.<object>._views.list.*` | 删除(`_views.<k>.*` 已经覆盖它) |

一行修法:把 `_views.list` 改名为 `_views.default`;如果同一对象下已经有一个与默认列表
`type`/`label`/`columns` 完全一致的 `listViews` 条目,则直接删掉 `_views.list`。
重新跑一次 `objectstack i18n extract`(merge 模式保留已有译文)会得到正确的骨架。

本仓库自带示例已随迁:`examples/app-showcase` 5 个块、`examples/app-todo` 2 个语言包
改名为 `default`;`examples/app-crm` 3 个折叠形状的 `_views.list` 块删除。
`check:i18n-coverage` 棘轮基线经实测无需调整(需求侧与译文侧同批改名,覆盖数不变)。

`packages/lint` 的 `collectViewRecord` 收窄(#6038)与 objectui `viewSuffixes` 去第二
候选(objectui#3502)是本裁决的第 2、3 棒,不在本次变更内。
