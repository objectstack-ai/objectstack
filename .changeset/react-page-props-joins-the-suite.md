---
"@objectstack/lint": patch
"@objectstack/cli": patch
---

fix(lint,cli): `os lint` / `os compile` 不再放行一个 `os validate` 会拒绝的 react 页面

`validateReactPageProps` 只手工接在 `os validate` 上,另外两个命令从来没跑过它。
在 showcase 的 react 页面上植入一处 gating 违规(`<ListView filters={['no_such_col','=',stage]}>`
—— 谓词命中不了任何行,列表回空,和「本来就没数据」无法区分)实测:

```
              os lint      os compile     os validate
  修复前      exit 0 放行   exit 0 放行    exit 1 拒绝
  修复后      exit 1 拒绝   exit 1 拒绝    exit 1 拒绝
```

这条规则在 #4340 之后已经是**整个 react 页面表面唯一**的字段解析闸门:
`<ListView>` 的 columns/fields/sort/grouping/userFilters、`<ObjectForm>` 的
fields/initialValues/sections/subforms、`record:*` 一族(与元数据表面共用同一张
`COMPONENT_FIELD_SPECS`)、`<ObjectChart>` 的 aggregate/axes、以及 `searchableFields`。
漏接不是少几条警告 —— 而是这些绑定在 build 路径上**完全没人看**,包括其中会 gate 的那些。

现接入 `REFERENCE_INTEGRITY_RULES`,`os validate` 里那处手工接线随之删除,三个命令的
答案由构造保证一致。这正是 suite 设立要终结的漂移(#3583 §5 D5),也是
`validateReadonlyFlowWrites` 在 #4394 里刚走过的同一条路 —— 那次的教训是
「一张 map、两个检查、两套命令集合」,这次是「一次 JSX parse、七个 rule id、
一套命令集合」。

规则行为零变化:id、严重级、文案都不动;喂进去的输入也不变(`os validate` 原本就
传 `result.data`,suite 拿到的是同一个)。`#4402` 的接线守卫会在下一次有人想再手工
接一条规则时直接报错。

`validateReactPageProps` 沿用 `validateHookBodyWrites` / `validateActionBodyWrites`
的惰性约定:只有真的存在 `kind:'react'` 页面时才加载 TypeScript 编译器。
