---
"@objectstack/plugin-auth": patch
---

fix(auth): an invitation is written in the invitee's own `sys_user.locale` when the address already holds a row, and keeps the deployment default when it does not (#14641)

The four auth sends whose requester IS the recipient gained a per-recipient
language rung in #14762 (`sys_user.locale`, ruled on #13881). The two
**invitation** sends did not, and the recorded reason was structural rather
than an oversight: an invitee generally has no `sys_user` row until they accept,
so there is no stored language to read, and the *inviter's* `Accept-Language` is
the wrong authority — an English-speaking admin would silently send English
invitations to a Chinese-language workspace's new hires.

That reason covers only one of the two populations an invitation reaches. This
change gives both invitation sends the same top rung the other four already
read, on a **two-branch** shape:

1. the address (or phone number) **already carries** a `sys_user` row whose
   `locale` is set — an existing platform user invited into a second
   organization, or a re-invitation — that row's `locale` wins;
2. a genuinely **new** invitee with **no** row keeps the deployment default,
   because their language is still truly unknown at invitation time. So does an
   invitee whose row exists but names no language: an unset column is not a
   choice.

⛔ The inviter direction stays rejected on both branches, and is now pinned
against a manager that has the top rung wired rather than against one with no
rung at all. #13881's ruling item 3 fixes the chain as **recipient** locale →
deployment default; what opened here is the invitee's own column, never the
inviter's header.

**Both branches are reachable, measured rather than assumed.**
`sendInvitationEmail`: better-auth's `create-invitation` route rejects only an
address that is already a member of *this* organization
(`USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION`, `routes/crud-invites.mjs` in
the installed 1.7.2), so an existing account invited elsewhere — and the
`resend` branch — reach the callback normally. `sendPhoneInviteSms` reaches a row by
construction: its one in-repo caller, the identity import endpoint's `invite`
policy, **creates** the account and only then sends the SMS.

⚠️ **What the SMS path yields today, stated precisely, because a changeset
becomes release notes.** The rung is wired there and reads the row whenever the
row carries a locale — but `admin-import-users.ts` never writes `locale` (0
occurrences; positive control: `sendInviteSms` appears twice in the same file),
and `sys_user.locale` declares no column default. So on the only in-repo caller
the column is empty at send time and the invitation SMS still resolves to the
**deployment default** — the pre-change behaviour, unchanged for that flow. What
this buys on that surface is the rung itself: an out-of-repo caller, or a future
import that populates `locale`, is read rather than ignored. The behaviour users
see change today is on the invitation **email**.

**Matching is exact, and that is safe rather than merely tolerable here.**
better-auth lowercases the invitee address on the invite route and the stored
`user.email` on sign-up, so both sides of the predicate are already in the same
case; `email` and `phone_number` are both `unique: true` in the `user` table
`sys_user` is backed by. An address that resolves no row lands on the deployment
default, which is the documented floor rather than a failure — and, as
everywhere else on this ladder, a failing recipient read never blocks a send.

**Docs.** `permissions/authentication.mdx` said "The **invitation** SMS reads
the deployment default alone"; that sentence is now false and is corrected. No
shipped page states the invitation *email* locale rule (the auth email ladder is
undocumented as a whole), so nothing else moved.
