---
'@object-ui/core': patch
'@object-ui/fields': patch
'@object-ui/types': patch
'@object-ui/i18n': patch
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
---

feat(fields): a quantity displays with its unit's label and display decimal places in grid, form and detail (ADR-0158 R1 display)

Clause-②: no
Metadata-protocol: none

A `number` field that declares `unitConfig` now draws its unit beside the number on every face: grid and list cells, the record page (sections, highlights, the quick-look panel, related lists), and the form, both read-only and beside the edited box. A `fixed` quantity shows its one unit; a `record` quantity shows the unit its row's code field holds, and the list, grid and related-list reads fetch that field (and the row's organization) even when no column shows it. A `text` field declaring `unitConfig: { unitMode: 'code' }` shows the code's label.

- A standard code (`KGM`, `H87`, …) shows the platform's label in the reader's locale, from a new `units.standard` table in every language pack; an organization code shows its `sys_unit` label.
- Decimal places: a standard code takes its organization's `sys_standard_unit_setting` row, an organization code its `sys_unit.decimal_places`. The row is the record's own organization's, never merely the first one returned. The field's `scale` is the ceiling (ADR-0158 L4), and nothing is rounded at write: footers, exports and the API keep the exact value.
- A retired organization unit, and a unit whose row the reader may not read (an external member holds no `sys_unit` read), show the bare code, never an error.
- One resolver (`resolveQuantityUnit` in `@object-ui/core`) and one formatter (`formatQuantity` in `@object-ui/fields`) serve every face.
