---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
"@objectstack/rest": minor
---

feat(spec,plugin-approvals,rest): the approvals inbox read gets an `unstaffed` arm, so an `admin_rescue` request is in the queue of a caller who may override it

Clause-②: yes (widening)

- **What is new.** `IApprovalService.listRequests`' filter declares an optional `unstaffed?: boolean`. `countRequests` takes the same filter, so it answers it too. `GET /api/v1/approvals/requests` accepts it as the declared query parameter `?unstaffed=true|false`.
- **What it selects.** The PENDING requests whose current slate names no person: no user id and no email, only `type:value` literals such as `position:<p>`, or nothing at all. This is what `onEmptyApprovers: 'admin_rescue'` (the default) opens. The test is the one the open path makes before it warns "decidable only by a privileged admin", applied to the slate as it stands. A slate whose last named approver acted and left only literals matches too. A slate that still names a person never matches, even if that person has left.
- **Who it returns them to.** Only a caller who may override them, judged by the privileged-override rule that admits the override decision itself. Every row it adds reads `viewer.can_override: true`, and a tenant admin's arm stops at their organization. For anyone else the member adds nothing and refuses nothing.
- **How it composes.** It is ORed with `approverId`, never ANDed. `?status=pending&approverId=<my identities>&unstaffed=true` answers "my pending approvals, rescues included" in one call, paged server-side, and `total` counts both arms. Without `approverId` it selects the rescue requests alone. `unstaffed=false` is the same as leaving it out.
- **What is refused.** Any value but `true` or `false` (`1`, `TRUE`, an empty `?unstaffed=`) answers `400 VALIDATION_FAILED` with `fields[0]` `{ field: 'unstaffed', code: 'invalid_boolean' }`, and a repeated `?unstaffed=` answers the route's multiplicity `400`. Nothing changes for a caller who does not send it: `approverId` matches exactly what it matched before.
- **Before this.** The request was in no queue. `approverId` matches a slot against the addresses a caller names, and an override actor's addresses never equal an unstaffed `position:<p>` literal. So no "My Pending" listed it, no bell counted it, and a `lockRecord: true` record stayed locked until an admin browsed the unfiltered list.
