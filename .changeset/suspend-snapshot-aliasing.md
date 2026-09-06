---
"@objectstack/service-automation": patch
---

A restored suspension now carries the state the run was paused with, including nested values.

`restoreConsumedSuspension` is the operator exit from a run whose resume consumed the pause and then failed downstream: it puts the suspension back so the run is resumable again. What it put back was documented as the pause "verbatim", and was — for the top-level variables only.

The flow scope a resume hands the downstream nodes was rebuilt as `new Map(Object.entries(run.variables))`: that copies the keys and shares every value object with the parked snapshot. An executor that keeps state in the scope and updates it **in place** — `map` tracks its progress in `<nodeId>.$mapState` — therefore wrote straight through into the snapshot, and the journal recorded the result as the pause. An operator repairing a stranded `map` run got a snapshot claiming progress made by the attempt that failed, not the progress the run actually had when it paused.

Measured, not inferred: the durable row held `started: 1` at the pause and the restore put back `started: 99`.

The pause's variables are now copied before the failed attempt runs, on the line that already captures the pause's step count for the same reason. No later placement works — the node mutates and then throws, so a copy taken when the journal is written copies the mutation. Nothing else changes: the running flow still sees exactly the scope it saw before, the resume ordering is untouched, and a value that cannot be copied falls back to the previous behaviour with a warning rather than costing the operator the repair.
