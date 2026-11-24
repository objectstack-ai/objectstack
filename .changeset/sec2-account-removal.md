---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(plugin-auth)!: a disabled or removed account keeps nothing running in its name

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. What moves is what four identity doors end and refuse: the ban, the directory's deactivation and delete, and an administrator's delete end what a password reset ends of the account's registrations, and the AI service account doors refuse an owner whose account is disabled. No stored row, registry key or authored value needs rewriting, so there is nothing for a migration to change and no tombstone. -->

**The rule.** An account that is disabled or removed, by any door, keeps nothing running in its name. What it is accountable for is suspended, what it registered is disabled, what it minted is revoked, and turning the account back on restores none of it.

- **A platform administrator's ban** (`POST /api/v1/auth/admin/ban-user`) suspends every AI service account the person is accountable for, in every organization, with the reason `Accountable owner banned by an administrator`; disables every OAuth application the account registered; and revokes every SCIM provisioning credential it minted, each revoke recorded in `sys_audit_log` against the administrator. The answer reports it under `data.revoked` (`serviceAccounts`, `ownedApps`, `scimCredentials`, `failed`, `complete`), as the administrator's forced reset reports its own, and the ban's audit row carries the same counts. A step that cannot finish does not undo the ban: `complete` is `false`, and banning again ends what remains.
- **The directory** (SCIM `active: false`, `DELETE /Users/{id}`) disables the OAuth applications the person registered and revokes the SCIM credentials they minted, each revoke recorded against the connection (`actor` `svc:scim:CONNECTION_ID`). It never fails the SCIM request; a revoked credential is reported once in the server log at `error`, with the remedy.
- **An administrator's delete** (`POST /api/v1/auth/admin/remove-user`) ends the same registrations before the user is deleted, inside the delete's unit of work, and answers `{ success: true, revoked: { ownedApps, scimCredentials } }`. When one cannot be ended, the delete is refused `503 SERVICE_UNAVAILABLE` and nothing changes.
- **An AI service account runs only while its accountable owner's account is active.** `register` and `set-owner` refuse an owner who is banned or deactivated (`400 VALIDATION_FAILED` at `ownerId`), and `resume` refuses an account whose owner is (`409 RESOURCE_CONFLICT`), whichever door disabled them.
- An unban or a re-activation restores none of it: a platform administrator enables an application again, a new credential is minted, and an administrator resumes an AI service account once its owner's account is active again or a new owner is named. A timed ban leaves the accounts suspended after it expires. Single sign-on providers the account registered are kept, as a password reset keeps them.

The Ban action's confirmation and its AI-facing description, and the Unban action's AI-facing description, now state these effects.

**BREAKING** for:

- a caller that names, as an AI service account's owner, a person whose account is banned or deactivated: the door refuses it. Name a person whose account is active.
- an operator who relied on a banned, deactivated or removed administrator's SCIM credential: it is revoked, and provisioning through its connection pauses until another administrator mints a new credential. Rotate a connection's credential to another administrator before removing the one who minted it.
- a client that read the ban's answer or the delete's answer as an exact shape: each gains `revoked`.
