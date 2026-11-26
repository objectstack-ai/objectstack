---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

The report authoring form now reads in business terms: data source, grouping, metric. It no longer uses the schema's own vocabulary (dataset, dimension, measure, "render-time", "ANDed"), and its English matches what the Chinese report panel says. Every section description and field hint the report panel draws was reworded. The `dateRange` and `exportOptions` composites now declare their children as form rows (Date Field, Default Period, Allow Custom Range; Formats, Include Headers, File Name), each with its own hint, so the panel no longer shows the schema descriptions for them. The Description row gained its own hint. The joined-block and sort row titles now read Data Source, Group By, Group Columns By, Metrics, Sort Order and Sort By, in the form and in the item schema `title` together.

Only prose and form layout moved. No key, accepted value or section title changed, and nothing an author can write or validate is different. The platform metadata-form bundles are regenerated, with zh-CN, ja-JP and es-ES translations for the 13 new rows, and the console's zh-CN overlay carries the new rows too.
