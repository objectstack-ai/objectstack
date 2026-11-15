---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: a locked account is refused on every door that ends in a session for it

Clause-②: no (narrowing) — while an account's lock holds (ADR-0069 D2, `lockoutThreshold` on), every door that ends in a session for that account refuses it with the answer password sign-in gives under the deployment's `lockoutRefusal`, and every password door counts its refused attempts toward that one lock and checks it before the password. No request, response or metadata shape is added, removed or re-shaped; an unlocked account, an expired lock and a deployment with the lockout off sign in exactly as before.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. What moves is which answer a locked account gets at the sign-in doors, the existing lockout refusal, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** sign-in narrowing for locked accounts (`@objectstack/plugin-auth`): a locked account is refused on every door that ends in a session for it, with the answer password sign-in gives.

- **Now.** While the lock holds, `POST /phone-number/verify`, `GET /magic-link/verify` (JSON and `callbackURL` lanes), `GET /verify-email` when it signs the caller in, and the second-factor step (`/two-factor/verify-totp`, `/two-factor/verify-backup-code`) issue no session and answer as `POST /sign-in/email` does: `403 ACCOUNT_LOCKED` under `lockoutRefusal: 'explicit'`, `401 INVALID_EMAIL_OR_PASSWORD` otherwise. `POST /sign-in/phone-number` checks the lock before the password and answers a locked account the same whatever password it is sent: `403 ACCOUNT_LOCKED` under `'explicit'`, that door's own wrong-password answer (`401 INVALID_PHONE_NUMBER_OR_PASSWORD`) otherwise. Its wrong passwords count toward the account's one lock and a correct one resets the count, as at `/sign-in/email`. Each refused attempt writes its `login_failed` row with the reason `ACCOUNT_LOCKED`. An administrator's impersonation, a signed-in account's own new session (enrolling a second factor, a password change that ends the other sessions) and the server's in-process principal session are not sign-ins and are unchanged.
- **Who moves.** A client that signs an account in through a one-time code, a sign-in link, the second-factor step or the phone-number password door: while the account is locked it now receives the lockout refusal, and phone-number password failures now lock the account after `lockoutThreshold` attempts. An administrator clears a lock early with the **Unlock** action, as before.
