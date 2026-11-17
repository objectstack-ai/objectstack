---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: accepting an organization invitation requires a verified email address

Clause-②: yes (narrowing) — narrowed: `POST /api/v1/auth/organization/accept-invitation` and `POST /api/v1/auth/organization/reject-invitation` answer `403 EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION` to a session whose email address is not verified, and `GET /api/v1/auth/organization/get-invitation` and `GET /api/v1/auth/organization/list-user-invitations` answer it `403 EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION`; nothing is accepted or declined and no membership is written. The codes are better-auth's own. The `sys_invitation` actions **Accept Invitation** and **Decline Invitation** post to those routes and answer the same. The boot warning for the `open` posture with verification declared off says that an invitation to an unverified address waits for the address to be verified.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches accepting an organization invitation; `content/docs/deployment/self-hosting.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped. The moved answers are runtime refusals at four organization invitation routes for a session whose address is not verified, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment whose invitees sign in with an address that is not verified: email verification off (the default under the `invite_only` posture, or declared off under `open`), or a social or SSO provider that does not verify the address. Accepting an organization invitation requires a verified email address. A password account verifies by the verification mail; an account a social or SSO provider made counts only when the provider verified the address. The invitation's id, which its accept link and a copied link carry, is no proof of the mailbox. No setting relaxes the rule.

Unchanged: the invitation mail's own link, which carries a proof of the mailbox and accepts in one step (`POST /api/v1/auth/organization/accept-invitation-one-step`), and that door's signed-in mode, which already asks for a verified address; a verified account, which accepts, declines, reads and lists its invitations as before; sending, resending and cancelling invitations.

What to do: an invitee completes the verification mail (`POST /api/v1/auth/send-verification-email`, then the link it carries) before accepting, or opens the invitation mail's own link. On a deployment with no mail transport, a platform administrator adds the person to the organization with the member list's **Add Member** action instead of an invitation.
