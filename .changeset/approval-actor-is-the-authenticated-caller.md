---
"@objectstack/plugin-approvals": minor
"@objectstack/rest": patch
---

fix(approvals): an approval action is recorded against the authenticated caller, never a body field (#3800)

Every mutating approvals entrypoint takes an `actorId`, and the REST routes
filled it from `body.actorId ?? body.actor_id ?? context.userId` — so the body
won. The service then authorized *that value*: `pending_approvers.includes(
input.actorId)` for a decision, `submitter_id === actorId` for a recall. It never
checked that the value named the caller.

So any authenticated user could POST `{"actorId": "<someone else>"}` and have
that person's approval recorded, the request finalized, and the owning flow run
resumed down the `approve` edge — or name a request's submitter and recall it.
With `api.requireAuth` unset the anonymous-deny never fires either, so an
unauthenticated request could do the same.

#3783 drew this line for the *data-write* identity and called the audit-row half
"tolerable". It was not: the same unchecked string was the authorization key, so
naming someone else was not a mislabelled audit row, it was how you got through
the door.

The actor is now resolved server-side (`ApprovalService.resolveActor`) on all
nine entrypoints — `decide` / `decideNode`, `recall`, `sendBack`, `resubmit`,
`reassign`, `remind`, `requestInfo`, `comment`.

**The rule is not "`actorId` must equal `context.userId`."** A slot can
legitimately be keyed by something else: the approver resolver stores the
`type:value` literal when a graph lookup finds no holders, and the Console picks
from the caller's own identity list — user id, email, or `role:<r>`. The rule is
**"the actor must be an identity the server can prove belongs to the caller"**:

- A **system** context keeps its explicit actor. The SLA sweep's reserved
  `system:sla` sentinel and the ADR-0043 action link — whose single-use hashed
  token binds exactly one approver — are unchanged. They are the only callers
  holding a trustworthy actor with no session behind them.
- A caller with **no identity at all** is now refused. This is the anonymous case
  above.
- **No `actorId`, or one naming the caller**, resolves to the caller. This is the
  common path and what the Console already sends.
- **Any other value** is accepted only when the server can prove the caller holds
  it — `position:<p>` / `role:<p>` against the positions on the resolved authz
  context, or the caller's own email (one lazy `sys_user` read, taken only when
  nothing cheaper matched). Otherwise `FORBIDDEN`.

REST still forwards the body value; it is now a *hint* the service validates,
which is what keeps the email and `type:value` slot cases working.

**Upgrade note.** A client that deliberately sent another user's `actorId` now
gets `403 FORBIDDEN` instead of silently succeeding. Send the action as the
acting user's own session — the field can be omitted entirely, and the caller is
used. Server-to-server callers that legitimately act for someone else should
present a system context, as the SLA sweep and the action link already do.

This also makes two existing claims true that were previously aspirational: the
approval object's declared actions say "`actorId` defaults to the caller
server-side… the service remains the authority on who may act", and
`attachViewers` documents `can_act` as mirroring "the exact authorization the
decision methods enforce".
