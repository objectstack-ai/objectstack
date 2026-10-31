---
'@objectstack/service-analytics': patch
---

fix(service-analytics)!: the dataset draft preview mints and judges a measure the dataset does not declare as the live strategies do, so a misspelled measure is refused `INVALID_FIELD` instead of answered as a row count

Clause-②: no (narrowing) — a draft-preview dataset query (`queryDataset` with `previewDrafts: true` over a pending seed draft) now refuses a selected measure that the native and ObjectQL strategies refuse, which it served before. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the draft preview now answers an undeclared measure the way the published dataset already answers it. The refusals are the live faces' existing ones, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the draft preview of `queryDataset` (`@objectstack/service-analytics`).

- **Before.** The preview read every measure the dataset does not declare as `count(*)`. A misspelled `nope` or `ghost_avg` answered a row count per group under the typo, where both live strategies refuse it `INVALID_FIELD` / 400 ("Measure 'nope' on cube … aggregates field 'nope', which object … does not have. Valid measures: …"). A working spelling read the wrong number too: `amount_sum`, or a bare `amount`, answered the row count where the live strategies answer `SUM(amount)`.
- **Now.** The preview mints an undeclared measure with the live strategies' own mint (the `<cube>.` qualifier rule, then the `_sum` / `_avg` / `_min` / `_max` / `_count_distinct` suffix convention, a bare field name meaning its sum) and asks the same gates before it reads a seed row: a field the object does not have is refused `INVALID_FIELD` / 400 with the same message; an aggregate the field-type table refuses (`region_sum` over a text field) is refused `INVALID_FIELD` / 400; a spelling that is not a column reference (`amount + 1`) is refused `PERMISSION_DENIED` / 403; and the field-level read gate judges a minted measure by the field it aggregates.
- **Answers that change value.** On the preview, the answer for an inferred measure over a real field (`amount_sum`, `amount`, `amount_avg`, …) changes from a row count to the live value, the number the published dataset serves.
- **Unchanged.** A declared measure, a duration measure, a derived measure and the undeclared `count` serve what they served. The live strategies are unchanged.
- **Who sees it.** A Studio author whose draft widget names a measure the dataset does not declare: a typo now shows the refusal it meets once published, instead of a plausible count.

**The remedy.** Name a measure the dataset declares, or spell an inferred one over a field the object has (`<field>_sum`, `<field>_avg`, …).
