---
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
---

fix(plugin-auth)!: a locked account is refused on every door that ends in a session for it

Clause-②: no (narrowing) — while an account's lock holds (ADR-0069 D2, `lockoutThreshold` on), every door that ends in a session for that account refuses it with the answer password sign-in gives under the deployment's `lockoutRefusal`, and every password door counts its refused attempts toward that one lock and checks it before the password. No request, response or metadata shape is added, removed or re-shaped; an unlocked account, an expired lock and a deployment with the lockout off sign in exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What moves is which answer a locked account gets at the sign-in doors, the existing lockout refusal, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** sign-in narrowing for locked accounts (`@objectstack/plugin-auth`): a locked account is refused on every door that ends in a session for it, with the answer password sign-in gives.

- **Now.** While the lock holds, every door that ends in a new session for the account issues none and answers as `POST /sign-in/email` does: `403 ACCOUNT_LOCKED` under `lockoutRefusal: 'explicit'`, `401 INVALID_EMAIL_OR_PASSWORD` otherwise. That is `POST /phone-number/verify`; `GET /magic-link/verify` (JSON and `callbackURL` lanes); `GET /verify-email` when it signs the caller in, an address-change confirmation opened without a session included; the second-factor step (`/two-factor/verify-totp`, `/two-factor/verify-otp`, `/two-factor/verify-backup-code`); sign-in through an identity provider (social and generic-OAuth callbacks and the ID-token sign-in, enterprise SSO over OIDC and SAML); and the device grant (`POST /device/token`). `POST /sign-in/phone-number` checks the lock before the password and answers a locked account the same whatever password it is sent: `403 ACCOUNT_LOCKED` under `'explicit'`, that door's own wrong-password answer (`401 INVALID_PHONE_NUMBER_OR_PASSWORD`) otherwise. Its wrong passwords count toward the account's one lock and a correct one resets the count, as at `/sign-in/email`. Each refused attempt writes its `login_failed` row with the reason `ACCOUNT_LOCKED`. Not sign-ins, and unchanged: an administrator's impersonation, a new session for the account whose live session of record made the request (enrolling a second factor, a password change that ends the other sessions), and the server's in-process principal session. A session for a locked account made any other way is refused.
- **Who moves.** A client that signs an account in through a one-time code, a sign-in link, an address-change confirmation without a session, the second-factor step, an identity provider, the device grant or the phone-number password door: while the account is locked it now receives the lockout refusal. That includes accounts with no password at all, which the lock now reaches on doors that never asked for one, and phone-number password failures now lock the account after `lockoutThreshold` attempts. An administrator clears a lock early with the **Unlock** action, as before.

`@objectstack/runtime`: the dispatcher error-vocabulary ledger classifies the `INVALID_EMAIL_OR_PASSWORD` stamp in `@objectstack/plugin-auth` as better-auth's own vocabulary; no behaviour changes.
