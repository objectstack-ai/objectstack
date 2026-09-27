---
'@objectstack/spec': patch
---

The shipped ADR-0087 semantic entry `filter-preset-ordering-comparand-refused` drops, from its `surface` and its `reason`, the text that said a page's `interfaceConfig.filterBy` and a lookup field's `lookupFilters` are refused by neither door at publish, and drops, from its `acceptanceCriteria`, the by-hand search it prescribed for those two keys. The `@objectstack/lint` `filter-preset-comparand` rule now walks both keys, so `os lint`, `os validate` and the runtime publish gate (on `page` and `object` writes) refuse `{ field: 'close_date', operator: 'gt', value: 'last_30_days' }` in either one, while the schema parse still accepts it.

Clause-②: no
