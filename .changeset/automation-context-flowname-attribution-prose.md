---
"@objectstack/spec": patch
---

docs(spec): correct `AutomationContext.flowName`'s attribution prose — elevation decides authorization, not attribution (#14011)

The published contract for `AutomationContext.flowName` (shipped in
`dist/contracts/index.d.ts`) said a `runAs:'system'` run "resolves no user", so
`resolveRunDataContext` labels its data operations `svc:flow:<flowName>` on
`ExecutionContext.actor` "instead of leaving the audit row unattributed".

That reads as **"system elevation costs you the operator in the audit trail"**,
and it has not been true since #5494. What ships: `resolveRunDataContext`
carries the triggering user through UNCHANGED under elevation — `isSystem`
alone decides authorization, while the user drives the platform's attribution
stamps. A write made with `{ ...callerCtx, isSystem: true }` leaves
`created_by` / `updated_by` naming the caller, identical to the same write on
the plain user path; the audit writer records `session.userId ?? session.actor`
on `sys_audit_log.actor`, in that order, with no `isSystem` gate anywhere in
either path.

The `svc:flow:` labelling the sentence described is real, but it is the
FALLBACK for a run that genuinely has no operator — a schedule, or a
`runAs:'system'` flow fired by a write that itself carried no user. The
sentence generalised it to every `runAs:'system'` run.

Runtime behaviour is unchanged: this corrects the description of shipped
behaviour, nothing else. The correction is now also pinned by
`runas-attribution-contract.test.ts` in `@objectstack/service-automation`, which
asserts both limbs against the real ObjectQL stack — so if the code ever
becomes what the old prose described, a test goes red rather than a reader
having to re-measure.

Why it earned a card rather than a shrug: downstream, the stale sentence was
written into an adjudication as the explicit stop-condition for a security
design ("if elevation erases the operator, stop and report a fork"). The
correct design was one measurement away from being abandoned on a false
premise. Prose that talks a reader out of the right answer is worth more than a
cosmetic fix.
