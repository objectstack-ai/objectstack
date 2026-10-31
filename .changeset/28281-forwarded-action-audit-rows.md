---
'@objectstack/runtime': patch
'@objectstack/plugin-audit': patch
---

fix(runtime): the two `action_invocation` rows of an `api` action that forwards to another action route name each other

Clause-②: yes (widening)
Metadata-protocol: none

A `type: 'api'` action whose `target` is another action route on the same server answers through two doors, so it writes two `sys_audit_log` rows: the outer door's (`branch: 'api'`, `surface: 'mcp'` for an agent's `run_action`, `rest` for a click) and the inner REST door's for the action it reached. The two could only be joined by their timestamps, and the inner row read like a person's direct REST call. Now each row names the other:

- **The outer row's `metadata.target`** is the action's declared `target`, on the `api` branch only. It is the declaration, not the interpolated path: a path built from the caller's params can carry a param value, and this row records no params.
- **The inner row's `metadata.forwarded_from`** is the forward mark the request arrived carrying (`<object>/<action>` of the outer action), the same `x-objectstack-action-forward` header the inner door already reads for its loop refusal. It is a hint, not a surface: any caller can send the mark, so a forged one mislabels this key and nothing else, and the inner row's `surface: 'rest'` still names the door the request came through. Because the header is caller text bound for the ledger, it is recorded only in the forwarding door's own shape: two snake_case machine names joined by one slash, at most 255 characters. Any other value is left out of the row, and the call is answered exactly as it would be without it.

**Public surface (widening):** `ActionInvocationAuditEvent`, exported by `@objectstack/plugin-audit`, gains two optional members, `target` and `forwardedFrom`. An event that sets neither writes the same row as before. The runtime's matching event type and helpers are internal to `@objectstack/runtime`. Rows written before this change carry neither key.
