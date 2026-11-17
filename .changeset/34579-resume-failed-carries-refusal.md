---
'@objectstack/types': patch
'@objectstack/plugin-approvals': patch
'@objectstack/rest': patch
---

fix(approvals): a decision stranded by a refused next step says which refusal stranded it

Clause-②: yes (widening)
Metadata-protocol: none

Say an approval flow's next step after the decision is an `update_record`, and a record hook refuses that write (a declared refusal, a validation rule, a permission). `POST /api/v1/approvals/requests/{id}/approve` answers `500 RESUME_FAILED`. The status code and the four #13807 facts are unchanged: the decision stands (`finalized: true`), and `runId` and `repairable` name the stranded run. The body did not say why the run stopped. The engine reported the refusal (`AutomationResult.innerRefusal` and `.userMessage`), and the approvals service dropped it before it built the error.

The `RESUME_FAILED` body now also carries that refusal when there was one:

- `innerRefusal`: `{ code, message }`, the same member the flow doors serve in their `FLOW_FAILED` details;
- `userMessage`: the refusal's marked end-user text at the top level, for example a hook's declared sentence in the caller's locale.

Both are absent when the run met a fault rather than a refusal. `StrandedDecisionDetails` (`@objectstack/types`) declares them as optional members, and `strandedDecisionDetails` drops a malformed one without dropping the four facts.

A flow author who wants the refusal handled instead of stranded can draw a `fault` edge from that step. The engine routes the refusal down it, and the decision then answers normally. This is now pinned and documented in the approvals guide.
