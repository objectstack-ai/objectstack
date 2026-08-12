---
"@objectstack/plugin-security": patch
---

fix(plugin-security): a plain member can no longer read the organization's whole invitation ledger (#8095)

**Security — narrowing.** Any authenticated `member` of an organization could
read **every** `sys_invitation` row of that organization through the data API:
each invitee's email address, the role they were about to be granted, who
invited them, and the expiry. Measured live: `GET /api/v1/data/sys_invitation`
as a plain member returned `200` with the same rows the org **owner** sees.

The grant was declared, not accidental. `sys_invitation` is in
`BETTER_AUTH_MANAGED_OBJECTS`, whose blanket `denyWritesOnManagedObjects()`
entry sets `allowRead: true` on every managed identity table for
`member_default` and `viewer_readonly` — reads permitted, "subject to the rest
of the RLS chain". For this object there was no rest of the chain: neither set
declared a row-level policy for `sys_invitation`, and an object with no
applicable policy compiles to a null business-RLS filter, i.e. no row scope at
all. `sys_member` is a staff directory and reads org-wide on purpose; a pending
invitation is administrative *intent* about people who are not members and never
consented to a directory listing — and *who is about to become an admin* is
enough for targeted social engineering.

**What changed.** `member_default` and `viewer_readonly` each gain one
row-level policy, `sys_invitation_self` (`select`,
`email == current_user.email`). The full ledger is now owner/admin only, via
`organization_admin` exactly as before.

**The invitee still sees their own invitation**, and that half is not
incidental: the recipient-side row actions on `sys_invitation`
(`accept_invitation` / `reject_invitation`) are gated on
`record.email == ctx.user.email`, so an addressee who cannot read their row
cannot act on it. The object-level read bit is therefore deliberately left open
and the narrowing done at the row level — closing the object would have broken
acceptance while looking like the same fix.

**Unaffected.** Every better-auth organization endpoint
(`invite-member`, `accept-invitation`, `reject-invitation`,
`cancel-invitation`, `list-invitations`, `list-user-invitations`,
`get-invitation`) reads and writes `sys_invitation` through the identity
adapter under a system context, so the invitation lifecycle and the console's
accept page — which use those endpoints, not the data API — behave exactly as
before. Owners and admins are unchanged, in both the wall-enforcing
(`organization_admin`) and wall-less (`organization_admin_no_bypass`)
variants. Platform admins are unchanged.

**You may notice** that a principal who is neither owner nor admin no longer
sees other people's invitations on a generic `sys_invitation` grid — including
the Setup app's Invitations page and the Organization record's Invitations tab
if a non-admin reaches them. That is the fix, not a regression. A deployment
that genuinely wants a wider invitation read should declare it on an
application permission set rather than rely on the managed-object baseline.
