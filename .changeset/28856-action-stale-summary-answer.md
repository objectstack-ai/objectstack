---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

fix(runtime,mcp): a declarative update action whose write landed under a failing roll-up answers its own success at both action doors (#28856)

Clause-②: no
Metadata-protocol: none
Skills-docs: none — no file under `skills/**` teaches what an action door answers when a parent roll-up cannot be recomputed after the action's write.

When a declarative update action (`operation: 'update'`) writes its record but a parent's roll-up summary cannot be recomputed after it (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"), the action now answers the result it answers when the recompute succeeds, instead of an error that invited the caller to run the action again. No new code, member, status or shape:

- **REST** `POST /actions/:object/:action/:id`: `200` with the declarative result (`{ operation, object, id, record, undo? }`).
- **MCP `run_action`**: the usual `{ ok, action, objectName, recordId, result }`.
- The action's invocation audit row records `succeeded`, the outcome the door answers.

The runtime composes the action's result once and attaches it to the refusal through the existing carrier; each door relays it. The stale summary column is logged at `error` once per field per process. A refusal before the write answers exactly as before. Other action kinds are unchanged: an `api` action's forward already lands on a data door that answers success, a `flow` action's record nodes turn the refusal into a node failure, and a script or body action is a separate follow-up.
