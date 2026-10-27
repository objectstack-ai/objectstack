---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: security explain refuses a `userId` that no `sys_user` record has with `404 RECORD_NOT_FOUND`, naming the id, instead of explaining the baseline principal the resolver builds for any id

Clause-②: no (narrowing) — `POST` / `GET /security/explain` and the in-process `explain()` refuse a request naming another user whose id no `sys_user` record has, which they answered with a verdict before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the explain request's userId keeps its shape, and an id that names nobody is now refused instead of explained. A verdict about nobody had no meaning to keep, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the access-explanation door (`@objectstack/plugin-security`), served at `/security/explain` on both transports.

- **Before.** An administrator explaining another user by an id that no `sys_user` record has (a typo, a deleted user, an id from another deployment) was answered `200` with a full verdict, usually `allowed: true`: the authorization resolver gives any id the baseline position and permission sets. `GET /data/sys_user/ID` answered 404 for the same id.
- **Now.** That request is refused `404 RECORD_NOT_FOUND`, and the message names the id. The id is read through the same `sys_user` existence read the on-behalf-of delegator path uses.
- **Unchanged.** The order of checks: an anonymous caller is refused 401, and a caller who may not explain others gets the same 403 `PERMISSION_DENIED` whether the id exists or not, before any existence read. Explaining yourself (no `userId`, or your own) and explaining a user who exists answer as before.
- **Who sees it.** A caller holding `manage_users` (or a system caller) who names an id that does not exist. An organization administrator or a delegated administrator naming such an id still gets the 403: no membership or scope covers a user who does not exist.

**The remedy.** None needed: pick the user from the directory, or check the id.
