---
"@objectstack/trigger-record-change": patch
"@objectstack/service-automation": patch
---

fix(automation): record-change flows see multi-lookup fields + support array-index interpolation (#1872)

A `multiple: true` lookup is an array column the data driver may not echo back
on create, so it was absent from the after-create record a record-change flow
saw — `record.target_channels != null` was false and `{rec.target_channels.0}`
resolved empty. Two fixes:

- **trigger-record-change**: `buildContext` now reads the lifecycle hook's
  `input.data` (the actual key objectql uses for insert/update; it had been
  reading a non-existent `input.doc`) and overlays the after-row on it, so fields
  the driver didn't return stay visible to the flow's condition + interpolation.
- **service-automation**: `{var.path.N}` numeric segments now index into arrays,
  so a multi-value lookup can be referenced positionally (`{record.channels.0}`).
