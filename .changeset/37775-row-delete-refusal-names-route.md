---
'@objectstack/spec': patch
---

fix(spec): an action's `operation: 'delete'` refusal names the route that does delete the current record

Clause-②: no
Metadata-protocol: none

`operation: 'delete'` on an action is refused, as before: a row delete is the object's own delete affordance, not a declarative action. The refusal now also says how to build the action an author wanted: a `type: 'script'` action whose `body` runs `await ctx.api.object('<object>').delete({ where: { id: ctx.recordId } })`, or a `type: 'flow'` action naming an autolaunched flow that deletes the record, which runs as the caller. An agent building a "delete this line" action used to stop after two refusals that named no way forward. Nothing else changes: the same input is refused with the same issue code.
