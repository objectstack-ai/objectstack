---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): Create User with no email answers the field-level refusal, so a client can mark the Email input and word it in its own language (#28289)

Clause-②: yes (widening: the refusal gains `error.fields`, one `{ field, code, message }` entry per input that would satisfy it, code `required`; its `error.code` moves from `INVALID_REQUEST` to `VALIDATION_FAILED`, the code the same endpoint's permission-set refusal and the data doors already answer with `fields`)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: one refusal of `POST /api/v1/auth/admin/create-user` answers an existing code from the plugin's ledger row with the existing `fields` envelope. Nothing an author writes changes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** wire answer of one refusal at `POST /api/v1/auth/admin/create-user` (`@objectstack/plugin-auth`).

- **Before.** With neither an email nor a phone number, the endpoint answered `400` `{ code: 'INVALID_REQUEST', message: 'Email is required' }` ("Email or phone number is required" where phone sign-in is on). The code is the endpoint's generic one, so a client could only show the English sentence.
- **Now.** The same `400` answers `{ code: 'VALIDATION_FAILED', message, fields }`. `fields` holds `{ field: 'email', code: 'required', message }`, plus `{ field: 'phoneNumber', code: 'required', message }` where phone sign-in is on. The English message is unchanged.
- **Unchanged.** Every other refusal of the endpoint keeps `INVALID_REQUEST` and its message: a malformed email, a phone number without phone sign-in, a malformed phone number, a `permissionSet` that is not a name, the password rules. A valid Create User still succeeds.
- **Supersedes** the line "The status (400) and code (`INVALID_REQUEST`) are unchanged" in this release's earlier Create User changeset: the status is still 400, and the code is now `VALIDATION_FAILED`.
- **Who sees it.** A client that read `INVALID_REQUEST` for this one refusal. The console shows the refusal's message as before; marking the Email input from `fields` is the console's own follow-up.
