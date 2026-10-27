---
'@objectstack/lint': minor
---

fix(lint)!: the view and object publish doors refuse a list-view chart whose dataset, dimension or measure does not resolve

Clause-②: no (narrowing) — a list view whose `chart.dataset` names no declared dataset, or whose `chart.dimensions` / `chart.values` names a dimension or measure its dataset does not declare, is refused at publish (`PUT /api/v1/meta/view`, `PUT /api/v1/meta/object`); it published `200` before. `os validate` / `os build` already refused it on the shapes they walked, and still do; they now also report it where they skipped it: an `objects[].listViews` chart in a stack that declares no datasets, reports, views or pages, and a `views[]` entry in the flattened list overlay or ViewItem `config` shape. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: an existing author-time rule now also runs at the view and object publish doors. There is no mechanical rewrite to prescribe, because only the author knows which declared dataset or measure the chart meant. -->

**BREAKING** accept-set narrowing at the runtime publish door: `validateChartBindings` (`@objectstack/lint`) joins the reference-integrity suite's `view` and `object` writes.

- **Why.** A Studio or MCP author who mistyped a dataset name, or named a measure the dataset lacks, got a saved view whose chart rendered empty or broken, with nothing saying why, while the CLI refused the same file.
- **Before.** Measured on the real `PUT /api/v1/meta/view` route over a real `sys_metadata` store: a chart list view naming `no_such_dataset`, or a `values` entry naming no measure of its dataset, answered `200` and was stored, as a view item (`config`), as a flattened list overlay and as a container `listViews` member alike. `os validate` / `os build` skipped the same two cases the door now reports: an object's `listViews` chart in a stack with no datasets, reports, views or pages, and the flattened overlay and ViewItem `config` shapes.
- **Now.** Each is refused `422 INVALID_METADATA` with the verdict `os validate` gives: `chart-dataset-unknown` at `chart.dataset`, `chart-measure-unknown` at `chart.values[i]`, and `chart-dimension-unknown` at `chart.dimensions[i]`. The rule's list-view walk now opens the two standalone view shapes the door carries (the flattened list overlay and the ViewItem `config`), and an object's own `listViews` is judged on an object write. A draft save is not gated, as for every author-time rule.
- **Who moves.** No view or object in `examples/**` or `packages/platform-objects` is refused: measured at the door's own snapshot shape, the two chart list views in the showcase app bind declared datasets and measures.

**The remedy.** Bind a dataset the stack or package declares, and name its declared dimensions and measures (a measure name such as `amount_sum`, never the base field `amount`), or declare the missing dimension or measure on the dataset.
