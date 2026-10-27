---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/platform-objects': patch
---

feat(spec): a report declares the period it covers (`dateRange`) and the export of its table (`exportOptions`)

Clause-②: yes (widening)
Metadata-protocol: added

`ReportSchema` gains two optional top-level keys. A report that declares neither parses and renders exactly as before.

- **`dateRange: { dimension?, defaultRange, allowCustomRange }`.** A date window over one dimension of the report's dataset. `defaultRange` and `allowCustomRange` are the dashboard's own declaration, verbatim: the same preset table (`DATE_RANGE_DEFAULT_RANGES`), the same defaults (`this_month`, `true`) and the same rename hints. `dimension` names a dataset **dimension** that declares `type: 'date'`, not a raw object field; omitted, the dataset's one `type: 'date'` dimension is used. The window is a filter, not a bucket. The renderer sends it as `selection.timeDimensions: [{ dimension, dateRange }]` with no `granularity`, which the analytics service already accepts. `dateFilter` / `timeRange` are renamed onto `dateRange`, the dashboard's own spellings.
- **`exportOptions: { formats?, includeHeaders?, fileNamePrefix? }`.** Three members of the list export block, under its key name. `formats` is `csv` / `xlsx` only (`json` and `pdf` are refused with a report-side message). Export is on by default (both formats) and `formats: []` turns it off. `maxRecords` and `streaming` are list-only and are refused with that reason. There is no report permission key: the control is gated on the dataset base object's `ObjectPermission.allowExport`, the axis the list toolbar uses. `allowExport` written on a report is answered with that pointer.
- **Refused on a `joined` report**, on the container and on a block. The blocks may bind different datasets, and the report draws one table per block.
- **No subscription.** `subscription` / `schedule` on a report are answered: there is no scheduled delivery of a report.

`@objectstack/lint` adds the dataset-aware half as a reference-integrity rule, `validateReportDateRange`. It runs on `os validate`, `os lint` and `os build`, and at the report publish door. Four `error` verdicts, each with an `os explain` entry: `report-date-range-dimension-unknown`, `report-date-range-dimension-not-date`, `report-date-range-dimension-ambiguous` (dimension omitted, two or more date dimensions) and `report-date-range-dimension-none` (dimension omitted, no date dimension). The liveness author-warning lint now walks `reports`, and both keys warn (`liveness-planned-property`) until the Console report page reads them. The report editor form gains a collapsed "Period & export" section, translated in `@objectstack/platform-objects` for zh-CN, ja-JP and es-ES.

Nothing renders either key yet. The Console report page's period chip and export control are the renderer's half, and until it lands an author declaring either key gets a planned-property warning that says so.
