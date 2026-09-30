---
'@objectstack/rest': minor
---

feat(rest): `GET /api/v1/data/:object/export?template=true` answers an xlsx import template for the object (#18386)

Clause-②: yes (widening)

The export door takes one more query parameter, `template`. `template=true`
answers an `.xlsx` workbook with no data rows; `template=false` answers the export.
Without a `template` parameter the export is exactly as before, byte for byte.

- **Columns.** Every field of the object except
  those marked `system` or `readonly`, and `formula`, `summary` and
  `autonumber` fields, in the order the object declares them. A `hidden` field
  that can be written is a column. The seven columns the platform adds to every
  object (`organization_id`, `created_at`, `created_by`, `updated_at`,
  `updated_by`, `owner_id`, `owning_business_unit_id`) are never template
  columns. A field the caller's field-level security does not let them edit is
  left out. If the security service cannot say which fields the caller can edit,
  the columns are narrowed by the fields the caller can read instead. The
  instructions sheet then says so, and the `X-Export-Template-Projection`
  response header reads `readable` instead of `writable` (`none` when no
  field-level security applies). An explicit `?fields=` list is used as sent.
- **First sheet.** The header row, with ` *` after each field that is required
  and has no default value, and one example row to replace or delete. Select,
  radio and boolean columns carry a dropdown.
- **Second sheet.** One row per column: the field's API name, its type, whether
  it is required, and the values the import accepts for it.
- **Language.** The sheets are in Chinese for a `zh` request locale
  (`?locale=` or `Accept-Language`) and in English otherwise.

The same two permission checks as the export apply: an object that does not
expose export answers `405`, and a caller without the export permission answers
`403`. `template` with a value other than `true` or `false`, a `format` other
than `xlsx`, or any of `limit`, `page`, `filter`, `search`, `searchFields`,
`orderby` or `header` beside `template=true`, answers `400 VALIDATION_ERROR`.
