---
'@objectstack/platform-objects': minor
---

feat(platform-objects): declare the `set_user_manager` row action on `sys_user` (#19249)

`sys_user.manager_id` drives the approvals `{ type: 'manager' }` rung and the ADR-0057 `own_and_reports` read scope, and `POST /api/v1/auth/admin/set-user-manager` (#16678 Phase 3) has been its only product write surface since it landed — with nothing in the Console reaching it. This declares that affordance: a `set_user_manager` row action on `sys_user`, offered from the Users list row menu and the record-detail header, collecting the new manager through an inline `sys_user` lookup and POSTing `{ userId, managerId }` to the admin endpoint.

Three properties of the declaration are decisions rather than detail:

- **It posts the admin endpoint, never the generic data API.** `sys_user` is `managedBy: 'better-auth'` and the ADR-0092 D2 managed-update whitelist is `{name, image, locale}`, so a picker writing `manager_id` through `/api/v1/data` would be refused by the identity write guard — correctly — and would read as a Console bug. The field keeps `readonly: true`; the endpoint reaches the column by system context.
- **Its `visible` predicate carries the directory-sync term and not the self-service one.** A directory-owned identity (`source: 'idp_provisioned'`) is refused by the endpoint, so the button is hidden for one — the same term the three self-service identity actions on this object already spell. Their `record.id == ctx.user.id` half is deliberately not carried over: this is an admin action on someone else's row.
- **No second copy of the server's refusals.** Self-assignment, cycle, depth, cross-organization and directory-owned identity are enforced at the write, in one derivation, and surface from there. Nothing is re-derived client-side.

Additive: no existing action, field or predicate changed. The `manager_id` field and its read-only rendering are untouched, and `sys_business_unit.manager_user_id` (Business Unit Head) is a separate, independent relation that this does not read or write.
