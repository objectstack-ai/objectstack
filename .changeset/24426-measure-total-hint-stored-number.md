---
"@objectstack/spec": patch
"@objectstack/lint": patch
"@objectstack/service-analytics": patch
---

fix(lint, service-analytics): a total over a formula field names the stored-number remedy, not a count

Clause-②: no

- **What changed.** A dataset or cube measure taking `sum`, `avg`, `min` or `max` over a `formula` field is still refused (`measure-aggregate-field-type-refused` in `os validate`, `400 DATASET_INVALID` at the dataset compile). The prescription changed. It used to name `count` / `count_distinct` as the way out, and a count read as a total is a plausible wrong number (3 records shown as "total leave days" where the true total is 10). It now reads: "The field is computed on read and stores no value: store the value as a number field (kept by a hook) and aggregate that. `count` / `count_distinct` answer a different question: how many records."
- **One source.** The sentence lives in `@objectstack/spec/data` as `VIRTUAL_FIELD_AGGREGATE_REMEDY`, returned by `virtualFieldAggregateRemedy(aggregate, fieldType)` for a refused value-reading aggregate over a virtual type (`SEARCH_VIRTUAL_TYPES`, which is `formula`). The function returns `undefined` for every other pair. The lint hint, its `os explain measure-aggregate-field-type-refused` entry and the dataset compile leg all print this one sentence.
- **What stays the same.** Nothing is newly accepted or refused. Every other refused pair keeps its own hint, including `count_distinct` over a JSON-stored or `multiple: true` field. The analytics door's cube-query refusal (`400 INVALID_FIELD`) and the engine's `aggregate` door keep their own wording.
