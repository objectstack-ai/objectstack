---
'@objectstack/spec': patch
---

fix(spec): the `ReportSchema.chart` doc comment says the chart is drawn below the table of a `matrix` report with `columns`

Clause-②: no

The doc comment on `ReportSchema.chart` said the embedded chart is plotted above the report's
table. That holds for a `tabular` or `summary` report, and for a `matrix` report without
`columns`, which renders as a grouped table. A `matrix` report with `columns` renders as a
cross-tab, and objectui's `DatasetReportRenderer` draws the chart below it. The comment now
says so. It also drops a clause saying a chart on a `joined` report "parsed and plotted
nothing": the schema refuses that key today, so the clause no longer described it.

Doc comment only: the schema accepts and refuses the same reports, and no `.describe()` text
or export changes.
