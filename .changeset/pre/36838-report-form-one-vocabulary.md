---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

The report authoring form now names its top-level data rows with the same words as its joined-blocks grid: Data Source, Metrics, Group By and Group Columns By, where they read Dataset, Values, Rows and Columns. One form no longer calls the same setting by two names. The Metrics hint no longer says a metric is only a total or a count; it can be any measure of the data source, such as an average or a ratio. The File Name hint now says what the download does: the prefix takes the place of the report's label, and an empty prefix names the file after the label, or after the report's name when it has no label.

Only prose moved. No key, accepted value, default or section title changed. The platform metadata-form bundles are regenerated, the File Name hint is re-translated in zh-CN, ja-JP and es-ES, and the console's zh-CN overlay now follows the current English for the Date Range and Runtime Filter hints.
