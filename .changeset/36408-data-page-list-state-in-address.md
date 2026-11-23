---
'@object-ui/app-shell': patch
---

fix(console): the bare data page keeps its list's search, sort, grouping and Filter panel when a record is opened and closed, and on a reload

Clause-②: no
Metadata-protocol: none

On the bare data page (`/apps/APP/OBJECT/data`) a search, a sort, a grouping or a Filter panel condition was lost as soon as the reader opened a record and came back, or reloaded the page: the page kept only its own URL conditions in its address. It now keeps the list's own state there too, under the same parameters an object's list uses (`uf__search`, `uf__sort`, `uf__group`, `uf__filter`), written with replace so typing a term adds no history entries. The record page's close, a reload and a copied link open the list as the reader left it.

The page's own URL conditions (`filter[FIELD]`, the removable 「Filtered by」 tags) are unchanged and stay a separate layer: the list applies them and the Filter panel together, and changing one never rewrites the other. "Save as view" still saves only the URL conditions. A Filter panel in the address that names a field the object does not declare, or one the reader cannot read, is refused whole with the same notice an object's list shows. 「Reset」 on a list opened from a record's related list, which already removed every `uf_` parameter from the address, now also opens the list again without them: no search, sort, grouping, Filter panel or quick-filter selection is left applied on screen.
