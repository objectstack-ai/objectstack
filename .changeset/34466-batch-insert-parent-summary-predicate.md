---
'@objectstack/objectql': patch
---

fix(objectql)!: a multi-row insert counts its earlier rows into the parent summary a field-level `parent.` predicate reads, as one-by-one inserts do

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is the summary value a field-level parent. predicate reads during one multi-row insert: no stored row, registry key or authored value changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a multi-row insert under one master-detail header whose detail object declares a field-level `requiredWhen` that reads a roll-up `summary` of the header (`parent.line_count >= 2`). A bulk create already equals one-by-one creates for a validation rule that reads a parent summary through a reference; this extends that to the header a `requiredWhen` reads as `parent`.

- FROM: `insert(object, rows[])`, `insertMany`, the generic batch create and the import's batched creates read the header once for the batch, so every row judged the summary as it stood before the batch: three bare lines under a header with no lines, against `requiredWhen: 'parent.line_count >= 2'` on `description`, were all admitted.
- TO: each row judges the summary as the batch's earlier admitted rows move it (`count`, and `sum` / `min` / `max` over numbers, the same set the reference arm accumulates): the third line is refused with `VALIDATION_FAILED` (`description`, `required`), as the third of three single inserts is. `insert(array)` refuses the whole batch; `insertMany` reports that row `ok: false` and writes the first two. The multi-row insert preview (`validate` with `mode: 'insert'`, the import's dry run) answers the same.

**Not moved.** A `parent.` predicate that reads a header field that is no summary (`parent.status == 'sent'`), a single-row insert, an update, an unbound header, and an `avg` summary (it keeps reading the stored value) answer as before.

The fix for a caller: supply the field on every row the requirement now names.
