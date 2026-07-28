---
"@objectstack/plugin-approvals": minor
"@objectstack/service-automation": patch
---

fix(approvals): the status mirror names the human who caused the transition (#3783)

When an approval moves, the service writes the new status onto the business
record (`approvalStatusField`). That write is what fires the record-change flows
bound to that object — so it is the seam "when the invoice is approved, do X"
runs through. It presented a bare `{ isSystem: true }` context with **no
`userId`**, at six call sites that each know exactly who acted: a submitter
submitting, an approver approving, rejecting, sending back, recalling.

Combined with #3760 — which stopped letting a `runAs:'user'` run with no trigger
user touch data — that identity gap made the most natural approvals automation
there is unwritable in its obvious form. The cascade inherited no user, so its
data nodes were refused, and the author's only way forward was to declare
`runAs: 'system'` and take blanket elevation for a case where a perfectly good
scoped identity existed at the call site all along.

The mirror now carries the acting user. It stays `isSystem` — the record is
normally locked while its approval is live, so only a platform write can land the
status — because elevation and anonymity are separate choices, and this write
only ever needed the first. Cascades now run as the deciding user with RLS
enforced.

- **The identity is the authenticated principal, never the request body's
  `actorId`.** `actorId` arrives from the caller (`body.actorId ?? context.userId`)
  and is only checked against the pending approver slate, never against the
  caller. That is tolerable on an audit row; promoting it to the identity of an
  RLS-scoped write would have turned a mislabelled audit trail into identity
  spoofing.
- **Approval-by-email-link is attributed too.** ADR-0043 action links carry no
  session, so they used to decide as pure system. The single-use hashed token
  binds exactly one approver and is re-checked against the live slate at
  redemption — that is an authentication — so the redeemed decision now presents
  that approver, and an emailed approval cascades identically to one made in the
  UI.
- **The two machine-driven transitions stay user-less on purpose**: the SLA
  escalation's auto-decision and the dead-run sweep. `system:sla` and
  `system:dead-run` are reserved audit actors, not users, and presenting one as a
  user would put a non-user in `updated_by` and in every downstream flow's
  identity. A flow that wants to react to those declares `runAs:'system'` — the
  honest answer, and now a deliberate one rather than an artefact.
- **Attribution only — the write is not newly org-scoped.** On an
  ExecutionContext `tenantId` is a driver-scoping knob, not attribution
  (ObjectQL turns it into a tenant predicate), so passing the request's org would
  have silently no-op'd the mirror on a record whose org differs. The automation
  engine already back-fills a run's `tenantId` from the resolved user's grants.

**Visible change:** the mirrored record's `updated_by` now names the acting user
instead of retaining its previous value — ObjectQL's audit stamping is gated on
the write context's `userId` alone, and `isSystem` buys no exemption. That is the
attribution this fix is for: the approver who set the record to `approved` is now
its last modifier.
