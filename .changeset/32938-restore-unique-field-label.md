---
'@objectstack/objectql': patch
'@objectstack/rest': patch
---

fix(objectql, rest): a restore refused `RESTORE_UNIQUE_VALUE_TAKEN` by the store names an organization-scoped unique field, and the refusal names the field by its label

Clause-②: yes (widening) — one additive key on an existing refusal: `RESTORE_UNIQUE_VALUE_TAKEN` gains `fieldLabel`, forwarded by the restore door in `details`; `field` is now present on the store's violation for an organization-scoped unique field, where it was absent.
Metadata-protocol: none

A restore that the store's own unique constraint refuses at the write used to ask which COLUMN the violation names. A field declared `unique: 'organization'` (or `unique: true`) is keyed `(organization_id, FIELD)`, which names no single column, so the refusal named no field and read "another record now holds a value it must keep unique (a unique value)". It now asks which FIELD the refusal is about, the question the engine's unique envelope already asks: the implied `organization_id` key part is set aside, so the refusal carries `field` (the API name). An index name, or a key of more than one authored column, still names no field: a wrong field is worse than none.

The refusal also carries `fieldLabel`, the field's display name in the restorer's locale (a translation, else its declared `label`), resolved exactly as the engine's unique envelope resolves it, and only when the field has one. The user-facing `message` names the field by that label; `developerMessage` keeps the API name. This holds for the probe before the write as well as for the store's violation at it. `POST /api/v1/data/{object}/recycle-bin/{entryId}/restore` forwards `fieldLabel` in the refusal's `details`, beside `field`.
