---
'@object-ui/plugin-list': patch
---

refactor(plugin-list): `ListView` reads its view blocks through `ListViewSchema` instead of a `(schema as any)` cast

Clause-②: no
Metadata-protocol: none

The kanban, calendar, gallery, timeline, gantt, tree and chart blocks and `bulkActionDefs` are declared members of `ListViewSchema`, so `ListView` now reads them as typed members. The host-composed `rowActionDefs`, which the spec refuses on the list surface, is read through one narrow cast typed as the `object-grid` node declares it. Nothing a list view renders or fetches changes.
