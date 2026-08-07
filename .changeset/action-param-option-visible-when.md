---
"@objectstack/spec": major
---

feat(spec): action param 的 `options[]` 讲得出逐选项 `visibleWhen` —— 一个接好线却被门挡着的门控能力 (#5016)

`ActionParamSchema.options[]` 的契约一直是 `{ label, value }`,#4001 批 14 把它从「靠删除来执行」改成了说出口。批 14 同时记下一个它不打算猜的能力问题:这个选项列表该不该讲 `SelectOptionSchema`(`data/field.zod.ts`)已经声明的那套逐选项词汇?#5016 逐键量了一遍,答案**不是整套照搬,而是一个键**。

## 只开 `visibleWhen`,因为只有它有读者

| 键 | 声明在 | action param 选项这条路上的消费者 | 本次 |
|:--|:--|:--|:--|
| `visibleWhen` | `SelectOptionSchema` | **有** —— 四个选项控件全都经 `useCascadingOptions` → `resolveCascadingOptions` 按它过滤(ADR-0058 / objectui#2284) | **开放** |
| `color` | `SelectOptionSchema` | 无 —— 只有**已存值**的展示渲染器读(网格单元格 / 详情徽章);对话框只拿列表建输入控件,提交完就丢 | 继续拒绝,附指路 |
| `default` | `SelectOptionSchema` | 无,且是**层级写错** —— 对话框参数的默认值走参数自己的 `defaultValue`,高一层 | 继续拒绝,附改法 |
| `icon` / `disabled` | 仓里任何 spec 形状都没有 | 无 —— 只活在 objectui 内部 `SelectOptionMetadata` 接口里,四个选项控件里每一个 `disabled` 都是**字段级**的 `props.disabled` | 继续拒绝(#5016 的 C 选项未采纳) |

挡在作者和一个**能工作**的逐选项门控之间的,此前就只有 spec 这道门:内联参数的 `options` 是逐字下沉的(objectui `resolveActionParam` 内联分支 `options: param.options` → `ActionParamDialog` 逐条 spread 只翻译 `label` → `paramToField` 原样交给控件),而 `ExpressionInputSchema` 产出的 `{ dialect, source }` 信封正是 `evalFieldPredicate` 接受的形状。

## 行为激活面 —— FROM → TO

**这是本次最需要注意的一行:同一份元数据,以前写了等于没写,现在真的生效。**

```diff
  params: [{
    name: 'severity', type: 'select',
    options: [
      { label: 'Normal',   value: 'normal' },
      { label: 'Overload', value: 'overload',
        visibleWhen: "record.status == 'open'" },
    ],
  }]
```

| 版本 | 上面这份 metadata 的下场 |
|:--|:--|
| 16.x | parse **成功**,出来的是 `{"label":"Overload","value":"overload"}` —— `visibleWhen` 在任何渲染器看到它之前就被静默剥掉,选项**永远可选** |
| 17.0.0-rc(#4001 批 14 起) | parse **失败**,`unrecognized_keys` 明确报错 |
| 17.0.0(本次) | parse 成功,键**保留并生效** —— `record.status != 'open'` 时该选项**不再出现在下拉里** |

所以从 16.x 升上来的应用,如果曾经推测性地写过逐选项 `visibleWhen`(当时无害,因为它被丢掉了),升级后选项集会**变窄**。请复查这些谓词是否是你今天真正想要的:不想要就删掉键,想要就确认表达式对 `record` / `current_user` 求值的结果符合预期。`color` / `icon` / `disabled` / `default` 在 16.x 同样被静默剥掉,本次**不会**突然生效 —— 它们改为在 publish 时响亮拒绝,并各自指向该词汇真正生效的地方。

⚠️ **客户端隐藏是 UX,不是授权。** `enforceActionParams` 按声明的选项**值**校验提交(ADR-0104 D2),它不求值逐选项 `visibleWhen`;因访问控制而屏蔽的选项必须由 action 自身的 body 或权限检查再拒一次,只把它从下拉里藏掉是可绕过的。

## 本次**没有**修的一件事(objectui 侧,已另行记录)

**字段回退那条路仍然丢键**:`resolveActionParam` 走的是 `param.options ?? normaliseOptions(field.options, …)`,而 `normaliseOptions` 把每个**继承来的**条目重建成 `{ label, value }`。这条丢弃早于本次改动、也不受本次影响(作者显式写的 `options` 数组优先级更高,压根不经过它),修复归属 objectui。因此本次的拒绝文案仍然刻意**不**开「把参数改成 field-backed 去继承」这张药方 —— 那是一条不存在的路(账本 finding 18:错误里的文案是行为,自信而错的处方比没有更糟)。

`bulk-action.zod.ts` 的 `.passthrough()` 特例维持不动:#4909 那两条理由(逐字到达 grid、objectui `BulkActionParam` 有显式 `[key: string]: unknown` 兜底)在这条路上都不成立,而这里的目标词汇是封闭的 —— 目标词汇封闭,正是「声明」胜过「容忍」的场合。
