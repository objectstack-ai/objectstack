---
'@objectstack/service-analytics': patch
---

Analytics: a draft-preview dataset response now describes its columns like the live one

`AnalyticsService.queryDataset`'s ADR-0037 P3 draft-preview branch returned before the
ADR-0021 result-column enrichment ever ran, so a dataset queried while the base object had a
pending seed draft came back with none of its column metadata: `fields[].label`, `format`,
`currency`, `percentScale`, `builtinAggregate`, and the temporal `type` correction were all
absent, on measure and dimension columns alike. A renderer then fell back to humanizing the
raw measure name and guessing a percent scale from magnitude — so the same dataset in the
same widget described its columns differently depending only on whether a pending seed draft
existed, which is the surface an author is looking at while authoring the dataset.

Every one of those keys is read off the authored dataset and the source object's field
metadata, never off the rows, so the enrichment is now one method both paths call. Dimension
VALUE label resolution (resolving a lookup id to a display name) stays skipped on the preview
path deliberately: drafted seed rows reference lookups by name, so there is no id to resolve.
