---
'@objectstack/service-automation': patch
---

fix(automation): the stage-change confirm marks a flow that reaches its approval through a subflow

Clause-②: no
Metadata-protocol: none

`AutomationEngine.listRecordUpdateStarts` (served at `POST /api/v1/automation/_record-starts`) set `startsApproval` only when the listed flow itself held an approval node, so a flow that starts its approval inside a flow it calls was listed without the mark. The mark now follows the flows a run calls through `subflow` and `map` nodes, at every region depth and with a shared flow name resolved the way the run dispatches it, asking each flow the same one approval test. A call to a flow the engine does not hold, or holds disabled, is not followed, and a flow that calls itself or a cycle of flows ends.
