---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
---

feat(automation): a flow declares who may start it — `requiredPermissions` on the flow, checked at every start door

A flow can now carry `requiredPermissions: ['capability', …]`, the same value shape as an action's `requiredPermissions` (ADR-0066 D4). Every door that starts a flow by name checks it in one shared check: the trigger route (`POST /automation/:name/trigger`), an action of `type: 'flow'` (REST `POST /actions/:object/:action` and the MCP `run_action` bridge), and a declared endpoint of `type: 'flow'`. A caller that is not the system principal must hold every named capability (granted through a permission set's `systemPermissions`), or the door answers `403 PERMISSION_DENIED` and nothing runs.

- **The action door inherits the flow's list.** An action that starts a gated flow is gated by the flow even when the action declares nothing, so the app states it once. An action that declares its own list keeps its own gate, which answers first, so a caller at that door needs both lists.
- **A sub-flow is not a door.** A parent flow's `subflow` node starts its child through the engine and is not checked again; the parent's own start was.
- **The elevated self-triggered rule still answers first.** Holding the capabilities does not let a member start a `runAs: 'system'` flow of type `autolaunched`, `record_change` or `schedule`.
- **`os validate`** judges the key's values the way it judges an action's: a capability no built-in, `defineCapability` or `systemPermissions` grant provides is reported as `capability-reference-unknown` at `flows[i].requiredPermissions` (`os explain capability-reference-unknown`).

This is how to say who may start an elevated (`runAs: 'system'`) `screen` or `api` flow. An app that gates such a flow with a `decision` node on `current_user.positions` can move that gate to the flow's `requiredPermissions`; the positions array is not an authorization input. A flow that declares no `requiredPermissions` starts exactly as before.

Clause-②: yes (widening) — a flow may declare a new key, `requiredPermissions`; a flow that does not declare it is admitted at every door exactly as before.

Metadata-protocol: added (`FlowSchema.requiredPermissions`)
