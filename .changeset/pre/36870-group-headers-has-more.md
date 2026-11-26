---
'@object-ui/types': patch
'@object-ui/data-objectstack': patch
'@object-ui/plugin-kanban': patch
---

fix(ui): a grouped read the server cut says so, and a kanban board draws no lane figure over it

Clause-②: yes (widening) — `@object-ui/types` exports the new type `ListViewGroupHeaderAnswer` (the header rows array plus an optional `hasMore`), and `DataSource.queryGroupHeaders` answers it in place of `ListViewGroupHeaderRow[]`; a source that returns a plain array still satisfies the member, and a caller that reads the answer as an array reads it unchanged; nothing removed or renamed
Metadata-protocol: none

On a deployment that sets a default page size (`OS_DATA_DEFAULT_PAGE_SIZE` or `OS_DATA_MAX_PAGE_SIZE`), `POST /data/:object/query` cuts a grouped read with no `limit` to that page size and answers `hasMore: true`. `ObjectStackAdapter.queryGroupHeaders` used to return the header rows alone, so a caller could not tell a cut answer from a whole one. It now sets `hasMore: true` on the answer it returns when the server says groups were dropped; a whole answer carries no `hasMore`.

The kanban lane statistic (`kanban.summary` of type `sum`, `avg`, `min` or `max`) reads that flag: over a cut answer it draws no figure for any lane. Before, the trailing "Uncategorized" lane could total only the groups the answer carried, and on a board of one query a lane whose group was dropped could draw "Sum 0". A whole answer draws every lane's figure as before.

The grouped grid and the currency-code read keep reading the answer as the same array.
