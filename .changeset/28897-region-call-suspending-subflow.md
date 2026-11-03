---
'@objectstack/service-automation': patch
'@objectstack/spec': patch
---

feat(service-automation)!: a flow whose region body calls a child that can suspend is registered but not armed, and the region refusal cancels the child run it leaves behind (#28897)

Clause-②: yes (narrowing)
Metadata-protocol: none

**BREAKING** for a record-triggered flow with a `subflow` or `map` node inside a `loop` body, a `parallel` branch or a `try_catch` slot, whose child flow can suspend the run.

- **Before.** A region body cannot carry a durable pause (ruling D on #15646). The flow parse refuses the pausing node types inside a region, but it cannot see into a `subflow` / `map` child. Such a flow armed, and the first time its child suspended, the run failed at the region boundary with the named refusal (`durable pause inside a structured region …`). The child run that node had started was left parked in the suspended-run store: a later resume ran the rest of the child for a caller that had already failed, and then failed to resume that caller.
- **Now, the first door.** The arming gate in `activateFlowTrigger` declines such a flow, after its disabled-subflow and save-notice halves. "Can suspend" is the save-notice half's reading: the child holds a node of an always-suspending type reachable from its start, or calls, from its top-level graph, a child that can suspend. The flow still registers, is not armed, and warns once, naming the region node (the innermost container), the `subflow` / `map` node and the child's suspending node. `GET /automation/_status` reports it `bound: false` with that reason and the new `unboundCause` value `suspending_subflow_in_region` (added to `FLOW_UNBOUND_CAUSES` in `@objectstack/spec/contracts`). Whenever a flow is registered, every flow whose calls reach it is judged again, so the decline does not depend on load order, and a child republished without its suspension arms the caller again.
- **Now, the second door.** A run that still meets the region refusal (a direct execute, or a flow with no trigger) fails exactly as before, with the same refusal. Before throwing it, the engine cancels the child run the `subflow` / `map` node parked, and every run that child is parked on, through `cancelRun`. Each cancelled run records `cancelled`, with the refusal as its reason.
- **Not declined.** A region-nested call whose child cannot suspend, and a top-level call to a child that can (the top-level graph carries the pause). Registration, the save door and `objectstack validate` accept the same flows as before.
- **The fix.** Move the `subflow` / `map` node the reason names onto the top-level graph and route the region's exit to it, or republish the child without the node that suspends. The flow arms on its own once the shape is gone.
- **Who moves.** No shipped flow has the shape. HotCRM's `campaign_enrollment` calls two children from loop bodies, and neither child suspends. The showcase and dogfood calls are all top-level.

<!-- adr-0087: not-required (no-migration-prescription) no metadata key is added, removed, renamed or re-shaped and the save door accepts the same flows: a flow that registered still registers and is only left unarmed by the runtime, with its own reason naming what to move, a run that failed at the region still fails there with the same refusal, and the one contract change is a new value in the runtime status cause list, which no author writes and no migration could rewrite -->
