---
'@objectstack/service-automation': patch
'@objectstack/spec': patch
---

feat(service-automation)!: a flow whose `save_notice` runs after a `subflow` / `map` whose child can suspend is registered but not armed (#28840)

Clause-②: no (narrowing)
Metadata-protocol: none

**BREAKING** for a record-triggered flow that places a `save_notice` node after a `subflow` or `map` node whose child flow can suspend the run.

- **Before.** The flow parse refuses a `save_notice` that an `approval`, `wait`, `screen` or `approval_revise` node reaches (#28806), but it cannot see into a `subflow` / `map` child. A flow that asked the approval in a subflow and told the saver after it registered and armed. Its child suspended it, the write answered, and on the resume the `save_notice` was refused by name, so every decision stranded the run (`RESUME_FAILED`).
- **Now.** The arming gate in `activateFlowTrigger` declines such a flow, beside its disabled-subflow half (ADR-0126 §7.3). "Can suspend" means the child holds a node of an always-suspending type reachable from its start, or calls a child that can suspend, read through every call with cycle protection. The flow still registers, is not armed, and warns once, naming the `save_notice`, the `subflow` / `map` node and the child's suspending node. `GET /automation/_status` reports it `bound: false` with that reason and the new `unboundCause` value `notice_after_suspending_subflow` (added to `FLOW_UNBOUND_CAUSES` in `@objectstack/spec/contracts`). Whenever a flow is registered, every flow whose calls reach it is judged again, so the decline does not depend on load order, and a child republished without its suspension arms the caller again.
- **Not declined.** A `subflow` / `map` whose child cannot suspend, and a `save_notice` reachable only before the call. Registration, the save door and `objectstack validate` accept the same flows as before.
- **The fix.** Move the `save_notice` ahead of the `subflow` / `map` node the reason names, or tell the person after it with a `notify` node, or republish the child without the node that suspends. The flow arms on its own once the shape is gone.
- **Who moves.** No shipped flow has the shape: the showcase's one `save_notice` (`showcase_task_completed`) has no `subflow` or `map` node, the dogfood fixtures carry no `save_notice`, and HotCRM's `main` carries none.

<!-- adr-0087: not-required (no-migration-prescription) no metadata key is added, removed, renamed or re-shaped and the save door accepts the same flows: a flow that registered still registers and is only left unarmed by the runtime, with its own reason naming what to move, and the one contract change is a new value in the runtime status cause list, which no author writes and no migration could rewrite -->
