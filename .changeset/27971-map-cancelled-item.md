---
'@objectstack/service-automation': minor
'@objectstack/spec': minor
---

fix(service-automation)!: a `map` whose item run was cancelled records the item as cancelled when the map's own run is resumed

Clause-②: yes (widening)
Metadata-protocol: added
Ruling-ref: 6523833308

`cancelRun` on a `map` item's run terminates that item and leaves the map's run parked on it. Resuming the map's run by its own id used to re-run the map, which moved past the item with nothing recorded: `results` held only the later items' outputs, `results[i]` stopped being item `i`, and the run finished `completed`.

- **A cancelled item keeps its slot.** The resume reads the item run's history. When it says `cancelled`, the map goes on, and that item's entry in `outputVariable` (and in the node's `results`) is the closed marker `{ $status: 'cancelled', $itemRunId }` instead of an output. A downstream node reads it where it reads the results: `results[i]['$status'] == 'cancelled'`. A child flow's output keys are its declared variable names, which never start with `$`, so no real output looks like the marker.
- **Never a run or a success.** The node's `count` is the items that ran; the marker is not counted, and the cancelled item adds nothing to the step's totals.
- **Nothing to record is refused.** An item whose suspension is gone without a `cancelled` entry in its run history (no entry, an unreadable store, a run that completed without reaching the map) is refused `409 RESUME_CHILD_PENDING` before anything moves, the same code as an item that is still suspended.
- **Through a `subflow` too.** Resuming a run that waits on the map through a `subflow` link records the marker one level down, the same way.
- A caller still cannot write the map's handoff variables: a resume signal that writes the engine's `$` namespace is refused `400 INVALID_SIGNAL`, cancelled item or not.

`MapConfigSchema.outputVariable`'s description in `@objectstack/spec` now says an element can be that marker.
