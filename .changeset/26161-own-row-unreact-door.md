---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): a member removes their own comment reaction through an own-row unreact door, with no object delete grant

A member whose grants are the every-member ones could add a comment reaction and never take it back. The console removes a reaction through the generic data door's `DELETE /api/v1/data/sys_comment_reaction/:id`, which needs an object-level `delete` grant, and no every-member set may carry one: ADR-0090 D5 keeps `delete` off the `everyone` anchor (`security-anchor-high-privilege`), and `member_default` carries none. Measured as a plain member: add a reaction → `201`, delete it → `403`.

Clause-②: yes (widening)
Metadata-protocol: none

`AuditPlugin` now mounts `DELETE /api/v1/comments/reactions/:id` on the kernel's HTTP server. It removes the caller's own `sys_comment_reaction` row and nothing else:

- The row is read as the caller, so every read gate decides. A reaction on a comment the caller cannot read answers `404 RECORD_NOT_FOUND`, the same answer as an id that names no row, so the door says nothing about a reaction the caller cannot see.
- The row's reactor (`created_by`, the column the platform's own-record floor reads) must be the caller. Anyone else's reaction is refused with `403 PERMISSION_DENIED` and stays.
- Only then is the row removed, under a system context attributed to the caller and kept in the caller's organization. Success answers `200` with `{ success: true, data: { id, deleted: true } }`.
- Before any of that the door answers what every door answers: `401 UNAUTHENTICATED` for a request that names nobody, a held sign-in's own `403`, the permission store's `503` when it cannot be read, and `400 VALIDATION_ERROR` for any query parameter.

The grant model does not move. The generic data-door delete answers exactly what it answered before (`403` for a member with no delete grant), no permission set gains `delete`, and `member_default` and the `security-anchor-high-privilege` rule are unchanged. The console's reaction chip moves to the new route in a separate change; until then the route is reachable but nothing in the console calls it.
