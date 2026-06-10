---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
---

`queryDataset` now carries each measure's display `label` and `format` on the
result `fields`, so presentations can show "Tasks" / "$616,000" instead of the
raw measure name "task_count" / "616000".

- `AnalyticsResult.fields[]` gains optional `label?` and `format?`.
- The dataset executor enriches measure columns from the dataset's measure
  definitions (matching `<name>` and `<name>__compare`).

The format can't be baked into the numeric row value (charts need the raw
number), so the renderer applies it at display time.
