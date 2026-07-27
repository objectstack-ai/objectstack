---
'@objectstack/lint': minor
'@objectstack/cli': minor
---

Page-component field bindings and non-dashboard chart bindings (issue #3583, Phase 2)

Two more reference-integrity rules from the #3583 assessment, both wired into
`os validate`, `os lint`, and `os compile`.

**`validate-page-field-bindings`** — `PageComponent.properties` is an untyped
bag, so a highlights strip, KPI card, or details section can name a field the
bound object does not have; the component silently skips it. Which object a
component binds follows `dataSource.object` → `properties.object` → the page's
`object`, so multi-object pages are checked per element. `record:related_list`
resolves its columns/sort/filter against the **related** object and its
add-picker against that picker's own object. Advisory (matching
`FORM_FIELD_UNKNOWN`). Relationship paths, system fields, cross-package objects,
and unregistered component types are skipped.

**`validate-chart-bindings`** — extends ADR-0021 axis checking past dashboards to
report charts (`report.chart` and `report.blocks[].chart`), list-view charts
(`views[].list`, `views[].listViews.*`, `objects[].listViews.*`), and
dataset-bound page chart components. An axis naming a raw field instead of a
declared measure is an **error** (the series comes back empty); an axis naming a
declared-but-unselected measure is a **warning**. The report shape needed its own
handling: `ReportChartSchema` narrows `xAxis`/`yAxis` to bare strings, which the
dashboard rule's array guard skips silently. The react `<ObjectChart>` block is
object-bound, not dataset-bound, and is deliberately left out — nothing defines
what its aggregate names the result column.

**Fixes:** the page walk used by `validate-action-name-refs` read a top-level
`page.components` array, which `PageSchema` does not have — components live under
`regions[].components[]` and `slots`, and sub-trees nest inside the untyped
`properties` bag (`children`, `items[].children`, `body`, `footer`) rather than a
`children` key on the component. The rule was therefore visiting nothing on a
schema-parsed stack. Traversal now lives in one shared, tested module; on the
showcase app it reaches 194 components where the previous shape found 46.
Source-authored pages (`kind: 'html' | 'react' | 'jsx'`) are skipped — their
`regions` hold a derived cache the `source` wins over.
