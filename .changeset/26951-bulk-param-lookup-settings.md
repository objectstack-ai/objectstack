---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a promoted bulk action's field-backed lookup param keeps the field's `lookupFilters`, `lookupColumns`, `lookupPageSize` and `descriptionField`

Clause-②: no
Metadata-protocol: none

A view's `bulkActions` can name an object action whose param is backed by a lookup field (`{ field }`). The selection bar's dialog resolved that param through the same resolver as the single-record dialog, but then dropped the field's picker settings. So the selection-toolbar picker offered records the field's `lookupFilters` hides from the row-menu picker, and ignored the field's declared columns, page size and description field. The bulk dialog now hands those four settings to the record picker under the names the single-record dialog uses, so both pickers offer the same records.

What to do: nothing. A lookup field's `lookupFilters` now also narrows the selection-bar picker of any promoted bulk action that takes its param from that field.
