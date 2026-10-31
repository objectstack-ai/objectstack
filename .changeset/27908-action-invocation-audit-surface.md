---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/plugin-audit': minor
---

feat(spec,runtime,plugin-audit): an action run through MCP leaves an audit row naming its surface

Clause-②: yes (widening)
Metadata-protocol: added

The audit trail could not tell an action an agent ran over MCP from one a person clicked. Neither action door wrote a row for the invocation itself: the script branch printed a `[action-audit]` log line, the api, flow and declarative-update branches printed nothing, and the `sys_audit_log` rows for the action's own data writes do not say which door started it.

- **`ExecutionContext.surface`** (`@objectstack/spec`): `'rest' | 'mcp'`, optional. The door an action invocation came through. Set only by the two action doors, from the door's own identity, on the envelope of the invocation they record; never client-supplied, never read by authorization. `@objectstack/core` declares it a non-entry field (identity resolution does not produce it).
- **One `action_invocation` row per invocation** (`@objectstack/plugin-audit`): the `audit` service slot gains `recordActionInvocation`, and `sys_audit_log.action` gains the value `action_invocation`. The row carries the caller (`user_id`, `actor`, `tenant_id`), the action's object and subject record, and in `metadata` the `surface`, `action_name`, `branch` (`script` / `api` / `flow` / `update`), `outcome`, the status and error code of a refusal, the `run_id` of a `resume_run`, and `performed_by` / `on_behalf_of` when an agent performed the call. No new column.
- **Both doors write it on every branch** (`@objectstack/runtime`): REST `POST /actions/:object/:action` (`surface: 'rest'`) and the `/mcp` bridge's `run_action` / `resume_run` (`surface: 'mcp'`), for every call that cleared the door's admission gates, whether the branch then answered or refused. A call refused by an admission gate (not found, `ai.exposed`, the `requiredPermissions` gate, the activation switch, the param contract, the confirmation gate) ran nothing and writes no row. The `api` branch's row is written by the door after the forward answers, so it names the true door although the target re-authenticates the caller.

Nothing about which actions a door may run changes. The existing `[action-audit]` log line stays. To read the rows: filter `sys_audit_log` on `action = 'action_invocation'` and read `metadata.surface`.
