---
"@objectstack/spec": minor
---

feat(spec): `drillDown.target` 补上 `'navigate'` —— 渲染器已经兑现的第三个 arm (#5435)

`<ObjectChart drillDown={{ target }}>` 现在接受 `'navigate'`,联合从
`'drawer' | 'dialog'` 扩成 `'drawer' | 'dialog' | 'navigate'`。**纯 additive**:
之前能解析的一律照旧解析。

## 为什么现在才加

#5022 当初把 `'navigate'` 排除在外,依据是一条**测量**而不是设计偏好 ——
当时 objectui 的 `ObjectChart` 自绘抽屉只分支 `'dialog'`,`'navigate'` 会静默
落进 Sheet。声明一个渲染器不兑现的值,等于用协议承诺一次永远不会发生的跳转。

objectui#3382 把这条测量改掉了:`ObjectChart` 现在真正兑现 `'navigate'`,语义
对齐 `DrillDownDrawer.navigateOnly` —— 也就是 table / pivot / metric 三个 widget
在共享的 `DrillDownConfig` 上一直以来的行为。测量失效,联合随之跟上。

顺序不可颠倒:**先有渲染器兑现,协议才声明**。在此之前(objectui#3382 合并前)
拒绝 `'navigate'` 是正确的。

## 写法与兑现条件

```jsx
<ObjectChart objectName="opportunity"
             aggregate={{ function: 'sum', field: 'amount', groupBy: 'stage' }}
             drillDown={{ target: 'navigate' }} />
```

- `'drawer'`(默认)—— 就地侧边抽屉;
- `'dialog'` —— 居中模态,适合图表本身已经在抽屉里、再叠一层 Sheet 会很别扭的场合;
- `'navigate'` —— **跳过就地视图**,直接打开该对象的完整列表页,带上抽屉本会用的
  同一套过滤条件(widget filter ∧ 点击段的上下文)。适合「钻取结果是目的地」而不是
  「瞄一眼」的场景。

`'navigate'` 是唯一带 **host 前提**的 arm:宿主应用必须提供 drill navigation
(objectui 侧是 `DrillNavigationContext.openRecordList`)。宿主没提供时无处可跳,
渲染器**文档化回落**到 `'drawer'` —— 这是既定行为而非故障,点击照样打开记录,
只是就地打开。

注意 escape hatch 与本键无关:只要宿主接了 drill navigation,抽屉里就一直有
"Open in list" 动作,所以 `'drawer'` 的图表也能按需到达列表页。`'navigate'` 的
意义是把这次跳转变成**默认**的点击行为。

## 影响面

`packages/lint` 的 `validate-react-page-props` 直接 parse `ChartDrillDownSchema`,
所以发布闸门随联合一起放行 —— 该 gate 本身一行未改。收窄未发生:三个 arm 以外的
`target` 仍然按值被拒。
