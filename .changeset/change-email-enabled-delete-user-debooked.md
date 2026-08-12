---
"@objectstack/plugin-auth": minor
---

feat(plugin-auth): `POST /auth/change-email` works — better-auth's `user.changeEmail` is configured, with verification (#7735)

`auth.changeEmail()` answered **400 `CHANGE_EMAIL_DISABLED`** on every
deployment. better-auth ships the capability off and `plugin-auth` never
configured it, so there was no product switch to flip — while
`auth-route-ledger.ts` booked the route as a live SDK surface. The route table
was right about the product and wrong about the runtime.

`user.changeEmail.enabled` is now set, and the change is **confirmed by email**
before it applies:

1. `POST /api/v1/auth/change-email { newEmail }` mints a verification token and
   sends it to the **new** address, through the same
   `emailVerification.sendVerificationEmail` callback (and `auth.verify_email`
   template) that sign-up verification uses. Nothing is written yet — an
   unconfirmed request leaves the identity untouched.
2. `GET /api/v1/auth/verify-email?token=…` applies it: the address changes,
   `email_verified` becomes true, and the session cookie is re-issued on the new
   identity.

Two better-auth options are deliberately left at their defaults, because each is
a policy in its own right: `updateEmailWithoutVerification` (would let a user
whose current address is unverified swap emails with no confirmation at all) and
`sendChangeEmailConfirmation` (better-auth's opt-in extra step asking the OLD
address to approve first).

**A deployment with no email transport** now answers 400 *"Verification email
isn't enabled"* instead of `CHANGE_EMAIL_DISABLED` — a fixable configuration
statement rather than "the platform does not offer this". Wire an email service
(`setEmailService`, or register the kernel `email` service) to enable the flow.

**Self-service account deletion stays off, and now says so.**
`POST /auth/delete-user` is published by better-auth's catch-all but
`user.deleteUser` is deliberately not configured, so it answers 404 (as does its
`GET /auth/delete-user/callback` half). Its route-ledger row is re-booked from
`sdk` to the new `disabled` disposition carrying that reason, so the ledger no
longer advertises a dead route. `client.auth.deleteUser()` is unchanged and
still reaches the endpoint — it is refused there, as it was before this release.
Self-service deletion in a B2B tenancy touches record ownership and tenant data,
and needs a deliberate design; nothing about its behaviour changes here.
