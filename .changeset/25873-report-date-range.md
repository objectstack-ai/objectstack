---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(plugin-report): a report that declares `dateRange` draws a period chip and runs every query inside the chosen window

Clause-②: no
Metadata-protocol: none

`ReportSchema.dateRange` (`{ dimension?, defaultRange, allowCustomRange }`) was accepted but read by nothing, so a report showed every period whatever it declared. The report page now reads it:

- **The chip.** A non-joined report that declares `dateRange` draws a date-range chip above its body: All time, the dashboard's presets under the dashboard's labels, and Custom… (two date inputs) unless `allowCustomRange: false`. It opens on `defaultRange`, or `this_month` when that is absent; `custom` opens the custom pick with no window until both ends are named.
- **The window.** The active window rides every dataset query the report makes (the grouped table, the matrix cross-tab and the embedded chart) as one `selection.timeDimensions` entry `{ dimension, dateRange }` with no `granularity`: a preset goes by name, a custom pick as `[start, end]`, and All time sends no entry. The server ANDs it with `runtimeFilter` and the dataset's own filter. A new pick re-queries.
- **The dimension.** A declared `dimension` is sent as written. Omitted, the renderer reads the dataset definition before any query and uses its one `type: 'date'` dimension; a dataset with none or several draws that authoring error in place of the report and queries nothing.
- **Unchanged without it.** A report that does not declare `dateRange` draws no chip, reads no dataset definition and posts exactly the selection it posted before. A `joined` report (where the spec refuses `dateRange`) is not affected.

`@object-ui/i18n` gains `report.dateRange.from`, `report.dateRange.to`, `report.dateRange.datasetUnreadable` and `report.dateRange.noSingleDateDimension` in all ten locale packs; the preset labels reuse `dashboard.filters.*`.
