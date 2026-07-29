---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
---

`decisionOutputs` entries may now be declared `required` (objectui#2955). A typed entry `{ key, label?, type?, multiple?, required?: true }` tells the runtime — not just the decision UI — that an approver must supply the value: an **approve** carrying no value, or a blank one (`''`, whitespace, `[]`, an array of blanks), is rejected with `VALIDATION_FAILED` before any write, so the audit row and the request are untouched and the run can never resume past the node with the key missing.

That gap is what the flag closes. `decisionOutputs` exists so a decision can route the next step (`approvers: [{ type: 'expression', value: 'vars.lead_review.next_reviewers' }]`), but nothing made the approver actually answer: a skipped output resumed the run with the key absent, and the next node either faulted with `EXPRESSION_FAILED` or resolved an empty slate and stalled on `onEmptyApprovers: 'admin_rescue'` — long after the one person who could have filled it in had moved on. `onEmptyApprovers` was the only backstop, and it is a recovery mechanism, not a contract.

**Reject never requires them.** The run leaves down the `reject` edge, where nothing reads the outputs — demanding routing data to say "no" would trap the rejection. Outputs still ride a reject when the approver filled them in.

**No elevation bypass.** A one-click email action link and an `auto_approve` SLA escalation both fail the same way rather than advancing into a node that would resolve nobody; the escalation sweep already isolates a throwing request, so that decision stays pending and visibly overdue instead of silently breaking the run downstream. Enforcement is per decision, so on a `unanimous` / `quorum` node every approver supplies the required outputs and the finalizing decision's values are what the flow resumes with.

`required` rides `normalizeDecisionOutputs`, so it reaches clients on `decision_output_defs` — a decision UI marks the field required and blocks locally instead of round-tripping to a 400. The console side ships in objectui#2955.
