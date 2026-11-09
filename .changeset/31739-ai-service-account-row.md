---
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

feat(auth): an AI service account is a `sys_user` row of kind `agent` that never signs in (ADR-0151 D1, D2)

Clause-②: yes
Metadata-protocol: none

`sys_user` gains two columns. `principal_kind` is `human` (the default, and what every existing row reads as) or `agent`, an AI service account. `accountable_user_id` names the person accountable for an AI service account. Both are system-managed: the generic data path never writes them.

Rules that hold for every writer, the system included:

- A user is created with its kind and the kind never changes. An update that turns a person into an AI service account, or the reverse, is refused `400 VALIDATION_FAILED` on `principal_kind`.
- An AI service account names an existing person as its accountable owner; a person names none. Creating or updating a row against that is refused `400 VALIDATION_FAILED` on `accountable_user_id` (`required`, `reference_not_found` or `invalid_value`).
- An AI service account never holds a session: password, magic link, one-time code, passkey, social and SSO sign-in, impersonation and every server-minted session are refused `403 PERMISSION_DENIED`. It never holds a password or a sign-in provider link either.
- The membership reconciler and the one-time membership backfill never bind an AI service account (`reconcileMembership` answers the new outcome `agent-account`).

Nothing registers an AI service account yet: the registration, key and lifecycle doors, and the account's own authority under the agent ceiling, follow in later changes. Every existing user, sign-in and membership behaves as before.
