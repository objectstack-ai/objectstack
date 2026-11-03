---
'@object-ui/plugin-report': patch
---

fix(plugin-report): a report draws a dataset dimension's `nullLabel` for its null bucket

Clause-②: no
Metadata-protocol: none

A dataset dimension can name its null bucket with `nullLabel` ("No region"), and the dataset query answer carries it on the column, `fields[].nullLabel`. The dashboard widget already drew it, but a report drew the same bucket as "—", so one dataset read "No region" on a dashboard and "—" in a report.

The report now draws the declared label wherever it draws a null dimension value: the summary table's rows and group headers, the matrix's row and column headers, and the CSV and XLSX export cells, so a download says the same words as the screen. A dimension that declares no `nullLabel` keeps "—", and every non-null value, an empty string included, is drawn as before. Grouping, totals and drill-through are unchanged: they still read the raw value.
