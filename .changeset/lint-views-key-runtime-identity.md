---
'@objectstack/lint': patch
---

`translation-target-unknown` 按运行时视图身份判定容器默认 `list` 的 `_views` 键(#5164 第 2 棒 / lint 段)

`validate-translation-references` 的 `collectViewRecord()` 过去读 `view.list.name`
来决定容器默认列表贡献哪个 `_views` 名 —— 作者没写 `name` 时它什么也不注册,而组装器
(`expandViewContainer`,`packages/spec/src/ui/view.zod.ts`)给同一个视图的身份是
`<object>.default`。第 1 棒(#6124)已把 i18n 提取器改为向组装器查询同一个键,于是
**同一次 `os lint` 运行里**出现了一对自相矛盾的结论:

- 要求方 `i18n/missing-view`:`objects.<object>._views.default.label` 缺翻译;
- 否定方 `translation-target-unknown`:`_views.default` 是孤儿键,「no view of object
  `<object>` declares it」。

作者补了译文被判孤儿,删了译文被判缺翻译,两条都躲不掉。本仓库自带示例上实测有 8 处
(`examples/app-showcase` 6 处、`examples/app-todo` 2 处)。

本规则现在同样**向组装器查询**这个键,而不是第三次自行推导,因此继承了组装器仅有的三条
规则:

- 无 `name` 的默认列表键为 `default`;带 `name` 的沿用作者的 `name`;
- 结构上与某个 `listViews` 条目完全相同的默认列表被组装器按签名**折叠**进该条目,只有
  存活的那个键合法 —— 被折叠掉的 `list.name` 不再是合法键(`examples/app-crm` 形状);
- 因命名冲突被改名的键(`default` → `default_2`)按**改名后**判定,因为改名后的名字才是
  注册表键。

## 判定变化(全是 warning,不改 `os lint` 退出码)

| 形状 | 变化前 | 变化后 |
|---|---|---|
| 默认 `list` 无 `name`,包里写 `_views.default.*` | 报孤儿(误报) | 通过 |
| 默认 `list` 无 `name`,包里写 `_views.list.*` | 报孤儿 | 报孤儿(不变;提示语现在会列出 `default`) |
| 默认 `list` 与某个 `listViews.<k>` 同签名,包里写 `_views.<list.name>.*` | 通过(漏报) | 报孤儿 —— 该键运行时解析不到 |
| 默认 `list` 因冲突被改名 `default_2`,包里写 `_views.default_2.*` | 报孤儿(误报) | 通过 |

本仓库 12 个受棘轮覆盖的配置上实测:**新增 0 条**,消除 8 条误报;
`check:i18n-coverage` 基线不变(该棘轮只数 `i18n/` 前缀,本规则不在其内)。

裁决依据:维护者 2026-08-06(#5164)—— `_views` 翻译键的 canonical 拼写 = 运行时身份的
裸键。第 3 棒 objectui `viewSuffixes` 去第二候选(objectui#3502)不在本次变更内。
