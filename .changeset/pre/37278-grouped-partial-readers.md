---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/types': patch
---

fix(ui): the grouped grid and the used-currency read treat a cut grouped answer as partial

Clause-②: no
Metadata-protocol: none

On a deployment that sets a default page size (`OS_DATA_DEFAULT_PAGE_SIZE`, or `OS_DATA_MAX_PAGE_SIZE` alone), `POST /data/:object/query` cuts a grouped read that names no `limit` to that page size and answers `hasMore: true`; `queryGroupHeaders` hands it on as the answer's `hasMore`. Two readers read such an answer as every group:

- A grid grouped on the server listed only the groups the answer carried, with nothing saying more exist, and told the bulk bar a record total summed over those groups. It now draws one line above the rows, "More groups were not loaded: this view has more groups than the server returns in one read, so only some are listed." (translated in every locale pack, key `grid.grouping.moreGroupsNotLoaded`; not the `grid.grouping.partial*` page-slice marker retired by objectui#10881 ruling F: those counts were slices of a fetched page, these are the server's exact counts over a cut group list), and tells no total. The groups it lists keep their exact counts. A whole answer draws as before.
- The form's used-currency read (the "available" group of a record-currency code field) took the codes of a cut answer as every code in use, so a code in use could sit under "all". A cut answer now hands down no used codes, as a failed read does: the field offers home + rated + the record's own code under "available", and every code under "all". A whole answer hands every used code down as before.

Neither reader can ask for the rest: the header query carries no `limit`, and the grouped read takes no `offset`.

`ListViewGroupHeaderAnswer`'s doc now warns that `hasMore` lives on the array, so a copy of the answer drops it.
