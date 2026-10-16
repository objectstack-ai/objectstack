---
'@objectstack/plugin-email': minor
---

feat(plugin-email): a built-in `auth.account_invitation` email template, for an account an administrator created, in four locales

Clause-②: yes (widening)

A new built-in template, `auth.account_invitation`, ships in `en-US`, `zh-CN`, `ja-JP` and `es-ES`. It is registered like the other built-in auth templates, so it is listed and resolved the same way, and a Studio save overrides it for an environment.

- **When it is sent.** `@objectstack/plugin-auth` sends it when an administrator creates an account for someone and emails them a link to set their first password. Today that is the identity import (Setup › Users › Import, `POST /api/v1/auth/admin/import-users`).
- **What an imported user receives, FROM → TO.** FROM the password-reset email ("We received a request to reset the password … If you didn't request this, ignore this email"). TO an invitation that names who created the account, the account's address, a "Set your password" link and when that link expires.
- **Its variables.** `user.name` (optional), `user.email`, `inviter.name`, `inviter.email`, `setPasswordUrl`, `expiresInMinutes`, and `appName` (optional). Every one except the two optional ones is required, so a send without one is refused with `MISSING_VARIABLES` rather than half-rendered. It names no organization and no role: an imported user may have neither.
- **Exports.** `AUTH_ACCOUNT_INVITATION_TEMPLATE`, its three locale rows (`_ZH_CN`, `_JA_JP`, `_ES_ES`) and the list `AUTH_ACCOUNT_INVITATION_TEMPLATES`. `BUILTIN_AUTH_TEMPLATES` grows from 24 rows to 28.
- **Unchanged.** `auth.invitation` (an invitation into an organization) and `auth.password_reset` render byte for byte as before, in every locale.
