---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the row menu offers no Delete on a line whose master is held

Clause-②: no
Metadata-protocol: none

The grid row menu reads the batch approval-lock door (`POST /api/v1/approvals/records/:object/locks`) when a row's actions are reached for, and a row the door answers as locked offers no Edit. The door also says which approval holds the row, in `lockSource`: `'record'` (its own approval) or `'master'` (for a master-detail line, its master's approval). The menu read only the boolean, so a line whose master is held kept Delete, and the server refused that delete with `RECORD_LOCKED`.

The menu now reads `lockSource`. A row answered `lockSource: 'master'` offers neither Edit nor Delete. A row answered `lockSource: 'record'` offers no Edit and keeps Delete, as before: the server deletes such a record and cancels its request. The list page's single-row selection bar reads the same row props, so it follows. A 501, a `null` entry, a failed read or a read not yet asked leaves the menu as it was.

A grid whose rows offer Delete but no Edit now also reads the locks when a row's actions are reached for, so the rule holds there too. The read is still never sent on first paint.
