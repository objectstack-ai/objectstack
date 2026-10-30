---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

feat(plugin-auth): an invite says whether its mail was delivered, and a pending invitation's link can be copied from Setup → Invitations

Clause-②: yes (widening)
Metadata-protocol: none

On a deployment that does not deliver mail (the stock `log` transport, or no email service at all), inviting someone used to toast "Invitation sent to …" while nothing left the server, and nothing offered the accept link, so the invitee never arrived.

- `POST /api/v1/auth/organization/invite-member` (invite and resend) now answers a top-level `outcome` beside the invitation row: `sent` when the deployment delivers mail, `link_only` when it does not. It is decided at call time by the same rule sign-up uses, the email service's own `isConfigured()` answer, so a wired `log` transport is not delivery. The row's columns are unchanged.
- The four `invite_user` actions (Users, Members, Invitations, the organization page) and `resend_invitation` declare `outcomeMessages`: the `link_only` message says the invitation was created and no email went out, and points to Copy Invite Link. `successMessage` stays the fallback.
- New action `sys_invitation.copy_invitation_link` (Copy Invite Link, on the invitation row and record header): answers `{ acceptUrl }`, the same link the invitation mail carries, in a copyable result dialog. The link admits whoever opens it, so the server answers it only to an owner, admin or delegated admin of the invitation's organization, only for a pending invitation, and never while the environment is cloud-managed (`409 RESOURCE_CONFLICT`); it is never logged.
- `PUBLIC_AUTH_FEATURES` books the new action under the `organization` and `cloudManaged` gates.
