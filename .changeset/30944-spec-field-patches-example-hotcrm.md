---
'@objectstack/spec': patch
---

docs(spec): the `fieldPatches` description's example no longer patches an option of a picklist-bound field

Clause-②: no
Metadata-protocol: none

`ObjectExtensionSchema.fieldPatches`'s description and the `ObjectExtensionSchema` TSDoc taught `industry: { label: 'Sector', options: { technology: { label: 'Tech' } } }`. HotCRM's `crm_account.industry` takes its options from a shared picklist, so the install door and `os validate` refuse that patch (`picklist-option`). The description now says an option of a picklist-bound field is never patchable and only a field declaring its own `options` takes an option patch, and its example sets `industry`'s label and help text and patches `type`'s `customer` option. The generated `references/data/object.mdx` follows. Description text only: no schema, key or behaviour changes.
