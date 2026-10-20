---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a delegated administrator's position assignment is judged on every permission set the assignment grants, the set of the position's own name included

Clause-②: no

- **The rule (ADR-0090 D12, as amended 2026-10-17).** The sets a position carries are every set an assignment of it grants: the names its definition's `permissionSets` lists and, while the authorization resolver folds held position names into the requested set names, the permission set of the position's own name when the catalog holds one. The organization-level branch already counted that set. The delegated branch now does too, through the same helper.
- **What a delegate is now refused.** A `sys_user_position` insert, update or delete by an `adminScope` holder whose allowlist does not cover the position's own-name set is refused `403 PERMISSION_DENIED`. The message names the set and says it is the set of the position's own name. An own-name set that carries an `adminScope` is held to strict containment like any other distributed set. A delegatable position whose own-name set carries an `adminScope` can no longer be self-delegated.
- **What the delegable-scope report offers.** `GET /api/v1/security/my-delegable-scope` no longer lists a position for a delegate whose allowlist misses that position's own-name set, so the picker offers only what the write admits.
- **Unchanged.** A position with no permission set of its own name is judged on its listed sets alone, as before. Tenant-level administrators and the organization-level branch are untouched, and the resolver's fold itself is not changed. To keep a delegate able to assign such a position, add the own-name set to the scope's `assignablePermissionSets`.
