---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the invitation carve-out stopped admitting past 200 pending invitations (#11770)

Under the `invite_only` audience posture that #11739 made the default, an
administrator could send an invitation and the invitee's account creation would
still be refused with `SELF_REGISTRATION_CLOSED` — silently, with no signal to
either party — as soon as the environment held more than 200 concurrently
pending invitations. A 500-employee onboarding is an ordinary way to reach that.

`AuthManager.hasPendingInvitationFor` answered "does this address hold a pending
invitation?" by reading at most 200 rows filtered only on `status = 'pending'`
and scanning them in memory for a case-insensitive email match. Past the first
page the invitee simply was not there, so the fail-closed `catch`-alike branch
applied the posture and refused a legitimate invitee.

The address now goes into the query — `sys_invitation.email` carries a declared
index — and the page chain is exhausted, so no row count can hide a live
invitation. A page is "pending invitations addressed to this one person", which
better-auth bounds by refusing a second pending invitation per organization, so
this is not a read of the environment's pending population on the sign-up path;
in practice it is a single indexed lookup where the old code always read 200
rows.

The in-memory scan existed on the stated belief that invitation addresses are
stored as the inviter typed them. Measured against the installed better-auth
1.7.1, that is wrong on both halves — `organization/invite-member` lowercases
the address before storing it, and `internalAdapter.createUser` lowercases the
registrant's before calling `validateUserInfo` — and the vendor's own
`findPendingInvitation` / `listUserInvitations` / `findMemberByEmail` all query
with `email.toLowerCase()`, so a mixed-case row was never redeemable through
`accept-invitation` anyway.

The row-side comparison is kept rather than deleted: `=` folds case on some
collations and folds accents with it, so every returned row is re-checked
against the normalized address — a case-only difference still matches, an
accent-only difference does not. Expiry stays in JS so a row with no readable
`expires_at` keeps reading as live. The security properties are unchanged:
`status = 'pending'` only, expiry still enforced, and an unanswerable probe
still means no carve-out.
