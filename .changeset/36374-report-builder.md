---
'@object-ui/plugin-report': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the report builder — one page to build a new report or edit an existing one, with the report drawn live on the left and five settings on the right

Clause-②: yes (widening) — new public exports from `@object-ui/plugin-report` (`ReportBuilder` and its model types), a new optional `foldTableUnderChart` prop on `DatasetReportRenderer`, and new `@object-ui/i18n` keys (`report.builder.*`, `report.computedValues`) in all 11 locales; no spec or schema change
Metadata-protocol: none

- **The builder** (`ReportBuilder`, `@object-ui/plugin-report`): the report previewed on the left; report type, data source, measure, grouping and chart on the right. Every pick rewrites the report and the preview draws it again; there is no Generate button. Picking a data source draws a single number at once (the dataset's count measure, no grouping). While a required piece is missing, the preview says what it is where the chart would be (「Choose a data source」, 「Choose a field to group by」) and that setting's picker opens by itself. A second grouping layer splits a bar or line chart; the chart's own switches are Show values and a target line. Grouping by a date adds the report's period chip. The report's table folds under the chart as 「Computed values」.
- **The doors** (`@object-ui/app-shell`): the report page's 「Edit」 opens the builder for a dataset-bound report (a joined report and a pre-dataset report keep the inspector panel), and the app's `reports/new` address opens it on a new report. Admin only.
- **Save is seen by everyone at once:** the report is written and published in the same press, for the builder and the inspector panel alike. Over a draft someone else left pending nothing is written and the builder says so; the draft bar above the preview publishes or discards it.
