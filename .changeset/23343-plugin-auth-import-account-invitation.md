---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth): the identity import invites with `auth.account_invitation`, not the password-reset email

Clause-②: yes (widening)

A user created through Setup › Users › Import (`POST /api/v1/auth/admin/import-users`) and invited by email now receives the new `auth.account_invitation` template from `@objectstack/plugin-email`.

- **FROM → TO for an imported user's email.** FROM `auth.password_reset` ("We received a request to reset the password … If you didn't request this, ignore this email"), although the user requested nothing. TO `auth.account_invitation`: the administrator who ran the import (name and email, as their user record holds them), the new account's address, a "Set your password" link, and the link's real expiry. The link is the same one as before: it lands on the Console's set-password page, and its token is the same better-auth reset token.
- **Every other password reset is unchanged.** A user who asks for a reset (`POST /api/v1/auth/request-password-reset`) still receives `auth.password_reset`, whether or not they were imported. Only the import's own request sends the invitation: the import marks that one request on the server, and nothing a client sends can set the mark. `auth.invitation` (an invitation into an organization) is unchanged.
- **If you customized `auth.password_reset` for imported users,** move that wording to `auth.account_invitation`: imported users no longer receive `auth.password_reset`.
- **The stated expiry is the token's real lifetime.** better-auth gives the token `emailAndPassword.resetPasswordTokenExpiresIn` seconds, or 3600 when that is unset or `0`. A configured `0` used to make the reset email say "expires in 0 minutes"; it now says 60, as the token does, and so does the invitation.
