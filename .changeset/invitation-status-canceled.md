---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

fix(spec,platform-objects): `InvitationStatus` accepts `canceled`, the value cancel-invitation actually writes (#7726)

The spec's `InvitationStatus` enum listed four values —
`pending | accepted | rejected | expired` — while the platform shipped a fifth.
`POST /api/v1/auth/organization/cancel-invitation` (better-auth's organization
plugin) writes `status: 'canceled'` onto the `sys_invitation` row, and
`sys_invitation` declared that value in its own select and filtered on it in its
"Expired / Canceled" listView. So an invitation the platform had just canceled
through its own UI failed validation against `InvitationSchema`, which composes
the enum.

**The enum now accepts `canceled`.** This is a widening that reconciles the
contract to shipped behaviour rather than a new capability: the writer, the
route, the object's action and the listView all predate this change. Consumers
gain a value; none lose one. Nothing in the repo branches exhaustively over
`InvitationStatus`, so no consumer is broken by the fifth member — an
out-of-vocabulary value is still refused exactly as before.

The vocabulary is the union of two upstreams, and the two halves come from
different places: better-auth contributes `canceled` and has no notion of
expiry, while `expired` is ObjectStack's own (driven by `expiresAt`). That is
why the divergence was possible at all.

**The two definitions are now bound.** `sys_invitation.status` reads its select
options from `InvitationStatus` instead of repeating them as a literal — the
same shape the neighbouring `role` field already uses for the membership-role
vocabulary — and a parity test compares the object's declared options against
the enum, so a future divergence lands as a red test instead of as a row the
contract rejects.
