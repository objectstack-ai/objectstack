---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
---

feat(spec,service-automation): a flow run's result carries the flow's authored label as `flowLabel` (#20318)

Clause-②: yes (widening)

**The widening.** `AutomationResult` (`@objectstack/spec/contracts`) gains one
optional member, `flowLabel?: string`, and `TriggerFlowResponseSchema`
(`@objectstack/spec/api`) mirrors it on `data`. The automation engine sets it to
the flow definition's `label`, copied verbatim, the same way it copies
`successMessage` and `errorMessage`. Nothing is removed or renamed, and no
existing member changes meaning.

**Why.** A flow runner names the flow it is running, in its header and in its
completion toast, and translates that name against the `flows.<flow>.label`
translation key, falling back to the authored label. The runner only held the
flow's API name, so there was no authored label to fall back to. The console's
reader of the translation key is a separate change.

**Which results carry it.**

- **Set** on every result of an evaluation of a registered flow: `status: 'paused'`
  (first attempt, retry attempt, a resume that pauses again), a terminal success
  (including the two skip exits), `'failed'` (including an exhausted retry budget),
  `'stranded'`, `'refused'`, and a resumed parent whose delegated child failed.
- **Absent** on every refusal that carries a `code` (the run never dispatched, or a
  resume never continued it) and when the flow is not registered.
- **Subflow chains** answer with the label of the run the caller addressed, which
  is the parent. The child that supplied the screen does not lend its label.
- **Never the API name.** `FlowSchema` requires `label`, so the value is always
  what the author wrote, an empty string included.

**At the wire.** Both runner doors relay the result verbatim on a `200`, so
`data.flowLabel` arrives on `POST /api/v1/automation/:name/trigger` (a paused or
finished launch) and on `POST /api/v1/automation/:name/runs/:runId/resume` (a
further pause or the completion). A `400 FLOW_FAILED` answer is unchanged: its
`error.details` keep their fixed set (`errorMessage`, `summary` and, on resume,
the stranded verdict), with no `flowLabel`.

**For a consumer.** A client that parses the trigger response with
`TriggerFlowResponseSchema` now keeps `data.flowLabel`, where an undeclared key
would have been stripped. A caller that deep-compares a whole `AutomationResult`
from `execute()` or `resume()` sees one more key on the results listed above.
