---
'@objectstack/spec': major
---

spec(ui): `userFilters.allowAddTab` 提升进契约,`UserFiltersSchema` 随之收紧 (#5073)

`UserFiltersSchema` 是 #4001 批 18 在 `ui/view.zod.ts` 留下的最后一块「不是 strictness 问题」的开放形状 —— 挡住它的是一条**能力声明**,不是姿态判断。

**为什么之前不能直接关。** objectui 的列表渲染器真读 `config.allowAddTab` 并据此渲染「新增 tab」控件(`plugin-list/src/UserFilters.tsx:182` / `:742`),它自己的 `UserFiltersSchema` 也声明了这个键 —— 两边形状的差集恰好只有这一个。而 `saveMetaItem` 用 `safeParse` 校验后**原样存原始 body**(丢弃 `parsed.data`,好让 Studio 的辅助键活过往返),所以被 strip 掉的只是那份被丢弃的解析结果:存储里键还在,渲染器读得到,**这个能力今天是工作的**。直接收紧不是「把静默失效变响亮」,而是把一个已发布、在用的配置变成 422 —— 而且 422 会点名一个作者本来写对了的键,正是本战役 finding 7 的形状(平台权威把作者引向删掉能工作的东西)。

**裁定与落地(维护者 2026-08-04,选项 A):promote 后收紧,同 PR 完成。** `allowAddTab` 现在**声明**在 `UserFiltersSchema` 上,能力因此可从契约被发现 —— JSON Schema、Studio 的 SchemaForm、AI 作者都看得到,而不是只存在于一个 React 文件里。被否决的是判它为 objectui-only 扩展(`SANCTIONED_LOCAL`):那会让 `packages/spec` 与 objectui 成为同一份契约的两个事实来源,正是 #2231 的 derive-by-reference 统一要消掉的分叉(PD#12)。声明的措辞刻意收窄到渲染器真做的事 —— 它声明「渲染出新增 tab 的入口」,不承诺点击后能创建预设(objectui 那个按钮目前没有 click handler,已另行立案),因为承诺更多就是 PD#10 的「宣传运行时并不交付的能力」。

## BREAKING

**1. `userFilters` 上的未知键从静默丢弃变为拒绝。**

```diff
  userFilters: {
    element: 'tabs',
-   allowAddTabs: true,   // 拼错 → 以前静默消失,现在 422(并提示 → allowAddTab)
+   allowAddTab: true,
  }
```

FROM → TO:未声明的键 → 删除它,或改成它想表达的那个已声明键。错误信息会点名该键并给出最近的候选。`allowAddTab` 本身**不需要迁移** —— 它现在是合法声明键,原有配置照常通过。

**2. 对象列表视图(`ObjectUserFiltersSchema`)拒绝 page-only 的三个键:`tabs` / `showAllRecords` / `allowAddTab`。**

这三个键在对象视图上一直是无效的(`ObjectUserFiltersSchema` 由 `UserFiltersSchema.omit()` 派生,而 `.omit()` 继承基类姿态),此前被静默丢弃 —— 与此同时 CLI lint(`packages/lint/src/validate-list-view-mode.ts`)早就在报同一个配置。两扇门从此一致。

```diff
  // 对象视图:tab 栏的角色已被 ViewTabBar(已存视图切换器)占用
  listViews: {
-   // userFilters: { element: 'dropdown', tabs: [{ name: 'mine', label: '我的' }] }
+   mine: { label: '我的', filter: [['owner', '=', '{userId}']] },   // 每个具名视图渲染成一个分段 tab
  }
```

FROM → TO:`userFilters.tabs` → 对象的 `listViews` 具名条目;`showAllRecords` → 默认列表视图本身就是「全部记录」入口;`allowAddTab` → 由 ViewTabBar 自带的新增控件承担。三条拒绝各自带 `guidance` 处方,不是裸的 "unrecognized key"。

派生变体同时改为携带**自己的**错误映射:`.omit()` 会连基类的 `knownKeys` 一起继承,而那份候选列表是从基类形状读的、仍然含被 omit 掉的键 —— 实测在对象视图上写 `tab` 会被答复 *"Did you mean `tab` → `tabs`?"*,把作者指向这个形状唯一拒绝的键。形状仍由 `.omit()` 派生(#2231 不变),候选池改为按 omit 后的形状构建。

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
