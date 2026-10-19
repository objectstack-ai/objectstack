---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the invitation role cap's refusals on `POST /organization/invite-member` carry an error code, and a membership read that fails answers `503` instead of a refusal

Clause-②: no

The role cap in `beforeCreateInvitation` refused with `403` and a message but no `code`, while better-auth's own `owner` refusal on the same endpoint carries one. A client, the console's Invite User dialog among them, could not tell the refusals apart without reading English prose. Each refusal now carries the code the error-code ledger registers for it under `@objectstack/plugin-auth`, in the same `{ message, code }` body:

- `INVITE_ROLE_ABOVE_ISSUER`: the requested role grades above the issuer's own, for example a `delegated_admin` inviting as `admin`.
- `INVITE_ISSUER_MEMBER_ONLY`: an issuer below admin grade asked for a role other than a plain `member`, for example a `delegated_admin` inviting as `delegated_admin`.
- `INVITE_ISSUER_UNVERIFIED`: fail-closed. The issuer's membership role was not established: the read found no usable `sys_member` row, or the `AuthManager` has no data engine to read from.

A membership read that throws is a store outage, not a verdict about the issuer. It used to answer the same `403` as an unverified issuer. It now answers `503` with the code `SERVICE_UNAVAILABLE`, as the organization slug guard does for its own read faults. No invitation is created either way.

Unchanged: which invitations are admitted, the status of every refusal (`403`), better-auth's own `owner` refusal, and the exports.
