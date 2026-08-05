---
---

docs(protocol): `protocol/objectui/widget-contract` 的 Theme 段停止教 #3494 已删除的 `density`,整段 token 词表按 #5021 的退役结果重写 (#5291)

该页 Theme 段的散文与 YAML 示例都在教 `density`(「`density` is one of `compact`,
`regular`, or `spacious`」+ 示例里的 `density: regular`)。这个键在 #3494 就被删了,
而 `ThemeSchema` 自 #4001 批 15 起是 `.strict()` —— 两件事叠加的结果是**照抄本页示例
必然 parse 失败**:`defineStack({ themes })` / `defineTheme()` 都会拒。拒绝本身是响亮
且带处方的(`THEME_RETIRED_KEY_GUIDANCE` 里 `density` 的墓碑),问题在于平台自己的权威
文档把作者送进了那次拒绝——对从这一页取样写主题的 AI 作者尤其贵。

原示例其实有**两处**解析失败:除 `density` 外,`colors:` 下只有一行注释,YAML 解析成
`null`,而 `colors` 是必填且 `primary` 必填。现在的示例是一份真能通过 `ThemeSchema`
解析的完整主题。

同时把整段的 token 词表口径刷新到 #5021 之后:

- 逐一列出 `ThemeSchema` 的**十个**可写键(`name` / `label` / `description` / `mode` /
  `extends` 五个身份与继承键,加 `colors` / `borderRadius` / `shadows` / `typography` /
  `customVars` 五个 token 键),并给出每个键实际落到 document 上的 CSS 变量——包括
  `colors` 出门时的改名(`surface` → `--card`、`text` → `--foreground`、
  `error` → `--destructive` …)、`borderRadius.base` / `shadows.base` 发的是裸
  `--radius` / `--shadow`、`typography` 自 #5021 起只剩 `fontFamily.base`(发
  `--font-sans`)。
- 新增一段 Callout 点名两批退役键:#3494 的 `spacing` / `breakpoints` / `logo` /
  `density` / `wcagContrast` / `rtl` / `touchTarget` / `keyboardNavigation`,以及 #5021
  (`@objectstack/spec` 17.0.0, ADR-0049)的 `animation` / `zIndex`、`typography` 四条
  排版标尺、`fontFamily.heading` / `mono`;两批的处方都是 `customVars`,且是逐字节等价
  的替代(`customVars` 里写 `font-size-lg` 发的就是同一个 `--font-size-lg`),并给出
  `os migrate meta --from 16`。

页面的每条断言都对着 `packages/spec/src/ui/theme.zod.ts` 与 objectui `ThemeEngine.ts`
逐键核过:16 个退役键全部被拒、10 个活键全部被接受。

Docs-only;releases nothing.
