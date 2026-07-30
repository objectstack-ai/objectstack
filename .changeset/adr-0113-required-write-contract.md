---
"@objectstack/spec": major
"@objectstack/objectql": major
"@objectstack/driver-sql": major
---

feat!: ADR-0113 — `required` is a write contract; the column constraint becomes the explicit `storage.notNull`

`field.required` bound three meanings to one knob (write check, `NOT NULL` DDL,
drift expectation), so tightening any invariant on a deployed object was a
destructive migration blocked by the very legacy nulls that motivated it — the
reason `criteria_json`'s mandatory-in-substance contract lived in three
imperative guards instead of one declaration.

Split, with the **non-regression invariant** as the unifying rule — *a write
may not take a record from compliant to violating; a pre-existing violation
does not block writes that leave it in place*:

- `required: true` = the write contract, uniformly on new and deployed objects:
  insert must provide; **an update PATCHing `null` into a required field is now
  rejected** (it silently passed before); omitted fields never block, so legacy
  null rows rest. The column stays nullable.
- `storage: { notNull: true }` = the explicit physical constraint, owning the
  DDL (`sql-driver` `createColumn`) and the destructive drift ceremony.
  Orthogonal to `required` — all four combinations are legitimate, including
  the engine-populated column (`storage.notNull` without `required`).
- `requiredWhen` inherits the same invariant: flipping the condition true
  without providing the field is rejected (the write *creates* the violation);
  a row violating since before the rule tightened no longer locks out
  unrelated edits (#3929's objection, cured). `storage.notNull` ×
  `requiredWhen` rejects at parse (`FieldSchema.superRefine`).
- **Pre-17 sources keep their exact meaning** via the migration-chain-only
  `field-required-notnull-explicit` conversion: `os migrate meta` stamps
  `storage.notNull` onto every previously-required field — writing down what
  the old text already meant. The loader never infers semantics from the
  physical column.
- Drift compares nullability against `storage.notNull`; a column stricter than
  its declaration is `needs_confirm` (never auto-applied — dev auto-reconcile
  no longer silently strips a stray `NOT NULL`), and silent when the field is
  write-gated by `required`.
