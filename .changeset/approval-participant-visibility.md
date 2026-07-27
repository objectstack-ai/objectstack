---
"@objectstack/plugin-approvals": patch
---

fix(approvals)!: an approval request is visible to its participants, not to the whole tenant (#3590)

`getRequest` / `listRequests` / `countRequests` deliberately query with
`SYSTEM_CTX` to bypass RLS — as the code comments say, the approver-visibility
rule spans identity forms RLS cannot model cleanly, so it has to be expressed in
the service. Only the **tenant** half of that rule was ever applied. The
participant half was named in the comment and never written, so **any
authenticated user could read any approval request in their tenant** — its
payload snapshot, its full decision history, and (once decision attachments
derived their access from the request, #3580) its files.

`approverId` on `listRequests` is a *filter*, not authorization: omitting it
returned the whole tenant.

A caller now sees a request when they are a participant — the submitter, a
current approver (via the normalized approver index, so every identity form the
write path recorded is covered), or someone who has already acted on it (a past
approver whose slot has moved on, a commenter). Admins with override authority
keep the unrestricted view the "all requests" console surface depends on, and a
tokenless context sees nothing.

Keying on the concrete user id is sufficient rather than an approximation:
position/team/manager/field approvers are resolved to concrete user ids at open
time, and the `type:value` literal is only the fallback for a spec that resolved
to *nobody* — a slot no one can act on either way. So this cannot hide a request
from someone who could actually act on it.

**A write path's own result is not re-gated.** Every operation echoes back the
request it just changed; the operation already authorized itself, and re-asking
would answer wrong for a context carrying no `userId` (a flow-driven resume, a
service-to-service call), turning a successful write into `null`.

Marked breaking because a client that listed requests without an `approverId`
filter and expected the whole tenant will now receive only its own — which is
the point.
