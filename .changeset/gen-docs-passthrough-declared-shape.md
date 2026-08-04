---
"@objectstack/spec": patch
---

fix(spec): 参考页不再把「已声明键 + passthrough」的对象塌缩成 `Record` (#4912)

`gen:docs` 的类型渲染器先判 `additionalProperties`、后判 `properties`,而 JSON Schema 把
`.passthrough()` / `.catchall()` 对象**同时**表达为这两者 —— 于是每个「有形状、又开放」的
对象在参考页上都被渲染成一个光秃秃的 `Record< string, any >`,**已声明的键被整个抹掉**。
`BulkActionParam.options` 是立案时的样本:它的 `label` / `value` 是**必填**的,页面却显示
「无形状」。PR #4909 当时是在该键的 `.describe()` 散文里手工补偿的,那是逐点补偿,不是修复。

声明键与开放性是**两个独立的事实**,现在分别呈现:

- 之前:`Record< string, any >[]`
- 之后:`({ label: string; value: string | number | boolean } & Record< string, any >)[]`

数组元素上的括号是必需的 —— `A & B[]` 在 TypeScript 里是 `A & (B[])`,不加括号等于声明了
另一种类型。已声明键超过四个时仍然省略,`…`(还有更多**已声明**键)与
`& Record< string, any >`(还接受**未声明**键)是两件不同的事,单元格两者都印。

本次重生成影响 6 张参考页共 12 个单元格,全部是恢复被抹掉的声明键,没有任何一页丢失形状:
`ui/bulk-action`(`params`、`options`)、`ui/view`(`gantt`、`tree`,ListView 与
ObjectListView 各一份)、`ui/dashboard`(widget `options`)、`api/protocol`(三处 AI
`messages`)、`system/auth-config`(`socialProviders`)、`kernel/startup-orchestrator`
(`plugin`)。

渲染逻辑从 `build-docs.ts` 抽到 `scripts/lib/format-type.ts` 并配了单测:此前要断言它的输出
只能跑完整个生成器再 grep `.mdx`,这正是该塌缩能在整个 #4001 战役期间无人察觉的原因。
