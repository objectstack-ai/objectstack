---
'@objectstack/service-automation': minor
---

fix(service-automation)!: registration refuses a flow whose own graph holds no `start` node, so `POST /api/v1/automation` answers 400 at the save instead of storing a flow that fails only at its first trigger (#32142)

Clause-②: no (narrowing) — `AutomationEngine.registerFlow` refuses a definition it accepted before: one whose top-level `nodes` carry no `type: 'start'` member. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — every flow `skills/objectstack-automation` teaches already opens with a start node, and the refusal text carries the cure.

<!-- adr-0087: not-required (no-migration-prescription) no key, value or spelling is retired and no stored row can be rewritten mechanically: a start node carries the flow's trigger, which only its author knows, so the refusal text names the cure and `os migrate meta --stored` lists each such row -->

**BREAKING** accept-set narrowing at every door that registers a flow: the automation write doors (`POST /api/v1/automation`, `PUT /api/v1/automation/NAME`), the boot pull, the `kernel:ready` bind and the metadata-change sync.

- **Before.** A flow with no `start` node (an empty `nodes` list included) registered in any status, the write door answered `200`, and the flow failed only when run: every trigger and every explicit run answered `422 FLOW_NO_START_NODE`.
- **Now.** Registration refuses it, in a message that opens "Flow 'NAME' rejected: the flow's top-level nodes hold no start node" and names the node types it found and the cure. The write doors answer `400 VALIDATION_FAILED` and register nothing. The check runs first among the registration checks and is status-agnostic, as they are: a `draft` flow is enabled in this engine and fails its first run the same way. A start node inside a region body (`loop`, `parallel`, `try_catch`) does not count; a region is entered at its single entry node.
- **Stored rows.** A flow stored with no start node no longer arms at boot. The boot completes; the bind warns, names the flow and records the refusal, and the metadata read serves the stored row unchanged beside `registration: refused` with the engine's words. `os migrate meta --stored` lists each such row as a `registerFlow` TODO at `flows[0].nodes`. The metadata save door still keeps a start-less draft mid-edit; the engine records the same refusal for it.
- **Unchanged.** A flow with a start node registers as before. The run-time `FLOW_NO_START_NODE` exit and its `422` mapping stay in place.
