---
'@objectstack/plugin-approvals': patch
'@objectstack/service-automation': patch
---

fix(plugin-approvals)!: a decision on a request whose flow was deleted while its run was paused is refused 409 `RESUME_TARGET_LOST` before anything is recorded, instead of being recorded and answered 500 `RESUME_FAILED` (#26477)

Clause-②: yes (narrowing: an approve, reject or send-back on a request whose paused run can never resume, because its flow was deleted or the node it parked on was edited away, is refused 409 `RESUME_TARGET_LOST` with nothing written, where it was recorded as finalized and answered 500 `RESUME_FAILED`; widened: `@objectstack/service-automation`'s `AutomationEngine` gains the read-only public method `unresumableSuspensionCause(runId)`)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) the change is a runtime refusal of a decision that could never take effect; nothing an author writes is renamed or removed, so there is no FROM → TO mapping to register -->

A suspended run outlives the flow it belongs to: `DELETE /api/v1/automation/:name`, an uninstall or an overlay removal drops the flow and leaves the parked row. The approvals pre-flight asked only whether a suspension still existed, so it passed such a run, the decision was written and the request flipped to `approved`, and only the resume after it hit the engine's flow-gone exit. The approver got a 500 for a decision that stood, and the flow never continued.

What changes:

- `@objectstack/service-automation`: `AutomationEngine.unresumableSuspensionCause(runId)` answers why an existing suspension can never be resumed (`Flow 'F' not found for run 'R'`, or `Suspended node 'N' no longer exists in flow 'F'`), or `undefined` when it can continue or no suspension exists. It is the resume's own never-dispatched classification, shared with the resume path, so the two cannot disagree. It is read-only: it settles nothing (the resume still settles a gone-for-good run, as before), and it rejects when the suspended-run store cannot be read, as `hasSuspendedRun` does.
- `@objectstack/plugin-approvals`: the decision pre-flight (approve, reject, send back and resubmit) asks that question after the existence check. A run whose flow or parked node is gone answers the same 409 `RESUME_TARGET_LOST` a cancelled run already gets, naming the cause, and nothing is recorded: the request stays `pending` with its approvers. A store that cannot be read still fails open, as the existence check does.

**BREAKING** for a caller that relied on the decision being recorded:

- **Before.** Approving a request whose flow had been deleted wrote the decision, set the request to `approved`, and answered 500 `RESUME_FAILED` with `finalized: true` and `repairable: false`. The run stayed parked or stranded.
- **Now.** The same call answers 409 `RESUME_TARGET_LOST` and writes nothing.
- **Fix.** Nothing to change in metadata. To release such a request, recall it (the recall's resume settles the orphaned run), or restore the flow and decide again.
