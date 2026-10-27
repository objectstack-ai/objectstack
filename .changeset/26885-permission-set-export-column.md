---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the permission-set editor shows the Export column, and Assigned Users no longer covers the grid

Clause-②: no
Metadata-protocol: none

The permission-set editor listed Create, Read, Edit, Delete, Transfer, View All and Modify All, but not Export, so a set that grants `allowExport` looked the same as one that does not. On the Setup page, the Assigned Users panel sat in a strip pinned under the grid, up to 35% of the window tall, so a laptop showed about five object rows and a phone none.

- **Export is a column** (`E`, "Export records"; Chinese: 导出记录) between Delete and Transfer, the order the position summary uses, on the Setup page and in Studio's Access Objects tab. It shows a stored grant and toggles it like Transfer.
- **The bulk buttons leave Export as it is.** Export is an opt-in, high-privilege grant, so R, CRUD and All neither set nor clear it, and the All button's tooltip says so. None still empties the whole row.
- **Assigned Users scrolls with the grid**, after it and the advanced facets, so the grid keeps the page's height at every width. The filter bar wraps on a phone.
- No key is declared anywhere, and nothing a set already stores changes.
