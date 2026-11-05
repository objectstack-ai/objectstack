---
'@object-ui/plugin-list': patch
'@object-ui/plugin-grid': patch
---

fix(plugin-list): a stored view sort the platform refuses is no longer sent, so the list loads instead of failing; a column on a `sortable: false` field offers no sort when the grid sorts in the browser

Clause-②: no
Metadata-protocol: none

**Visible behaviour change on a released page.** A list view whose stored `sort` (or a restored user sort) names a field the platform will not order by used to send that sort with its data request. The Data API answers such a sort `400 INVALID_SORT`, so the list showed its load error instead of its rows. Fields the platform refuses are the ones its sortability projection, served with the object's metadata, marks unsortable: a `formula` field today, and a field marked `sortable: false` once the platform honours that flag.

- **`@object-ui/plugin-list`:** the list's data request, its server export and the kanban, calendar, timeline and gantt views (which fetch their own rows) now send the sort without the refused entries. The entries left keep their original order, and a sort with nothing refused in it is sent unchanged. The refused entry is still listed in the sort picker as removable only, as before, and the next sort the list saves leaves it out. With no projection served (an older platform, inline rows), the sort is sent as before.
- **`@object-ui/plugin-grid`:** a column listed in a view's `columns` now reads its field's `sortable: false`, as columns derived from the object's fields already did. Where the grid sorts the rows it holds (inline rows), such a column no longer offers a sort click. A `formula` column keeps its sort click there, since the browser orders by the value the cell shows; where the sort is sent to the server, the platform's projection still decides, as before.
