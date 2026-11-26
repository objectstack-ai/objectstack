---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/core': patch
'@object-ui/fields': patch
'@object-ui/types': minor
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/plugin-detail': patch
---

feat(fields): a quantity displays with its unit's label and display decimal places in grid, form and detail (ADR-0158 R1 display)

Clause-②: yes (widening)
Metadata-protocol: added

A `number` field that declares `unitConfig` now draws its unit beside the number on every face: grid and list cells, the record page (sections, highlights, the quick-look panel, related lists), and the form, both read-only and beside the edited box. A `fixed` quantity shows its one unit; a `record` quantity shows the unit its row's code field holds, and the list, grid and related-list reads fetch that field (and the row's organization) even when no column shows it. A `text` field declaring `unitConfig: { unitMode: 'code' }` shows the code's label.

- A standard code (`KGM`, `H87`, …) shows the platform's name for it in the reader's locale; an organization code shows its `sys_unit` label. `@objectstack/spec` now exports the English base name of every standard code, `STANDARD_UNIT_NAMES` and `standardUnitName(code)`, beside `STANDARD_UNITS`. `@objectstack/platform-objects` serves each locale's names through the i18n service, as `messages.standardUnit<CODE>` in every platform bundle, and a reader without a translation falls back to the English base.
- Decimal places: a standard code takes its organization's `sys_standard_unit_setting` row, an organization code its `sys_unit.decimal_places`. The row is the record's own organization's, never merely the first one returned. The field's `scale` is the ceiling (ADR-0158 L4). The number is drawn at that fixed width, rounded half away from zero (ADR-0158 Open item 6, ruled A): `1.5` beside a unit of 0 places reads `2`. Only the display rounds; nothing is rounded at write, and footers, exports and the API keep the exact value.
- A retired organization unit, and a unit whose row the reader may not read (an external member holds no `sys_unit` read), show the bare code, never an error.
- One resolver (`resolveQuantityUnit` in `@object-ui/core`) and one formatter (`formatQuantity` in `@object-ui/fields`) serve every face.
- `@object-ui/types`: `unitConfig` is now an authorable key on `FormField` and `FormFieldSchema` (by reference to the spec's `FieldSchema.unitConfig`, beside `currencyConfig`), so `objectui validate` accepts it on a hand-authored form field. The tolerant face now checks its value against the spec's `UnitConfigSchema`, where before it passed as an unknown key. On the form face the `number` widget reads it, and on a `text` field `unitMode: 'code'` makes the text widget the unit picker.
- A unit code field is chosen, never typed (ADR-0158 Open item 8): a `text` field declaring `unitMode: 'code'`, and the `unitField` a `record` quantity on the same form points at, draw a searchable picker (`UnitCodeField`) of the organization's non-retired units and the standard codes, each by name and restricted to the declared `unitDimension`. It stores the code; read-only, it shows the unit's name. `@object-ui/core` exports the option list (`unitPickerOptions`) and the pointer helpers (`quantityUnitCodePointers`, `withUnitCodePointer`, `declaresUnitCode`).
