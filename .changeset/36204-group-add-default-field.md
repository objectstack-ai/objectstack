---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
---

feat(list): "Add group field" groups by the view's first single select, and asks when there is none

Clause-②: yes (widening) — `@object-ui/components`'s `GroupingEditor` gains the optional prop `pickAddField`; `@object-ui/plugin-list`'s `ViewSettingsField` gains the optional members `type` and `multiple`, `groupFieldOptions` an optional second argument (the column order), and the module exports `pickGroupAddField`; nothing removed or renamed
Metadata-protocol: none

On a list, 「添加分组字段」 / "Add group field" used to group at once by the list's first column, usually the record's name, so every record became a group of its own. Now, in the toolbar's Group panel and in the view settings menu's Group level alike:

- It groups at once by the first single select or radio field (a status is one) in the reader's column order, a shown column before a hidden one. A select that holds many values is not picked.
- A view with no such field is not grouped yet: the field dropdown opens, and the list is grouped once a field is picked there. Closing the dropdown without a pick changes nothing.
- The field dropdown lists the fields that suit grouping first (single select, radio, person, linked record, tick, date, each single-valued), then the rest, such as a name or a number, which can still be picked. Each part keeps the column order.
- A second level follows the same rule among the fields no level uses yet.
- The grouping is still a part of the list's draft: **Discard** and **Save** appear, and nothing is written.

`@object-ui/components`: `GroupingEditor`'s `pickAddField(remaining)` chooses the field "Add group field" adds from the fields no level uses, in `fieldOptions` order; `undefined` opens a row with an open field dropdown and writes the level only on a pick. Without the prop the first remaining field is added at once, as before.
