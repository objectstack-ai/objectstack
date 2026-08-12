---
'@objectstack/spec': major
---

**未知键收紧:`ui/theme.zod.ts` 全部 14 个站点 + `ui/chart.zod.ts` 5 / 7 个站点(#4001 批 15)**

作者写进主题和图表配置里的未声明键,过去被 zod 默认的 `.strip` 静默丢弃、解析照常成功。现在是一条点名该键、并在能识别时给出正确拼法的报错。

**先测门,再收紧。** 两个文件在账本上都标着 `authorable (p)`,`(p)` 是待验证:

- `theme.zod.ts` —— 门是真的,而且有两道:`stack.zod.ts` 声明 `themes: z.array(ThemeSchema)`(所以 `defineStack()` 在每次启动和 `objectstack build` 时解析每个主题),`defineTheme()` 直接解析一个。从 24 个 metadata-type root 加 `ObjectStackSchema` 做 BFS,文件内每个 schema 都可达。**14/14 收紧。**
- `chart.zod.ts` —— 5 个可达(`DashboardWidget.chartConfig` / `ReportChartSchema`),已收紧;**`ChartAggregateSchema` 与 `ChartGroupBySchema` 的 object 分支不可达,故意保持原样**,见下。

## 破坏性变更 · 迁移

以下写法过去被静默接受(键被丢弃),现在报错。括号内是新报错直接给出的处方。

**主题(`defineStack({ themes })` / `defineTheme()`)**

| 旧写法 | 改成 |
|---|---|
| `colors: { card, foreground, mutedForeground, muted, destructive }` | `surface` / `text` / `textSecondary` / `disabled` / `error` |
| `typography.fontSize: { md }` | `base`(`borderRadius`/`shadows` 有 `md`,字号阶梯没有) |
| `typography.fontWeight: { base }` | `normal` |
| `animation.timing: { easeIn, easeOut, easeInOut }` | `ease_in` / `ease_out` / `ease_in_out` |
| `shadows: { inset }` | `inner` |
| `zIndex: { backdrop, overlay }` | `modalBackdrop` |
| 顶层 `palette` / `radius` / `shadow` / `animations` / `cssVars` / `extend` | `colors` / `borderRadius` / `shadows` / `animation` / `customVars` / `extends` |
| #3494 删除的 8 个 prop(`spacing` / `breakpoints` / `logo` / `density` / `wcagContrast` / `rtl` / `touchTarget` / `keyboardNavigation`) | 各自带独立墓碑处方;多数指向 `customVars`,`logo` 指向 app 的 `branding.logo` |

**图表(dashboard widget 的 `chartConfig` / report 的 `chart`)**

| 旧写法 | 改成 |
|---|---|
| `chartType` | `type`(`chartType` 是内部拼写,从来不是作者契约) |
| `legend` / `dataLabels` | `showLegend` / `showDataLabels` |
| `interactions` / `annotation` | `interaction` / `annotations`(同一个块里一个单数一个复数) |
| axis 上的 `name` / `label` / `dataKey` | `field` / `title` |
| series 上的 `field` / `title` / `stackId` / `strokeDasharray` | `name` / `label` / `stack` / `dashArray` |
| annotation 上的 `from` / `to` | `value` / `endValue` |
| `interaction.zoom` / `interaction.clickAction`(#3752 已删) | `brush: true` / `onSegmentClick`、`ReportSchema.drilldown`、widget 的 `options` 袋 |
| `width` / `stacked` / `dataset` / `objectName` / `aggregate` / `options` | 都是层级放错,报错点名正确的那一层(`layout.w`、`series[].stack`、widget 自己的键、react prop) |

⚠️ **严格性会顺着 `.extend()` 传到 `ReportChartSchema`**(`ChartConfigSchema.extend(...)`)。这是有意的,并有测试钉住:report chart 只是把 `xAxis`/`yAxis` 收窄成 dataset 维度/度量名,不新增键,所以继承的键集正好。

## 两个站点故意没收紧

`ChartAggregateSchema` 和 `ChartGroupBySchema` 的 object 分支**有活的承载键**(react 层 `< ObjectChart objectName aggregate={…} >`,objectui 的 `ObjectChart` 真的读它跑查询),**但没有任何 parse**:两者从所有 metadata-type root 都不可达,三个仓库里除单测外无人 `.parse()`,而唯一审查它的 react 页发布 lint 是手写重推规则、从不检查未知键。

`.strict()` 是 parse 的属性,这里没有 parse —— 收紧只会让文件看起来完成,并留下*一个被精确校验的死槽位*(#4583)。账本因此新增第四类 **`no gate`**(承载键活、parse 缺),与批 13 的 `no door`(承载键本身不存在)并列:两者处方相反,前者该接闸门,后者该走 ADR-0049 退役。已归档为独立 issue。

主题里那些**发出后无人读取**的 CSS 变量(`--font-size-*` / `--z-*` / `--duration-*` …)是 ADR-0049 的 liveness 题目,不是未知键题目,同样单独归档 —— 收紧能让被丢弃的键变响,不能让一个槽位变活。

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
