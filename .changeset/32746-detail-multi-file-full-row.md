---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a multi-file field takes the full row of the record detail grid

Clause-②: no
Metadata-protocol: none

A `file` or `image` field whose object field declares `multiple: true` now spans the whole row of a multi-column detail section, so each file name reads in full instead of being cut short in half a row. A single `file` or `image` field keeps one cell, the long-form types that were wide before stay wide, and an authored `span` on the detail field still wins. The entry form is unchanged: there the author widens the field with `span: 'full'`. `isWideFieldType` still answers on the type alone, so the detail and the form agree on every field type.
