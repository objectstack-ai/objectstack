---
'@objectstack/runtime': patch
---

fix(runtime): the action door and the declared flow endpoint refuse a self-triggered flow declared to run as system to any caller but the system principal

Clause-②: no

The trigger door already refused this start, but two other doors that start a flow by name did not ask: an action of `type: 'flow'` (`POST /api/v1/actions/:object/:action`, and the MCP `run_action` tool, which reaches the same dispatch) and a declared endpoint of `type: 'flow'`. Any signed-in member who was refused at the trigger door could start the same elevated flow through either one, and its elevated write landed.

**What changes.** All three doors now apply one rule from one place. A caller that is not the system principal gets `403 PERMISSION_DENIED` (ADR-0112 envelope) when it starts a flow declared `runAs: 'system'` whose `type` is `autolaunched`, `record_change` or `schedule`. Nothing runs: no run record, no node, no side effect. This includes a platform admin's session and the guest principal an `authRequired: false` endpoint admits. The refusal names no part of the flow, and its message is now the same at every door: it no longer names the trigger door.

**What stays as it was.**

- `screen` and `api` flows, elevated or not: entries the author designed (ADR-0073 D2).
- Every flow that does not declare `runAs: 'system'`.
- A parent flow's `subflow` node calling an elevated flow: the child starts through the engine, never through a door.
- The system principal (an in-process caller, such as a job), which starts every flow.
- The action's own `requiredPermissions` gate (ADR-0066 D4) still answers first. Holding that capability does not open a self-triggered elevated target.
- A declared endpoint's policy chain: an anonymous caller at an `authRequired: true` endpoint still gets `401` first.

**If an action or an endpoint now answers 403.** Its target flow runs on its own trigger. If members are meant to start that elevated work, declare the target `type: 'screen'` (or `type: 'api'` for a signed inbound hook), which states that it is an entry and keeps the elevation reviewable. Or keep it self-triggered and point the action or endpoint at such an entry whose `subflow` node calls it.
