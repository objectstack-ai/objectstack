---
"@objectstack/spec": minor
---

feat(spec): 内联 `type:'api'` action 的静态载荷改由 `bodyExtra` 承载 —— `params` 只保留参数定义数组语义(#5777)

`InlineActionSchema.params` 从 `ActionSchema` pick 而来,类型是 **`ActionParam[]` 参数定义数组**
(执行前弹对话框收集的字段)。而 showcase 的纯 SDUI 联系表单在提交按钮上写的是**请求载荷 map**
(`params: { name: '{{page.inquiryName}}', … }`),objectui 的 `ActionRunner` 两种都接、用
`Array.isArray` 分流 —— 一个键上并存两套事实契约。生成的参考文档只讲得出数组那一种,照参考写
`api` 提交按钮的作者(或 AI 作者)写不出能跑的载荷。这正是 Prime Directive #12
「宽容消费者把错误约定化石化」的形状。

维护者 2026-08-06 裁定取**方向 A —— 另立载荷键**,明确不做同名 union。

- **`bodyExtra` 就是那个键**,`ActionSchema` 一直为 `type:'api'` 声明着它
  (「static body fragment merged into the outgoing request body」),本次把它 pick 到
  `InlineActionSchema` 上,内联 action 因此第一次有了被授权的载荷写法。**没有新造键名**:
  `body` 早已被 `script` action 的 L1/L2 hook body 占用(#4352 的 refinement 会连带拒绝),
  `payload` 早已是指向 `bodyExtra` 的别名(#5013),两个候选拼写都不可用 —— 裁决点是「另立键」,
  键名归实施评审。
- **`params` 只剩一个含义**。对象形态在此被**响亮拒绝**,且拒绝语句直接点名 `bodyExtra`,
  而不是作者无从下手的 `expected array, received object`。
- **ADR-0087 D2 conversion `inline-action-api-params-to-body-extra`**(protocol 17,
  **live window**,18 退出加载路径):加载期把 `element:button` 上 `type:'api'` 内联 action 的
  对象形态 `params` 改写为 `bodyExtra`,每次改写发一条结构化 `ConversionNotice`。存量
  `sys_metadata` 行经 `applyConversionsToStoredItem` 同样覆盖。

FROM → TO:

- `pages[].regions[].components[]`,`type` 为 `element:button`,且
  `properties.action.type === 'api'`:对象形态的 `properties.action.params` →
  `properties.action.bodyExtra`

三条边界按既有惯例、并有测试钉住:

- **`Array.isArray` 是全部判别式**:真正的 `ActionParam[]` 定义数组原样不动。
- **只改 `type:'api'`**:`type:'url'` 上的对象形态 `params` 是第三种含义
  (`ActionRunner.interpolateTarget` 的 `${param.X}` 取值域、`executeUrl` 的 `params.newTab`),
  改写过去会丢信息,故不在本条目范围内。
- **canonical 优先**:`bodyExtra` 已在场且内容不同时不改写、不发通知,两个键都留着让作者自己收敛(#4923)。

未扩展到注册 action:`ActionSchema` 在 `defineAction` 处一直被解析,数组形态的 `params`
从来就在作者门口拒绝对象形态;缺口只存在于内联路径 —— 那里 `PageComponent.properties`
是开放袋,直到 #5068 才有东西去解析 props。

**发散窗口(诚实记录)**:本次合并之后、objectui 侧跟进单落地之前,用新键写的页面尚未被今天的
`element:button` 渲染器读取 —— 它的转发白名单还没有 `bodyExtra`。方向是「spec 先接受,渲染器后跟上」,
绝不反向。runner 与 console `apiHandler` 本身已经会读这个键(并对其中的 `{{page.<var>}}`
做 `resolvePageVarTokens`),缺的只是那一跳转发。
