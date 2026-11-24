---
'@objectstack/lint': patch
'@objectstack/service-automation': patch
---

fix(lint, service-automation): the date-text refusal on a flow value envelope names the rewrite for a record-triggered flow that a parent also starts

Clause-②: no
Metadata-protocol: none

A flow with its own record trigger or time-relative sweep gets the date-text check on its value envelopes (`update_record` / `create_record` `fields.*`, `assignment` values). Example: `timestamp(record.borrow_date)` over a `date` field. The check is refused at `os validate` / `os build` and at `registerFlow`. It stays refused when another flow also starts the same flow through a `subflow` or `map` node, because the flow's own trigger hands it a row of the typed object on every run it starts. The set of refused flows does not change.

The refusal now also says how to share the steps with such a parent. Move the shared steps into a child flow with no trigger of its own, which is judged untyped because its `record` is whatever each caller hands it. Then start that child from both flows. Both doors append the same sentence after the verdict's own fix. The stored pass of `os migrate meta --stored` lists that sentence too.
