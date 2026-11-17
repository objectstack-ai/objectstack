---
'@objectstack/plugin-auth': patch
'@objectstack/verify': patch
'@object-ui/app-shell': patch
---

fix(plugin-auth)!: accepting, declining and listing an organization invitation need a verified email address on every deployment, and an invitation sign-up joins by accepting once verified

Clause-②: no (narrowing) — narrowed: from a session whose email address is not verified, `POST /api/v1/auth/organization/accept-invitation` and `POST /api/v1/auth/organization/reject-invitation` answer `403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION` and `GET /api/v1/auth/organization/list-user-invitations` answers `403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION`, on every deployment, whatever the state of its mail transport; nothing is accepted or declined and no membership is written. Under the `invite_only` posture with `membershipPolicy: 'auto'`, a sign-up admitted by the invitation it presents is not bound to the Default Organization while its address is unverified; it joins by accepting the invitation. The codes are better-auth's own. The `sys_invitation` actions **Accept Invitation** and **Decline Invitation** post to those routes and answer the same.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches accepting an organization invitation or invitation sign-up; `content/docs/deployment/self-hosting.mdx` gains the rules in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answers are runtime refusals at three organization invitation routes and a membership the sign-up seam does not write for an unverified invitation sign-up, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment whose people answer invitations with an address that is not verified: email verification off (the default under `invite_only`, or declared off under `open`), no live mail transport, or a social or SSO provider that does not verify the address.

- Accepting, declining and listing an organization invitation require a verified email address, on every deployment. A password account verifies by the verification mail; an account a social or SSO provider made counts only when the provider verified the address. The invitation's id, which its accept link and a copied link carry, is no proof of the mailbox, and no setting relaxes the rule.
- Reading one invitation by its id (`GET /api/v1/auth/organization/get-invitation`) stays open, so the accept page can show it.
- Under `invite_only` with `membershipPolicy: 'auto'`, an account a sign-up admitted by the invitation it presents is not bound to the Default Organization while its address is unverified. Its membership comes from accepting the invitation once the address is verified, with the role the invitation carries, or from a platform administrator.
- A deployment without a live mail transport cannot onboard a password account by invitation link; an invitee whose social or SSO provider verifies the address can still accept a copied link there.

Unchanged: the invitation mail's own link, which carries a proof of the mailbox and accepts in one step (`POST /api/v1/auth/organization/accept-invitation-one-step`); a verified account, which accepts, declines and lists its invitations as before; the first account of a deployment, accounts an administrator creates and accounts a boot command provisions, which are bound as before; sending, resending and cancelling invitations.

The Console's accept-invitation page answers a refused decline with the verification-mail screen for the account's address, as it answers a refused accept, and that screen's link brings the person back to answer the invitation.

`@objectstack/verify`: a booted stack's `signUp` mints its fixture member through the operator door (the ticket the stack's own auth manager stages for that address), so the account is bound at creation as before; a stack whose auth service offers no such door falls back to the invitation lane.

What to do: an invitee completes the verification mail (`POST /api/v1/auth/send-verification-email`, then the link it carries) before answering, or opens the invitation mail's own link. On a deployment with no live mail transport, a platform administrator creates the account (`POST /api/v1/auth/admin/create-user`) or attaches an account that already exists with the member list's **Add Member** action, which is open to platform administrators only and attaches existing accounts only.
