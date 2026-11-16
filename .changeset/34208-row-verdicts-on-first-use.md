---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a list asks for its rows' Edit / Delete verdicts when the row actions are first used, not on first paint

Clause-②: no
Metadata-protocol: none

Every list view with rows sent two `POST /api/v1/security/explain` requests right after its data arrived, one for `update` and one for `delete`, to decide whether each row's menu offers Edit and Delete. Each costs the server tens of milliseconds and dozens of queries, and on a hosted page they were the last layer of the page load. The answer only matters to items a row shows inside its menus, so the grid now asks when a row's actions are first reached for: a pointer or the focus on the actions cell, the row's "⋮" opening, or the row context menu opening. That first use asks once for the whole page, one batch per operation. Opening another row's menu asks nothing new. Once asked, the list keeps the verdicts current as before, on a new page or after a data change.

Until the answer lands, every row keeps the object-level verdict, as it did before the answer arrived. A menu opened in that window shows Edit and Delete inert, so neither can be clicked into a write the answer is about to refuse. An item the answer refuses then goes. A failed or missing answer keeps the object-level verdict.

The exported `RowActionMenu` takes two new optional props: `onActionsDemand`, called when the row's actions are reached for, and `crudVerdictPending`, which shows the built-in Edit or Delete inert. A menu that passes neither behaves as before.
