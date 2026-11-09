---
'@objectstack/spec': minor
---

feat(spec): a blueprint dashboard widget says how it aggregates, and a blueprint calendar view says which date field it schedules on

Clause-②: yes (widening: an optional `aggregate` on the blueprint dashboard widget and an optional `startDateField` on the blueprint view)
Metadata-protocol: added

- **Widget `aggregate`.** `BlueprintDashboardSchema` widgets and the strict mirror `SolutionBlueprintStrictSchema.dashboards[].widgets[]` gain `aggregate: 'sum' | 'avg' | 'min' | 'max' | 'count'` (optional on the lenient side, required-but-nullable on the mirror). Before this, a widget could only name its `measure` and the reader picked the aggregation from the field type, so a widget meant to average a number field summed it. `sum`, `avg`, `min` and `max` aggregate the `measure` field; `count` counts records and needs no `measure` field (a field named beside it is not read). `measure`'s describe no longer says the aggregation is automatic, and neither side tells the model to infer anything from the widget title.
- **View `startDateField`.** `BlueprintViewSchema` and the strict mirror's `views[]` gain `startDateField`, a snake_case field name, carried into the built view as `calendar.startDateField`. It is read on a `calendar` view and ignored on the other view types, not refused: the strict mirror the design model writes through cannot state a cross-key rule, so a refusal on the lenient side alone would refuse at apply a proposal the model was allowed to generate.
- Both keys are optional on the lenient schema, so every existing blueprint parses unchanged. The strict mirror is only the design model's structured-output contract; a model generating against it now states both keys, `null` when it has nothing to say.
