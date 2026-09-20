---
"@objectstack/spec": minor
---

feat(spec)!: a metric-family dashboard widget declares exactly ONE measure — `values` is bounded above on `metric` / `kpi` / `gauge` / `solid-gauge` / `bullet` (#17779; objectui#8894 ruling D, decision batch #119 item 4)

Clause-②: yes (narrowing) — this diff BOTH narrows and widens, which is the shape this arm exists for. The accept set NARROWS (that is the change). What makes the value `yes` is the other axis: the published surface GAINS one exported symbol, `checkDashboardWidgetMetricMeasureArity`, and a new exported symbol is the mechanical floor for in-seat contract review.

<!-- adr-0087: registered dashboard-widget-metric-family-multi-measure-refused -->

**BREAKING** accept-set narrowing at `dashboard.widgets[].values`, shipped as
`minor` under this repo's launch-window convention for breaking changes
(`check-changeset-no-major` refuses `major` outright while the window is open, so
breaking-ness is carried by this banner and by the ADR-0087 disposition above,
never by the bump level). The mechanical prescription is registered under
protocol major 18 as `dashboard-widget-metric-family-multi-measure-refused`.

**What was wrong.** `DashboardWidgetSchema.values` was
`z.array(z.string()).min(1)` with **no upper bound on any widget type**, so a
`metric` tile could declare three measures. Measured on this tree before the
change: `{ type: 'metric', values: ['a','b','c'] }` returned `success: true`,
and so did `kpi`, `gauge`, `solid-gauge` and `bullet`, with `bogusProp` refused
by name on the same call as the lit control. The dataset query then **selected
and computed all three** and the tile rendered `values[0]` — the other two were
queried and dropped on the floor (objectui#7293 defect 1). objectui PR #8887
landed a sub-caption that says so, which makes the tile honest about dropping
them; it does not make the document legal.

The maintainer ruled **D** on objectui#8894 (decision batch #119 item 4,
2026-09-12 「同意」) under the standing rule 「协议不正确的应该先修改协议。」 —
judge the protocol wrong rather than invent display semantics for `values[1..]`.
A metric tile answers one number; `ChartTypeSchema` groups these five under
*"Performance (single value)"* in its own words. Several numbers is a different
visual, not a variant of this one.

### Write N tiles for N measures

| wrote | write instead |
|---|---|
| `{ id: 'sales', type: 'metric', values: ['amount_sum', 'count'] }` | `{ id: 'sales', type: 'metric', values: ['amount_sum'] }` **and** `{ id: 'sales_count', type: 'metric', values: ['count'] }` |
| several numbers wanted in ONE widget | a different visual: `type: 'table'` renders a row of measures, and `bar` / `line` / `area` / `combo` render one mark per measure — all keep the unbounded `values` they have always had |

Splitting is not done for you and no conversion could do it: N tiles need N ids
and N boxes on a 12-column grid, which is a layout decision about a dashboard
the registry has never seen. The refusal lands at `widgets[N].values` with one
`custom` issue naming the widget's `id`, the number of measures it declared and
the authored `type`, and prescribing one measure per tile.

**Exactly one is a conjunction, not one rule.** The field's own `.min(1)` still
owns the empty array (`too_small`, unchanged, and the new check deliberately
adds no second issue there); the new upper bound is
`checkDashboardWidgetMetricMeasureArity`, exported so objectui's `.shape` mirror
can re-attach it. A widget that declares no `type` is refused too — `type`
defaults to `metric` and zod applies defaults before object-level checks — and
the message says so rather than claiming the author wrote it.

**Nothing else moves.** All fifteen other `ChartTypeSchema` members — `bar`,
`horizontal-bar`, `column`, `line`, `area`, `pie`, `donut`, `funnel`, `scatter`,
`treemap`, `sankey`, `combo`, `radar`, `table`, `pivot` — keep accepting three
measures, byte for byte; `ReportSchema.values` is a separate declaration and is
untouched; and `dashboard.zod.ts` has no other `.min(1)` **array** key at all
(its one other `.min(1)` is `dashboard.columns`, a number bound, unchanged).
Fleet census over every tracked `.ts` / `.tsx` / `.json` / `.mdx` / `.md` /
`.yaml` at the branch point: **187** brace-local literals carrying a
`values: [...]`, **39** of them on a metric-family `type`, and **0** of those
carrying more than one measure. Both counts are lit controls on the scan.
