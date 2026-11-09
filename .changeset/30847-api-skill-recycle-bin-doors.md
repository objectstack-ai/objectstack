---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-api` now teaches the recycle bin's doors as they shipped: a by-id
delete answers `recycleBinEntryId`; `POST /api/v1/data/{object}/recycle-bin/:entryId/restore`
restores one entry (`allowRestoreOwnDeleted` for the caller's own deletes,
`manageRecycleBin` for anyone else's); `GET` lists, `DELETE …/:entryId` purges
and `DELETE …/recycle-bin` empties (all `manageRecycleBin`); a refused restore
answers `409` with one of the four `RESTORE_*` codes. `restore` / `purge` are
taught as derived from `delete` instead of "never derive". The api skill's
"undelete invoices" eval grades the new teaching.
