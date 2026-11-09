---
'@object-ui/plugin-list': patch
---

fix(plugin-list): the list's sort picker no longer offers a field the object marks hidden, such as the queue column or the search index

Clause-②: no
Metadata-protocol: none

**Visible behaviour change on a released page.** A list's 排序 / Sort picker offered every field of the object, including the injected system columns the platform marks `hidden: true` (the queue column, the `__search` companion shown as an untranslated "Search Index", `organization_id`). The Filter panel's field list already left those out; the sort picker now follows the same rule.

- A field the object definition marks `hidden: true` is no longer listed in the sort picker, and "Add sort" never starts on one.
- A view or saved sort that already orders by such a field keeps working: the field stays listed in that row as removable only (disabled), as the picker already does for an unreadable or refused field, so the row is not blank and can be removed.
- A hidden lookup (such as `organization_id`) no longer raises the "relational fields cannot be sorted" hint under the rows, since the picker never offered it.
