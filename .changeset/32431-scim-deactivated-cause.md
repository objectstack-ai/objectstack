---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

fix(plugin-auth): a password sign-in refused because the identity provider deactivated the account says so in `details.cause`

Clause-②: yes
Metadata-protocol: none

A SCIM `active: false` (or `DELETE /Users/{id}`) disables the account with the platform's ban, and the next password sign-in was refused `403 BANNED_USER` with better-auth's "You have been banned…" text, the same answer an administrator's ban gets. A client could not tell an organization's deactivation from a disciplinary ban. `POST /api/v1/auth/sign-in/email` now answers that refusal with `details: { cause: 'scim_deactivated' }` beside the unchanged status, code and message, when the ban is the one the SCIM deactivation placed (the same ban an `active: true` lifts). An administrator's ban answers exactly as before, with no `details`; a wrong password is still the ordinary `401 INVALID_EMAIL_OR_PASSWORD`. Whether the account may sign in is unchanged.

`BANNED_USER` is now registered in `ERROR_CODE_LEDGER` under `@objectstack/plugin-auth`, which stamps it on this refusal.

Clients: branch on `code === 'BANNED_USER'` and `details?.cause === 'scim_deactivated'`, never on the message. Nothing to migrate.
