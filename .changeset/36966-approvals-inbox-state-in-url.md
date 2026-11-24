---
'@object-ui/console': patch
'@objectstack/console': patch
---

fix(console): the approvals inbox keeps its tab, filters, search and sort across a request's page and Back

Clause-②: no
Metadata-protocol: none

Opening a request from the approvals inbox and pressing Back used to bring the inbox back on "My Pending" with every filter cleared: the tab, the status, process and object filters, the search text and the sort were held in component state only, and the inbox is rebuilt when the reader comes back. Someone working through "All" filtered to "Recalled" had to pick the tab and rebuild the filters after every request.

They now ride the inbox's address as page-scoped params: `scope` (the tab: `submitted` or `all`), `status`, `process`, `object`, `q` (the search text) and `sort` (`oldest` or `amount`). So Back, a reload and a copied link all reopen the inbox as the reader left it.

- A value at its default is left out, so an untouched inbox keeps a bare address.
- Every change replaces the current history entry instead of adding one, so Back leaves the inbox rather than stepping through filter changes.
- The search text reaches the address after the same short pause the server search already waited for. A search typed and opened at once is written before the request opens, so Back still returns to it.
- A value the inbox does not offer (an unknown tab, sort or status, or a status on "My Pending", which has no status filter) reads as the default. A process or object that none of the loaded requests carries is dropped from the address once the first rows arrive.
- Switching tabs still clears the filters, search and sort, now in the address too. Other params are kept.
- The `?request=` notification link still opens that request.

The tab rides `scope`, not `tab`, because `tab` is the console's reserved record-page tab param. Nothing to migrate.
