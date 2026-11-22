---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(list): "Add group field" asks which field, and offers only fields that can group

Clause-②: yes (widening) — `@object-ui/components`'s `GroupingEditor` gains the optional props `askFieldOnAdd`, `fieldOptionsLoading` and `fieldLabel`, and its `labels` the optional `noFields`; `@object-ui/i18n` gains the key `list.noGroupableFields` in every locale; nothing removed or renamed
Metadata-protocol: none

On a list, 「添加分组字段」 / "Add group field" used to group at once by the list's first column, usually the record's name, so every record became a group of its own. Now, in the toolbar's Group panel and in the view settings menu's Group level alike:

- It adds no field by itself and does not group. The field dropdown opens, and the list is grouped once a field is picked there. Closing the dropdown without a pick leaves the list as it was.
- The dropdown lists only the fields that can group: single select or radio (a status is one), tick (boolean or toggle), person, and linked record (lookup, master-detail, tree), each single-valued. Text, number, date and multi-select fields are not offered. The list's columns come first in the reader's column order, then the object's other groupable fields the reader may read.
- With no field that can group, the button is drawn disabled and says why: 「没有可以用来分组的字段」 / "No field here can group the list".
- Until the object's field types are read, the button is disabled without a reason. When no definition can be read at all, every column is offered, as before.
- A view already grouped by another kind of field keeps showing that grouping, and its level can still be changed or removed.
- A second level follows the same rule among the fields no level uses yet.
- The grouping is still a part of the list's draft: **Discard** and **Save** appear, and nothing is written.

`@object-ui/components`: with `askFieldOnAdd`, `GroupingEditor`'s "Add group field" opens a row whose field dropdown is already open and writes the level only on a pick. With no `fieldOptions` it draws the button disabled, explained by `labels.noFields`, or without a reason while `fieldOptionsLoading`. `fieldLabel(field)` labels a level whose field `fieldOptions` does not carry. Without these props the editor behaves as before.
