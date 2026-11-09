---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
---

fix: on a zh-CN console every row of the view properties panel's collapsed sections (表格选项 / 分页 / 终端用户控制 / 导航与共享) reads in Chinese

Clause-②: no
Metadata-protocol: none

- `viewForm` (`@objectstack/spec/ui`) now spells out the children of its `selection`, `pagination`, `userFilters`, `appearance`, `userActions`, `navigation` and `sharing` composites, and gives the rows that had none a hint. Each declared hint is the schema description the panel already showed, so an English console reads the same text; `os i18n extract` now emits a `metadataForms.view.fields['<parent>.<child>']` key per row.
- `userFilters.fields` is enumerated as an inline-table repeater, and `UserFilterFieldSchema`'s six properties carry a `.meta({ title })` (Field / Label / Type / Options / Show Count / Default Values) — the English column heads, unchanged.
- The panel no longer offers `navigation.view` and `sharing.type`: both are `retiredKey()` tombstones that the schema-derived child list used to render as editable rows. A stored value is untouched by a panel save (the composite editor spreads the block it was given).
- The platform metadata-forms catalogs carry zh-CN, ja-JP and es-ES text for every new row, and the console's zh-CN overlay copies the zh-CN rows.
