---
'@objectstack/spec': patch
---

fix(spec): an action's `operation: 'delete'` refusal names the flow route that deletes the current record as the caller

Clause-②: no
Metadata-protocol: none

`operation: 'delete'` on an action is refused, as before: a row delete is the object's own delete affordance, not a declarative action. The refusal now also says how to build the action an author wanted: a `type: 'flow'` action naming an autolaunched flow that deletes the record. The flow runs as the caller, so the caller's delete permission applies. A script action is deliberately not suggested: its body runs elevated and would skip that permission. An agent building a "delete this line" action used to stop after two refusals that named no way forward. Nothing else changes: the same input is refused with the same issue code.
