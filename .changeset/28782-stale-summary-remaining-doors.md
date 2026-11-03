---
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(metadata-protocol,rest,runtime,mcp): the remaining write doors answer a write that landed under a failing roll-up with their own success (#28782)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches what a write door answers when a parent roll-up cannot be recomputed after the write.

When a child write is stored but a parent's roll-up summary cannot be recomputed after it (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), #28781 made the REST and dispatcher single-record doors answer the write's own success. The other write doors now do the same, each with the success answer it already publishes — no new code, member, status or header:

- **Public form submit** (`POST /forms/:slug/submit`): `201 { id, fields? }` instead of `500`.
- **`createMany`** and **clone**: `201` with their usual body instead of `500`. `createManyData` and `cloneData` attach the answer to the refusal the way `createData` does, so a caller that does not read it still gets the refusal.
- **Per-object `batch`, `updateMany`, `deleteMany`** (non-atomic): a stored row is a `success` row built from the refusal's `written`, and the loop goes on to the next row. Before, the row came back `success: false` with the refusal and every later row was not attempted, so a client retrying the failed rows duplicated the stored one. An **atomic** batch is unchanged: the refusal is raised inside its transaction, the batch rolls back, and nothing landed.
- **`callData`'s ObjectQL fallback** (a host with no `protocol` service): its create, update and delete arms attach their answer to the refusal, so the dispatcher's `/data` door answers it.
- **MCP `create_record`**: answers the create on both bridges. The runtime bridge relays the protocol's attached answer, and the stdio bridge builds its own.

The stale summary column is logged at `error` once per field per process, with the fix, as on the single-record doors. A refusal before the write (validation, permission, constraint) answers exactly as before. The import runner and seed loader are untouched.
