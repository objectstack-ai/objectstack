---
'@objectstack/plugin-auth': minor
'@objectstack/spec': minor
---

fix(plugin-auth): `POST /api/v1/auth/organization/invite-member` refuses a role outside the membership vocabulary with `code: 'ROLE_NOT_FOUND'`

Clause-②: yes (widening)

- **Before.** An invitation naming a role outside the closed membership vocabulary was refused `400` with only a message (`ROLE_NOT_FOUND: <role>`) and no `code`, so a client that branches on `error.code` (ADR-0112) could not recognise it. `update-member-role` already answered the same refusal with `code: 'ROLE_NOT_FOUND'`.
- **Now.** invite-member answers `400` with `code: 'ROLE_NOT_FOUND'` and the same message, naming the role, the body `update-member-role` gives for the same condition. The refusal still happens before any invitation row is written. This is the answer the invitation schema's `role` docstring and the authentication docs already promise.
- **The ledger.** `ROLE_NOT_FOUND` is registered under `@objectstack/plugin-auth` in the error-code ledger, so `ErrorCode` (and `ApiErrorSchema.code`) admits it.
- **Unchanged.** A valid role invites as before, and every other refusal on invite-member keeps its answer.
