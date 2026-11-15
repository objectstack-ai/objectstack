---
'@objectstack/mcp': patch
---

fix(mcp): `delete_record` / `delete_records` say the recycle bin keeps a business record

Clause-②: no
Metadata-protocol: none

The two MCP delete tools described every delete as permanent. Measured on a booted stack over both transports, a confirmed delete of a business record goes to the recycle bin (`sys_recycle_bin`): it is kept for the deployment's retention (30 days by default) and can be restored through the REST recycle-bin door or the console. Only a platform object's record (`sys_`, `cloud_`, `ai_`), or any record on a host with no recycle bin, is deleted for good. There is no per-object switch.

- The tool descriptions, both confirmation refusals and the served MCP skill text now say this, instead of "permanent".
- `delete_record` over the stdio transport answers `recycleBinEntryId` (the `DeleteDataResponse` key), as the HTTP transport already did. The stdio bridge did not ask the engine for the entry, so its answer named none and read as a permanent delete.
- `delete_records` answers `recycleBinEntries`: one `{ recordId, recycleBinEntryId }` per deleted record the bin kept, on both transports. A deleted record not listed there was deleted permanently. A fault's `progress` carries it too.

Nothing changes in what is deleted, or in the confirmation gate.
