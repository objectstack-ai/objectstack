---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

fix(automation): a flow's answer also names the read-only fields its `map` items and its paused-then-resumed `subflow` children dropped

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/service-automation`**: the run answer's `droppedFields` (#32861) now rolls up every child run that `summary` credits on completion. A `map` node folds the drop events of each item that completed, on its synchronous exit and on the exit that pauses; a `subflow` or `map` child that paused and then completed hands its drop events to the parent's awaiting step, whether the caller resumed the parent (the delegated leg) or the child's own run id (the up-bubble). This lifts the delegated limit #32861's note states for those two shapes. One fold serves every leg, one event per object and reason as before.
- The fold is now total: a list or event that is not well-typed (a host-registered executor's malformed `droppedFields`) is skipped, and a completed run is never turned into a failed or retried one over it.
- **`@objectstack/spec`**: the `AutomationResult.droppedFields` jsdoc and the `TriggerFlowResponseSchema.data.droppedFields` describe state the rule as built. What remains: a child run that failed answers no drops, so where a `try_catch` or `fault` edge contains that failure an absent member is not proof the failed child dropped nothing; and a `map` item whose paused run an operator cancelled answers none either (the map goes on with the cancelled marker in that item's `results` slot). The member's shape is unchanged.
