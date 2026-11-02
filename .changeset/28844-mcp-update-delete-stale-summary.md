---
'@objectstack/mcp': patch
---

fix(mcp): `update_record` and `delete_record` answer a write that landed under a failing roll-up with their own success (#28844)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches what an MCP write tool answers when a parent roll-up cannot be recomputed after the write.

When a child update or delete is applied but a parent's roll-up summary cannot be recomputed after it (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), the MCP `update_record` and `delete_record` tools now answer the success result they already publish, the way #28782 made `create_record` answer: `{ object, id, record }` for an update and `{ object, id, success: true }` for a delete, instead of an `isError` result that told an agent its write failed and invited it to apply it again. No new code, member or shape.

- **Runtime bridge**: the tools relay the answer the protocol's `updateData` / `deleteData` already attach to the refusal (#28781).
- **stdio bridge**: `update` and `remove` attach their own answer to the refusal, as its `create` does.

The stale summary column is logged at `error` once per field per process, with the fix. A refusal before the write (validation, permission, not found, exposure) answers exactly as before. `run_action` is unchanged.
