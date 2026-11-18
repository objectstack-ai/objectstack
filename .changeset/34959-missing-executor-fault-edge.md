---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow node whose type no installed plugin provides now follows its `fault` edge

Clause-②: no
Metadata-protocol: none

A flow can name a node type that no installed plugin provides, for example an `approval` node on a deployment without `@objectstack/plugin-approvals`. Running that node fails with `NO_EXECUTOR` ("No executor registered for node type 'approval'"). Until now that failure skipped the node's `fault` edge: the run just failed, nobody was told, and the record that started it stayed where it was. An author could not declare a graceful path for it.

That failure is now handled like any other node failure:

- When the node declares a `fault` edge, the run follows it. The handler reads `{$error.code}` as `NO_EXECUTOR`, with the same message, and `{<nodeId>.error}` holds the message. The run log keeps the node's failed step with code `NO_EXECUTOR`, followed by the handler's steps.
- Inside a `try_catch` region, the catch region's bound error now carries `code: 'NO_EXECUTOR'`.
- With no `fault` edge, nothing changes: the same failed step, the same error text, and the run fails.

The boot warning that names flows referencing node types no installed plugin provides is unchanged. Installing the plugin is still the fix; the `fault` edge is the author's fallback until then.
