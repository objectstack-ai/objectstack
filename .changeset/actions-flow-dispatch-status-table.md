---
'@objectstack/runtime': minor
---

`POST /api/v1/actions/:object/:action` answers the flow-dispatch status table instead of one blanket `400 FLOW_FAILED` (#9446).

**What a caller sees differently.** A `type: 'flow'` action whose dispatch is REFUSED no longer reports a failed run. Three answers changed:

| the flow behind the action | before | now |
|---|---|---|
| is not registered | `400` `FLOW_FAILED` | `404` `RESOURCE_NOT_FOUND` |
| is switched off | `400` `FLOW_FAILED` | `409` `FLOW_DISABLED` |
| has no `start` node | `400` `FLOW_FAILED` | `422` `FLOW_NO_START_NODE` |
| ran and was rejected | `400` `FLOW_FAILED` | `400` `FLOW_FAILED` (unchanged) |

These are the same four rows `POST /api/v1/automation/:name/trigger` has answered since #9378 + #9415, and they now come from one shared definition both doors read, so the two cannot drift apart again.

**Behaviourally breaking for a caller that branches on the status or the code.** Every one of these was a `400` before, so a caller treating `400` as "the run failed" was being told something false in three of the four cases: nothing had dispatched and no node had executed. A client that lumps all four together keeps working — they are all still refusals, all still `success: false` with no inner envelope — but one that reports "the flow failed" on a `400` should now distinguish. **Retry semantics differ per row**, which is the practical reason to: `409 FLOW_DISABLED` is reversible operational state (enable the flow and the identical request succeeds), while `404` and `422 FLOW_NO_START_NODE` are authoring defects that no retry fixes. `400 FLOW_FAILED` remains terminal, exactly as the console already treats it.

**Unchanged on purpose.** A successful run still answers `200` with the single `data` wrap (#3962). The `400 FLOW_FAILED` message keeps its existing wording (`Flow '<target>' failed: …`), which names the flow the action dispatches — the trigger route's URL carries that name and this route's does not. A `success: false` result the automation engine did not classify still refuses with `400 FLOW_FAILED` rather than falling back to `200 {success:true,data:{success:false}}` — the double envelope #3962 removed from this route.

**Not in scope.** Declared endpoints (`type: 'flow'` endpoints, `endpoint-executor.ts`) still answer `200` for every outcome. That door converges in its own change (#9462), where the envelope flip is a breaking change for consumers of the current double envelope and is sequenced against them.
