---
'@objectstack/runtime': patch
---

fix(runtime): the trigger door refuses a self-triggered flow declared to run as system to any caller but the system principal

Clause-②: no

A self-triggered flow declared to run as system could be started by any signed-in member through the trigger door. `POST /api/v1/automation/:name/trigger` (and the legacy `POST /api/v1/automation/trigger/:name`, and `@objectstack/verify`'s `flows.run`, which answer through the same function) asked only whether the caller was anonymous, so a flow meant to run on its own trigger, or as a sub-flow, also ran elevated for anyone who named it.

**What changes.** A caller that is not the system principal now gets `403 PERMISSION_DENIED` (ADR-0112 envelope) when it starts a flow declared `runAs: 'system'` whose `type` is `autolaunched`, `record_change` or `schedule`. Nothing runs: no run record, no node, no side effect. The refusal names no part of the flow. This includes a platform admin's session, which is a signed-in user, not the system principal.

**What stays as it was.**

- `screen` and `api` flows, elevated or not: doors the author designed (ADR-0073 D2).
- Every flow that does not declare `runAs: 'system'`.
- A parent flow's `subflow` node calling an elevated flow: the child starts through the engine, never through the door.
- The system principal (an in-process caller, such as a job), which starts every flow.

**If a call now answers 403.** That flow runs on its own trigger. To start its work on a user's request, call it from a parent flow's `subflow` node, or, if it is meant to be a door, declare it `type: 'screen'` (or `type: 'api'` for a signed inbound hook) so the elevation is a reviewable choice.
