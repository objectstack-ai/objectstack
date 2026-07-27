---
"@objectstack/spec": patch
"@objectstack/plugin-approvals": patch
---

Surface the approval node's author-declared `decisionOutputs` keys on the request read as `ApprovalRequestRow.decision_outputs` (#3447 P2 UI enablement). The set varies per request (each node declares its own), so it rides the row rather than the object's static action params — a decision UI renders one input per key and POSTs `outputs` with the decision.
