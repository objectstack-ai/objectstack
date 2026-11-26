---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

MCP tools: a refusal an app declares at 403 now names its reasons to the agent.

A refusal with several declared reasons, thrown under the app's own code at `status: 403`, is served as
`PERMISSION_DENIED` with the app's code in `declaredCode`, as every door demotes an unregistered code. The
second text block that names every reason, whole and in order, was withheld for it, because the tools withheld
the block on any `PERMISSION_DENIED`. They now withhold it only on the security gate's own refusal (a
`PERMISSION_DENIED` with no `declaredCode`). Both REST doors already serve the same caller those lines as
`details.refusals`. The gate's refusal is unchanged: no block, and none of its `details`.

The block's lead now reads "Tell the user every line below, whole and in this order, in place of userMessage:".
It used to say the door "may have cut" the `userMessage`, which `run_action` and `resume_run` never cut.
`delete_records` is unchanged: each refused group's `reason` already names every listed line whole, the
closing line last.
