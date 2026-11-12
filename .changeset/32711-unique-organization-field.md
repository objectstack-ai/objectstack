---
'@objectstack/types': patch
'@objectstack/objectql': patch
---

fix(types): a duplicate value in an organization-scoped unique field now names the field

Clause-②: no
Metadata-protocol: none

A field declared `unique: 'organization'` (or `unique: true`) is enforced by a composite index of the organization column and the field, so the database reports the violation as `UNIQUE constraint failed: t.organization_id, t.invoice_no` (SQLite) or `Key (organization_id, invoice_no)=(…)` (Postgres). `uniqueViolationColumn` treated that as a multi-column key and named no field, so the `409 UNIQUE_VIOLATION` answer carried no `field` and the form could only say "A record with this value already exists".

The organization column is the implied scope of the uniqueness, not a value the user typed, so it is now set aside and the remaining column is named: the engine's `DuplicateRecordError` carries `field` and `fieldLabel`, and the HTTP answer reads "A record with this Invoice Number already exists" with `field: 'invoice_no'`. A key with more than one authored column (`organization_id, department, code`) still names no field, and so does a composite keyed on a tenant column other than `organization_id`.
