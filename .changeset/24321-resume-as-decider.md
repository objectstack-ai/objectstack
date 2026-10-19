---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/plugin-approvals': minor
---

feat(automation)!: an approval decision resumes a `runAs: 'user'` flow as the person who decided

Clause-②: no (narrowing). A post-decision node that the submitter's rights admitted and the decider's do not is now refused (ruling A item 3). No schema shape moves: `flow.runAs` keeps its two values and only its describe changes.

<!-- adr-0087: not-required (no-migration-prescription) A runtime semantics change of the declared key flow.runAs ('user'), not a metadata shape change. No spec key, enum value, export, option, config field, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is whose rights a run's nodes after an approval decision carry: the decider's instead of the trigger user's, so a node the decider may not perform is refused where it used to run. The other categories are closed on facts: the three packages publish (not unpublished); no ADR-0087 id covers this behaviour and this diff adds none (not registered / already-registered); and the change is a behaviour change, not only an interface or type change (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A resumed flow run kept its trigger user for its whole life. In an approval flow that meant the nodes after the manager's decision wrote as the rep who submitted: the record's Last Modified By (`updated_by`) and the audit log named someone who did not act, and the writes ran under the rep's grants.

`flow.runAs: 'user'` now means the human whose act is running the current segment: the trigger user until a human decision, the decider after it.

- **Now:** after an approval decision (approve or reject), the nodes that follow run with the decider's identity and permissions together. Their positions, permission sets and organization peers are resolved for them through the same resolver that seeds the trigger user's run, never copied from the trigger user. `updated_by` and `sys_audit_log` name the decider for those writes. The nodes before the decision keep the submitter. A second decision moves the segment to its own decider, a later pause keeps the identity the segment had, and the run's history still names the user who triggered it.
- **Refused now:** a node after the decision that the decider may not perform (an object or field they may not edit, a record outside their reach) is refused, the run stops at that node as a repairable strand, and the decision door answers `RESUME_FAILED` (`repairable: true`) naming the run, the node and the refusal, as for any other failed post-decision node. Before, the same node ran with the submitter's rights. A repair replay (`continueRestoredRun`) continues as the decider too.
- **Unchanged:** a `runAs: 'system'` flow, including the trigger user it carries for attribution; a flow with no human decision node; an SLA auto-decision, which names no human, so the run keeps the identity it had; a subflow parent's own nodes; and the send-back, resubmit and recall doors.

`@objectstack/plugin-approvals` hands the decider to the engine on the service-stamped resume signal: the person the verdict mirror already writes as. The engine honours a decider only on a signal that carries the owning service's `RESUME_AUTHORITY_SERVICE` marker, so a resume built from an HTTP body cannot name one. The published types gain one optional member each: `ResumeSignal.resumedBy` (`@objectstack/spec/contracts`), and the `resumedBy` field on `ApprovalResumeSurface`'s resume signal and on `StrandedContinuationSignal` (`@objectstack/plugin-approvals`).

What changes for you: if a `runAs: 'user'` flow's nodes after an approval decision must write something the approver may not, such as a read-only field or a field the approver's permission set marks non-editable, the flow needs `runAs: 'system'`, which is unchanged by this release. A run that was suspended before this release and is decided after it continues as the decider.
