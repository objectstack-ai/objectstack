---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an account with an enrolled second factor is signed in by no one-time code or sign-in link alone

Clause-②: no (narrowing) — the one-time-code and link doors (`/phone-number/verify`, `/magic-link/verify`, and `/verify-email` when it signs the user in) answer an account with an enrolled second factor with the two-factor challenge password sign-in gives, and issue its session only after the second factor. No request, response or metadata shape is added, removed or re-shaped; an account with no enrolled factor signs in at these doors exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What moves is which answer an enrolled account gets at three sign-in doors, the existing two-factor challenge, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** sign-in narrowing at the one-time-code and link doors (`@objectstack/plugin-auth`): a code or link door asks an enrolled account for its second factor, as password sign-in does.

- **Now.** For an account with an enrolled second factor, `POST /phone-number/verify`, `GET /magic-link/verify` and `GET /verify-email` (with `emailVerification.autoSignInAfterVerification`) answer `{ "twoFactorRedirect": true, "twoFactorMethods": [...] }` with the pending two-factor cookie and no session, as `POST /sign-in/email` does; on the link doors' `callbackURL` redirect lane no session is issued either. The session is issued by `/two-factor/verify-totp`, `/two-factor/verify-otp` or `/two-factor/verify-backup-code`, and a valid trust-device cookie skips the challenge as it does at password sign-in. A call that issues no new session is unchanged: `/phone-number/verify` with `disableSession: true` or `updatePhoneNumber: true`, and `/verify-email` for a caller already holding the session it answers with.
- **Who moves.** A client of a code or link door that signs in an account with an enrolled second factor: it now completes the two-factor challenge (read `twoFactorRedirect`, then verify the second factor) before it holds a session. Accounts with no enrolled factor, and deployments with two-factor off, change nothing.

**Fails closed on vendor drift.** Building the auth instance throws when the installed two-factor plugin no longer exposes the password sign-in challenge these doors reuse, rather than starting with the doors open to a code or link alone.
