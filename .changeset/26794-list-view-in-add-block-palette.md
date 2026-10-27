---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the page designer's add-block picker offers the list view block

Clause-②: no
Metadata-protocol: none

The page designer could edit a `list-view` block a page already carried (its Object, View and Row limit panel), but its add-block picker had no row for it, so a designer could not add one.

- **Offered under Data**, beside Table, Form, Metric and Kanban, named "List view" (Chinese: 列表视图).
- **A fresh block carries no binding.** Picking it writes `{ type: 'list-view' }` and selects it, which opens the Object, View and Row limit panel. Until the Object control writes `dataSource.object`, the list shows its existing hint asking for an object.
- No key is declared anywhere, and nothing an author already wrote changes.
