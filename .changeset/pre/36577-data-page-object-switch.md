---
'@object-ui/app-shell': patch
---

fix(console): moving straight from one object's data page to another's opens the new object's list as its address says

Clause-②: no
Metadata-protocol: none

On the bare data page (`/apps/APP/OBJECT/data`), going straight to another object's data page without a reload (a link, the browser's back and forward) kept the page and its list mounted. The new object's list then kept the previous object's search, Filter panel, sort, grouping and quick-filter chips, and ignored the ones its own address carried, while the address showed the new ones. The list now opens afresh for each object, from the new address: its `uf__search`, `uf__filter`, `uf__sort`, `uf__group` and `uf_FIELD` chip selections. An address with none of them opens the new object's list with none. 「Reset」 on a list opened from a record's related list is unchanged.
