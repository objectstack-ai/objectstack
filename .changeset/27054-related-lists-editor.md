---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(app-shell): Studio orders an object's related lists, and a field group can place a related table

Clause-②: no
Metadata-protocol: none

- **Object settings, `relatedLists`.** The Settings tab lists the object's inbound relationships (each `lookup` / `master_detail` field of a child object that points at it) as an ordered list: drag a row or use the move buttons to reorder, and add a relationship from the picker. An entry is the child object's name, or `object.field` when that child points at the object through more than one field. Relationships no entry names follow, greyed and not draggable, in the default order (owned children first, then lookups). The list orders only: a relationship hidden with `relatedList: false` is listed and marked hidden, and the switch stays on the field. A preview shows the record page's resulting order, split into body tables and side cards. Removing the last entry removes the key.
- **Every write is checked first.** An entry that names no inbound relationship is never written, since `defineStack` and the publish door refuse it. A stored one keeps its row, marked, and the next change to the list leaves it out. Nothing is written until the object list has loaded.
- **Field groups.** The group inspector in the form layout designer has a "Place a related table here" picker that writes the group's `relatedList` from the same relationships. It is withheld while the group still holds fields, and it does not offer a relationship another group already places. In the designer, a group that places a table is drawn in its place as that table and accepts no dropped fields.
- **Shared ordered list.** The highlight fields editor and the related lists editor draw the same draggable, keyboard-movable rows.
