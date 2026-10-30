---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset draft preview refuses a dimension whose field the object does not have, as the live strategies do, instead of grouping every row under one null key

Clause-②: no (narrowing) — a draft-preview dataset query (`queryDataset` with `previewDrafts: true` over a pending seed draft) now refuses a selected dimension that the native and ObjectQL strategies refuse, which it served as one `null` group before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the draft preview now answers an undeclared dimension the way the published dataset already answers it. The refusal is the live faces' existing one, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the draft preview of `queryDataset` (`@objectstack/service-analytics`).

- **Before.** The preview grouped by a dimension the dataset does not declare without asking whether the object has its field. A misspelled `bogus` answered one group, `{ bogus: null }`, carrying the whole total, where both live strategies refuse it `INVALID_FIELD` / 400 ("Dimension 'bogus' on cube … groups by field 'bogus', which object … does not have. Valid dimensions: …").
- **Now.** The preview asks the live strategies' dimension gate before it reads a seed row, so `bogus` is refused `INVALID_FIELD` / 400 with the same message, alone or beside a declared dimension.
- **Gate order.** The preview now asks its gates in the live order: the measure-field gate, the dimension-field gate, the aggregate × field-type door and the record-currency door (`ensureCube`'s order), then the caller-measure column-reference gate, the stored-body, internal-field and field-level read gates (`query()`'s order). So a query with two mistakes is answered about the same one first on every face. Before, the preview asked the column-reference gate (403) ahead of the field-type (400) and currency doors, so `['amount + 1', 'region_sum']` answered 403 on the preview and 400 live.
- **Unchanged.** A declared dimension, and an undeclared one naming a field the object has (`amount`), group as before on every face. The live strategies are unchanged.
- **Who sees it.** A Studio author whose draft widget groups by a dimension name the object has no field for: the typo now shows the refusal it meets once published, instead of a single blank group with the grand total.

**The remedy.** Group by a dimension the dataset declares, or by one of the object's own field names.
