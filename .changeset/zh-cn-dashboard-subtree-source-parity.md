---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the zh-CN `dashboard` metadata-form subtree says what its source says

Five leaves of `metadataForms.dashboard` in `zh-CN.metadata-forms.generated.ts`
described the Studio dashboard property panel in terms the source form
(`packages/spec/src/ui/dashboard.form.ts`) does not use, each one naming a
concept the source omits while dropping one it names:

| leaf | was | now |
| --- | --- | --- |
| `sections.layout.description` | 「栅格与响应式」 | 「栅格尺寸与刷新间隔」 |
| `sections.basics.description` | 「名称与图标」 | 「仪表板标识与描述」 |
| `sections.widgets.description` | 「图表、指标、列表等」 | 「放置在栅格上的卡片与图表」 |
| `sections.filters.description` | 「全局筛选与日期范围」 | 「应用到所有组件的默认筛选与全局筛选」 |
| `fields.header.helpText` | 「标题、操作按钮与筛选」 | 「仪表板页眉配置（title、subtitle、actions）」 |

Two of them sent a zh-CN author looking for a control that does not exist.
`layout` promised a responsive-breakpoint input in a section holding `columns`,
`gap`, `refreshInterval` and `header`, and left the refresh cadence unnamed.
`basics` promised an icon input; that section holds `name`, `label` and
`description`, and the dashboard schema declares no icon key at all — the only
`icon` under `dashboard.zod.ts` is per header action. The other three swapped
which concepts the section covers: widgets is cards and charts on the grid, not
metrics and lists; filters is default plus global filters across widgets, not
the date range (that is the separate `dateRange` field); and the header carries
a subtitle, not filters. The replacements reuse terms this bundle already
establishes — `grid` → 「栅格」, `widgets` → 「组件」, `identity` → 「标识」, and
the literal key list rendered as `（title、subtitle、actions）` the way
`page.fields.layout.helpText` renders `（header、main、sidebar、footer）`.

The source strings have not moved since the form was created: all five have been
byte-identical across that file's only two commits. zh-CN's values were carried
in from the pre-consolidation `metadata-translations/zh-CN.ts` overlay and never
reconciled against the extracted English, while es-ES and ja-JP were translated
from it and are correct at all five. So this is a translation correction, not a
re-sync after a source edit — nothing else in the bundle, the source form, or
the recorded source-hash companion changes.
