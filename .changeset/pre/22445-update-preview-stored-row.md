---
'@objectstack/objectql': minor
'@objectstack/core': minor
'@objectstack/spec': minor
---

An `update`-mode `validate()` preview judges the stored row merged with the patch, as the by-id update does, so an import dry run of a matched row admits the rows the import's update admits (#22445)

Clause-②: yes

The preview's accept set widens: rows it refused, and the write admits, are now admitted. No key, export or error code is added, removed or renamed.

- **Before.** An `update`-mode preview (`engine.validate(object, rows, { mode: 'update' })`, `validateData`, and the import dry run of a row that matched a stored record) read no stored row, so the record its rules judged held only the patch. A `requiredWhen`, an option `visibleWhen` or a `validations[]` rule that reads a column the patch omits faulted there, and the preview refused the row with `rule_violation` / `unevaluable`, although the real update reads the stored row first and admits it. The refusal also said the omitted column was one "which this object does not declare", sending the author looking for a field that exists.
- **Now.** A row that carries its `id` (the address every update door already folds into the payload) is judged against the row that id names: the stored row is the rules' `previous`, and their record is the stored row merged with the patch, exactly as the by-id update judges it. A reference field a traversing rule reads is resolved from that merge too. The import dry run of a matched row sends the matched record's id this way, so nothing new crosses the protocol.
- **Read under the caller's access.** The engine's read door, under the caller's own context, decides whether there is a row to judge: a row the caller cannot read gets the verdict a missing row gets. The values judged are the row as stored, read the way the by-id update reads its prior row (so a formula column, which has no stored value, is judged as the update judges it). A stored column is judged only where the read door served this caller that very value. A column the read door hid, or served transformed (a partially masked field, a masked secret), is judged as empty, so the verdict never depends on a value the caller could not read in full. File fields are compared in their stored form, so a readable file reference is judged as the id it holds. Measured on `driver-sql` (SQLite) and `driver-memory`, a plain readable column (number, currency, percent, boolean, date, datetime, JSON, multiselect, select, text) reaches the rules as its stored value.
- **Unchanged.** A row with no `id`, or whose id names no row the caller can read, is judged on the patch alone, as before. `required` and value checks still look only at the supplied keys, matching a PATCH. A merge that really violates a rule is refused, as the write refuses it. The preview still runs no `readonlyWhen` or primary-key strip, so it can report fewer dropped fields than the update.
- **The refusal names the real cause.** Where a rule reads a column the object declares and the judged record does not hold it (a preview with no stored row), the refusal now says the value was not supplied and no stored row was read, instead of saying the object does not declare the column. A column the object really does not declare keeps the old sentence.

`@objectstack/core`: the import runner's dry run passes the matched record's id with an update row. `@objectstack/spec`: the `ValidateDataRequest.mode` description and the `ValidateDataResponse` note say what an `update` preview now reads.

The pending entry for the option-gate change in this release says an `update`-mode preview reads no stored row and refuses a cascade pick whose parent column the patch omits. That describes the preview before this change: with the row's `id`, the preview now reads the stored row and judges the pick as the write does.
