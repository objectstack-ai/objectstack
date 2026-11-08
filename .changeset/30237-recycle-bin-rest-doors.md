---
'@objectstack/spec': minor
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(rest): the recycle bin has REST doors: list an object's entries, restore one, purge one, and empty the object's bin; a delete answer names the entry to undo

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: follow-up #30847

The recycle bin (ADR-0148) is now reachable over HTTP, one object at a time, under the data surface:

- **`GET /api/v1/data/:object/recycle-bin`** lists the object's entries, newest first (`limit` 1 to 200, default 50; `offset`). It is the recycle-bin manager's: a caller without `manageRecycleBin` on the object is refused `403`. Each entry's rows carry only the fields the caller may see on their object; a field the caller sees masked is left out.
- **`POST /api/v1/data/:object/recycle-bin/:entryId/restore`** writes one entry back. A member restores the entries they deleted (`allowRestoreOwnDeleted`); another member's entry needs `manageRecycleBin`. The four `409` refusals carry the entry, row and parent they name, so a client can restore a parent entry first.
- **`DELETE /api/v1/data/:object/recycle-bin/:entryId`** purges one entry, and **`DELETE /api/v1/data/:object/recycle-bin`** empties the object's bin. Both need `manageRecycleBin`.

An entry addressed under an object it does not belong to answers `404`. Each door refuses an unknown or repeated query parameter `400`. An object whose API exposure withholds `delete` withholds the four doors too (`405`): the API derivation now derives `restore` and `purge` from `delete`.

`DELETE /api/v1/data/:object/:id` answers `recycleBinEntryId` (optional on `DeleteDataResponseSchema`) when the delete wrote a recycle-bin entry, so a client can offer an undo. The engine's by-id `delete` tells an `onRecycleBinEntry` callback (a type-only member of `EngineDeleteOptions`) the entry it wrote.

The engine gains `ObjectQL.listRecycleBin(object, { context, limit, offset })`, refused unless the caller manages the object's bin (fail closed when no permission resolver answers), and `restore` / `purge` take an optional `object` that an entry must belong to. `@objectstack/client` gains `client.recycleBin.list / restore / purge / empty`, and `DeleteDataResult` gains `recycleBinEntryId`.
