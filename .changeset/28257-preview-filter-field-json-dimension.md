---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset draft preview refuses a runtimeFilter on a field the object does not have, and a dimension over a JSON column, as the live strategies do, instead of serving an empty or object-keyed answer

Clause-②: no (narrowing) — a draft-preview dataset query (`queryDataset` with `previewDrafts: true` over a pending seed draft) now refuses a `runtimeFilter` member whose field the object does not have, and a grouped dimension over a `json` column, both of which the native and ObjectQL strategies refuse and the preview served before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the draft preview now answers an unknown filter field and a JSON dimension the way the published dataset already answers them. Both refusals are the live faces' existing ones, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the draft preview of `queryDataset` (`@objectstack/service-analytics`).

- **Before.** The preview evaluated a `runtimeFilter` over the seed rows without asking whether the object has each filtered field. A misspelled `{ bogus: 'x' }` matched no row and served `[]`; under an `$or`, `{ $or: [{ bogus: 1 }, { region: 'amer' }] }` served the other arm's rows. Both live strategies refuse it `INVALID_FIELD` / 400 with `param: 'where'` ("Filter member 'bogus' in 'where' on cube … constrains field 'bogus', which object … does not have …"). The preview also grouped by a dimension over a `json` column, one group per object value, where live refuses it `INVALID_FIELD` / 400 with `param: 'dimensions'` (#20807).
- **Now.** The preview asks both live gates before it reads a seed row, so each mistake is refused with the same envelope and message on all three faces: the filter in every spelling (object, `$or` arm, array triple), the JSON dimension whether the dataset declares it or not.
- **Gate order.** Both gates sit where `ensureCube` asks them: the structured-JSON door after the dimension-field gate and before the aggregate × field-type door, the `where` gate last among `ensureCube`'s gates (after the record-currency door) and before `query()`'s caller-measure column-reference gate. So a query with two mistakes is answered about the same one first on every face: a JSON dimension beside an unknown filter field answers the dimension; `amount + 1` beside an unknown filter field answers the filter (400), where the preview answered the column-reference gate (403).
- **Unchanged.** A filter on a declared dimension, on an undeclared field the object has (`amount: { $gt: 40 }`) and an `$in` filter serve the same rows as before on every face. The live strategies are unchanged.
- **Who sees it.** A Studio author whose draft widget filters on a field name the object does not have, or groups by a JSON field: the mistake now shows the refusal it meets once published, instead of an empty chart or one bar per object value.

**The remedy.** Filter on one of the object's own fields, spelled as the object declares it; group by a scalar field, not a `json` one.
