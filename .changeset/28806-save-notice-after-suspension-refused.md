---
'@objectstack/spec': minor
---

feat(spec)!: a `save_notice` node that a suspending node reaches is refused at the flow parse (#28806)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for a flow that places a `save_notice` node after an `approval`, `wait`, `screen` or `approval_revise` node on a path from its start.

- **Before.** The placement check (#28251) read only the start trigger, so a record-triggered flow with `start → approval → save_notice` parsed and saved. At run time the leg after the suspension holds no write to answer, so the node was refused by name. After an approval the decision was already recorded when the resumed run failed, so every decision on such a flow stranded its run (`RESUME_FAILED`).
- **Now.** The `FlowSchema` parse also refuses a `save_notice` node reachable along the flow's edges from a node that always suspends the run (`FLOW_PAUSE_CAPABLE_NODE_TYPES`: `screen`, `wait`, `approval`, `approval_revise`). Any one such path counts, loops included, even when another path reaches the node before any suspension, because a static graph cannot rule the suspended path out. A `save_notice` inside a region body is judged by its top-level container. The refusal is the same `INVALID_METADATA` 422 at `nodes.<i>.type` as the trigger case. It names the suspending node and tells the author to move the `save_notice` ahead of it, or to tell the person after it with a `notify` node. `objectstack validate`, the metadata save door and `registerFlow` refuse it alike.
- **Not refused.** A `save_notice` reachable only before any suspension. A `subflow` or `map` ahead of the node: those pause only when the child flow they name pauses, which the parse cannot see, so a `save_notice` after one still meets the run-time refusal by name.
- **The fix.** Move the `save_notice` ahead of the suspending node the refusal names. To tell someone after the approval, use a `notify` node there.
- **Who moves.** No shipped flow has the refused shape: the showcase's one `save_notice` (`showcase_task_completed`) has no suspending node, and HotCRM's `main` carries no `save_notice`.

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed, renamed or re-shaped and no export or type changes: one more graph shape is refused at the parse with its own prescription in the error (move the node ahead of the suspending node, or use a notify node after it), which is a judgment about where the node stands, not a mechanical rewrite a migration could apply -->
