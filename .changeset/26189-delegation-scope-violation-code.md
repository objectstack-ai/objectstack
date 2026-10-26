---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/plugin-auth': patch
---

feat(plugin-security,spec,plugin-auth)!: a delegated admin's write outside their own scope answers `403 DELEGATION_SCOPE_VIOLATION` with the gate's reason

When a delegated administrator's write on `sys_user_position` or `sys_user_permission_set` fell outside their own `adminScope`, the delegated-administration gate knew exactly why ("business unit … is outside the delegated subtree", "… is not in the scope's allowlist"), but threw it as a plain `403 PERMISSION_DENIED`. A client could not tell it from a denial whose reason must stay hidden, so the console showed only its fixed "no permission" line.

Clause-②: yes (widening: the ADR-0112 ledger registers `DELEGATION_SCOPE_VIOLATION` under `@objectstack/plugin-security`)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the error code three of the gate's refusal reasons answer with: every write that was refused is still refused, with the same 403 status and the same reason, and every write that was admitted is still admitted. The remedy is on the consumer's side, reading `code`; never a rewrite of a package source or a stored row. The other categories are closed on facts: all three packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (a wire-answer change), shipped as `patch`: no metadata protocol kind moves.

- **`@objectstack/plugin-security`.** Three reasons describe the caller's own delegated scope: a business unit outside the delegated subtree (the new row's or the existing row's), a permission set not in the scope's allowlist (one the position distributes, or one granted directly), and a target user outside the subtree. They now throw `DelegationScopeViolationError`: status `403`, code `DELEGATION_SCOPE_VIOLATION`, and the message `[Security] Outside your delegated scope: delegated 'OP' on OBJECT rejected — REASON (scope from 'SET').` Every other refusal of the gate keeps `403 PERMISSION_DENIED`, unchanged: the audience anchor, principal-less writes, `sys_member` being tenant-only, the organization boundary, plain CRUD with no scope, filter writes, delegation of duty, a scope without `manageAssignments`, an unanchored assignment, adminScope containment, a stored grant whose set is unnamed or not in the catalog, a grant naming no target user, and a target user with no business unit.
- The message does not open with `[Security] Access denied`, which `mapDataError`, `isPermissionDeniedError` and the explain route read as `PERMISSION_DENIED`. The REST door (`mapDataError`) and the runtime dispatcher (`resolveThrownHttpError`) carry the new code as it was thrown.
- **`@objectstack/spec`.** One ADR-0112 ledger row, `DELEGATION_SCOPE_VIOLATION`, registered as its own meaning. It is not a synonym of `PERMISSION_DENIED`, and no waiver is needed.
- **`@objectstack/plugin-auth`.** The invitation door reads the new code as the gate's verdict too, so an invitation placed outside the issuer's scope still answers `403 INVITE_PLACEMENT_OUTSIDE_ISSUER_SCOPE`, not the `503` read-fault answer.
- For a client: a `403` with code `DELEGATION_SCOPE_VIOLATION` carries a message about the caller's own scope, which is safe to show. A `403 PERMISSION_DENIED` stays opaque. A client that matched `PERMISSION_DENIED` to catch these three refusals should also match the new code.
