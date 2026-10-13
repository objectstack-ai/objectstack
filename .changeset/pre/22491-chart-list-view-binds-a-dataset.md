---
'@objectstack/spec': major
---

A `type: 'chart'` list view must bind a dataset: a view whose effective chart binding names no `dataset` is refused at every list-view door, at `chart` (no binding at all) or at `options.chart.dataset` / `options.chart.values` (an incomplete legacy bag), with the binding to declare.

Clause-②: yes (narrowing)

<!-- adr-0087: registered view-chart-binding-dataset-required -->

**BREAKING**: an accept-set narrowing on a published authoring surface and on the view write door, graded `major` on `@objectstack/spec`: Changesets is in pre mode on `main` (tag `next`), where the launch-window `major` guard stands aside for the line's breaking changes.

**Why.** A chart list view plots only the ADR-0021 `dataset` its binding names. The renderer reads that binding as the top-level `chart` block, else the legacy `options.chart` bag, the block replacing the bag whole. The `chart` block already required `dataset` and `values`, but a view with no block at all, or with only the bag, never met that schema: the view write door (`PUT /api/v1/meta/view/:name`) saved `type: 'chart'` with no `chart` block, and an `options.chart` bag holding only `chartType`, and `defineStack` / `os validate` accepted the block-less view. Such a view renders a dead screen: the renderer either guessed a binding nobody wrote or, since objectui retired that guess, refuses on screen.

**What is refused.** A list view whose `type` is `chart` and that:

- declares no `chart` block and no `options.chart` bag: one `custom` issue at `chart`, whose message begins *This list view is `type: 'chart'` but declares no `chart` block, so it binds no dataset and there is nothing to plot.*;
- declares no `chart` block and an `options.chart` bag with no `dataset` or no `values` (the bag is legal on the flattened overlay only): one `custom` issue per missing key, at `options.chart.dataset` / `options.chart.values`.

It is a check on the list-view schema itself, so it reaches every door that parses a list view: `defineView`, `defineStack`, `os validate` / `os build`, a view item's `config`, and the metadata write door, which answers `422 INVALID_METADATA`. **New export:** `checkListViewChartBinding`, published from `@objectstack/spec/ui`, is this refinement check itself, a `(view, ctx) => void` function; objectui's `ListViewSchema` mirror, which is built from `ListViewSchema.shape` and so drops the schema's object-level checks, attaches it with `.superRefine(checkListViewChartBinding)`.

**What stays accepted, byte for byte.** A chart view whose `chart` block names a `dataset` and at least one measure in `values`; a chart overlay whose `options.chart` bag carries both and no `chart` block replaces it; an incomplete bag under a complete `chart` block, which replaces it whole; a flattened overlay patch that names no `type`; and every view of another type, including a grid that only offers a chart in `appearance.allowedVisualizations`.

**What to do.** Bind the chart: declare a top-level `chart` block naming the dataset to plot and at least one of its measures, for example `chart: { dataset: 'lead_metrics', values: ['amount_sum'] }`, with `dimensions` (the X / group axis) optional and `chartType` defaulting to `bar`. A view that carries its binding in the legacy `options.chart` bag either completes the bag or, preferred, moves it to the top-level `chart` block. A view that is not meant to be a chart takes another `type`. No conversion can do this for you: only the author knows which dataset a chart plots.

**Stored views.** A stored `view` row is neither rewritten nor refused on read: it is served as stored, carries the same issue in its read-side `_diagnostics`, and is refused on its next save.

**Who is affected, measured.** No chart list view without a binding exists in this repository: the two chart list views in `examples/app-showcase` and the chart list views in the `@objectstack/lint` fixtures all bind a dataset and a measure. Deployed metadata was not measured.

### The kit

- **The refusal.** `checkListViewChartBinding` in `ui/view.zod.ts`, attached beside the calendar binding check at the three list-view doors: `ListViewSchema`, `ObjectListViewSchema` and the flattened list overlay member of the view write door. The `chart` slot's description now says a chart view must bind one, and the generated reference page carries it.
- **The ledger.** The D3 semantic entry `view-chart-binding-dataset-required` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion.
