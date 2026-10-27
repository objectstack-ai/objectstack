---
'@objectstack/lint': minor
---

fix(lint)!: a list view's chart bound to a dataset over another object is refused (`list-view-chart-dataset-foreign-object`)

Clause-②: no (narrowing) — a list view whose `chart.dataset` names a dataset declared over another object than the one the list view lists is refused at publish and fails `os validate` / `os build`; it saved and published before. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: a new author-time rule refuses one combination of two existing references. There is no mechanical rewrite to prescribe, because only the author knows whether the chart belongs on the dataset's object, on a dashboard, or needs a dataset over the list's own object. -->

**BREAKING** accept-set narrowing in `validateListViewFieldRefs` (`@objectstack/lint`), served by the runtime save door (`PUT /api/v1/meta/view`, `PUT /api/v1/meta/object`) and by `os validate` / `os build`.

- **Why.** A list view's chart draws the rows of its dataset's base `object`: the list hands the dataset query the dataset name, its dimensions and its measures and nothing else, so neither the list's object nor its filter reaches the query. A chart under one object's list bound to a dataset over another object plotted that other object's records, labelled as a view of the first.
- **Before.** Such a list view saved and published `200` with no advisory: measured with a view item and a view container written into one package and bound to a dataset over another package's object. No rule compared the two objects on any list-view shape.
- **Now.** It is reported once per list view, at `chart.dataset`, as `list-view-chart-dataset-foreign-object` (`error`). The verdict names the view, the dataset and both objects. The publish is refused `422 INVALID_METADATA`; a draft save is not gated, as for every author-time rule.
- **A dataset that reaches the list's object through a relationship is refused too.** `include` lists to-one relationships from the dataset's base object, so it adds columns to group by and never a second set of rows: a dataset over opportunities that includes their account still counts opportunities.
- **Not judged.** A dataset that resolves to nothing (`chart-dataset-unknown`), a dataset that declares no `object`, and a list view whose own binding does not resolve.
- **Who moves.** No list view in `examples/**` or `packages/platform-objects` is refused: the two chart list views in the showcase app bind datasets over their own objects.

**The remedy.** Bind a dataset declared over the list view's own object, or move the chart to a list view of the dataset's object or to a dashboard widget naming the dataset. Which one is the author's call, so nothing rewrites it for you.
