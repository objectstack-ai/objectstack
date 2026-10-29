---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(setup): a permission set's field rows no longer offer the platform's bookkeeping columns

Clause-②: no
Metadata-protocol: none

- **Before.** Expanding an object in a permission set listed every field of the merged definition, so the platform's search companion `__search` sorted first and `organization_id` / `owning_business_unit_id` sat among the object's own fields.
- **Now.** A field the platform marks both `system` and `hidden` is not offered, the same rule the Studio Data rail, form designer and pickers already apply. The bulk shortcuts act only on the offered rows.
- **Unchanged.** A field the set already carries an entry for still draws as written, also while the draft clears it. An author's own hidden field and the system `owner_id` still draw. How a save writes is unchanged, and the row-condition editor still knows every field name.
