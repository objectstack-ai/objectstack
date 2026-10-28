---
'@object-ui/plugin-report': patch
---

feat(plugin-report): the report page offers CSV / XLSX export of the table it draws (`exportOptions`)

Clause-②: no
Metadata-protocol: none

`ReportSchema.exportOptions` (`{ formats?, includeHeaders?, fileNamePrefix? }`) was accepted but read by nothing, so a report table could not be downloaded. The report page now reads it:

- **The control.** A non-joined report draws an Export control above its body once its table has rows, offering the declared formats in order: absent means CSV and XLSX, `formats: []` draws no control.
- **What is exported.** The table as drawn: the grouped table or the matrix cross-tab, its header row (dimension and measure labels as shown), its rows in the order shown and the server totals it draws. The file carries whatever the table's own query carried (the report's `runtimeFilter` and, where declared, its period); nothing is re-queried or re-aggregated. `includeHeaders: false` drops the header row.
- **Who may export.** Not a report key: the control is offered only when the viewer's effective API operations on the dataset's base object include `export` (`ObjectPermission.allowExport`, the predicate the list toolbar uses). An absent operation set (no permissions provider, an unrestricted object) keeps it, as on the list.
- **The files.** Both are written in the browser. The CSV is the drawn text (UTF-8 with a byte-order mark, RFC 4180 quoting; a data cell opening with a formula character is prefixed with a tab). The XLSX writes measure cells as numbers; ExcelJS is imported only when an XLSX is asked for. The file is named `fileNamePrefix`, else the report label, plus a local timestamp (the list export's file name builder).

`@object-ui/plugin-report` now depends on `@object-ui/permissions` and `exceljs`.
