---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

feat(plugin-list,app-shell): the console's object list keeps the page a reader turned to, in the address

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/plugin-list`**: `ListView` gains two host props, `page` and `onPageChange`. Passing `page` makes the page controlled: the list reads it every render and asks for every move through `onPageChange` (the pager, the reset to page 1 when the object, filters, sort, search, grouping, page size or view change, and the clamp to the last reachable page when a load comes back empty past the end). A move to the page already shown calls nothing. Without `page` the list keeps its page itself, as before, and `onPageChange` only reports the move. Neither is a schema key.
- **`@object-ui/app-shell`**: the console's object page keeps the list's page in the `uf__page` param of the list-state family (`LIST_PAGE_PARAM`, `parseListPageParam`), written with replace, so turning the page adds no history entry. Back from a record opened as a full page (the "Open as full page" arrow, a `page` object, a phone, where every record opens as a page and the card list turns the same page), a reload and a copied link all land on that page. Page 1 is no param, a value that is not a whole number from 1 up opens page 1, and "Reset to view" and the signed-out return link drop it with the rest of the list state. The page alone never makes an address read as a link that carries list state. The page's search-param writes now chain until the location moves, so a query change on page 2 and the reset to page 1 it causes no longer overwrite each other.
