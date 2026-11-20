---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-email': patch
'@objectstack/core': patch
'@objectstack/cli': patch
---

fix(plugin-auth)!: a password reset ends what the account added before it

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value, metadata type or export shape is added, removed, renamed or re-shaped, and no stored row is rewritten by a migration: what moves is what the auth doors end when a password is reset or first set, and the answer they give a link minted before it, which is now the answer a link that was never issued gets. The forced reset response gains one count. There is nothing for a migration to rewrite and no tombstone. -->

A password reset ends what the account added before it, and a password change reminds the account what it keeps.

- **A completed self-service reset** (the emailed link at `POST /api/v1/auth/reset-password`, the texted code at `POST /api/v1/auth/phone-number/reset-password`) now ends, beside the account's sessions, every API key the account owns (revoked as one its owner revoked, so the owner may restore it from the API Keys list) and every sign-in account linked to it other than its password (a social, OAuth or single sign-on link; the provider may be linked again as it was the first time). This build offers no passkey sign-in, so there are no passkeys to end. A reset that does not complete ends nothing.
- **A password change** (`POST /api/v1/auth/change-password`) ends none of these. When the account still holds an API key or a linked sign-in account afterwards, the account's address is sent the new built-in template `auth.password_changed_notice`, naming each, through the email service. It is best-effort and never fails the change. plugin-email ships it in `en-US`, `zh-CN`, `ja-JP` and `es-ES`, so `BUILTIN_AUTH_TEMPLATES` grows from 32 rows to 36, and core's `PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE.email_template` names it beside the other eight, so it resolves environment-wide and keeps one overriding package per deployment.
- **An administrator's forced reset** (`POST /api/v1/auth/admin/set-user-password` with `revokeSessionsAndKeys` on, the default) and the operator's `os user set-password` also unlink every linked sign-in account; the forced reset's response reports it as `revoked.signInAccounts`, and the operator command prints it. `revokeSessionsAndKeys: false` still ends nothing.
- **An account's first password counts as a password change when it is set onto an account that was already there**: through either reset door, an administrator's `set-user-password`, the one-step invitation acceptance of an existing account, or `POST /api/v1/auth/set-initial-password`. So links and challenges issued before it end, exactly as they do for any other password change. A password created together with its account, as at a sign-up with a password, an administrator's create-user or an import, is still not a change.
- **A verification link that signs its holder in** (on a deployment with `emailVerification.autoSignInAfterVerification: true`) and **a magic link**, minted before the account's password changed, now answer what a link that was never issued answers: `401 INVALID_TOKEN` or the `error=INVALID_TOKEN` redirect at `GET /api/v1/auth/verify-email`, and the `error=INVALID_TOKEN` redirect with no session at `GET /api/v1/auth/magic-link/verify`. With auto sign-in off, a verification link still verifies the address. A link minted after the change works as usual.

**BREAKING** for a client or integration that keeps using what a reset now ends: an API key the account owned before a completed password reset is refused as an unknown key, a linked sign-in account is no longer linked, and a verification link that signs in or a magic link minted before the account's password changed answers as a never-issued link. The fix: mint a new key after the reset (or restore the old one from the API Keys list), link the provider again, or request a new link.
