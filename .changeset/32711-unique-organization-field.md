---
'@objectstack/types': patch
'@objectstack/objectql': patch
'@objectstack/verify': patch
---

fix(types): a duplicate value in an organization-scoped unique field now names the field

Clause-②: yes (widening) — `@objectstack/types` newly exports `uniqueViolationField`, and a `409 UNIQUE_VIOLATION` for a duplicate in an organization-scoped unique field now carries `field` (and the engine envelope `fieldLabel`) where it carried none; nothing existing is removed, retyped or refused, and `uniqueViolationColumn` answers exactly as before.
Metadata-protocol: none

A field declared `unique: 'organization'` (or `unique: true`) is enforced by a composite index of the organization column and the field, so the database reports the violation as `UNIQUE constraint failed: t.organization_id, t.invoice_no` (SQLite) or `Key (organization_id, invoice_no)=(…)` (Postgres). The refusal treated that as a multi-column key and named no field, so the `409 UNIQUE_VIOLATION` answer carried no `field` and the form could only say "A record with this value already exists".

The organization column is the implied scope of the uniqueness, not a value the user typed. The new `uniqueViolationField` sets it aside and names the remaining column, and the engine's `DuplicateRecordError` and the HTTP data doors read it: the engine envelope carries `field` and `fieldLabel`, and the HTTP answer reads "A record with this Invoice Number already exists" with `field: 'invoice_no'`. A key with more than one authored column (`organization_id, department, code`) still names no field, and so does a composite keyed on a tenant column other than `organization_id`.

`uniqueViolationColumn` is unchanged and still answers `undefined` for that composite: the autonumber retry reads a named column as "every reservation on this field collided", and in a batch spanning several organizations only the per-row data probe can tell which organization's counter collided.
