---
"@objectstack/plugin-hono-server": patch
---

fix(plugin-hono-server): `/auth/me/permissions` resolves position-bound grants through the canonical resolver (#6334)

On a hono host, `/api/v1/auth/me/permissions` and `/me/apps` resolved the caller
through a standalone resolver in `current-user-endpoints.ts` that read
`sys_member` + `sys_user_permission_set` — and **nothing else**. It never read
`sys_user_position` / `sys_position_permission_set`, so a permission set bound to
a **position** — the ADR-0090 D3 distribution mechanism, and how the showcase app
grants every persona — was invisible to these endpoints: the response carried
`positions: []`, omitted the set from `permissionSets`, and withheld its
`systemPermissions`.

That is the surface objectui's four `useCapabilityGate` gates read (toolbar, row
kebab, record header, bulk bar — ADR-0066 D4), while the data plane resolves
through SecurityPlugin's middleware on the canonical chain. So the server
**granted** the action and the UI **hid the button** from a user who genuinely
held the capability — the failure direction the fail-open design names as the
worse one.

A second, quieter half of the same divergence: the hand-rolled envelope published
membership roles under `roles`, while `ExecutionContext` — and every reader in
that file — calls the field `positions` (ADR-0090 D3, "formerly `roles`"). The
endpoint's `positions` was therefore always `[]` and those names never reached
`resolvePermissionSets` either, independently of the position tables.

The session lookup (the genuinely transport-specific part) stays where it is; all
grant aggregation now delegates to `resolveUserAuthzGrants`, the canonical
resolver's userId-driven core, which `@objectstack/core` exports for exactly this
caller shape — a surface that already knows who the principal is and needs the
same envelope with no HTTP request to resolve it from. Arriving with it, none of
it re-implemented: `sys_user_position` (null org = global, active-org match,
ADR-0091 validity windows), the implicit `everyone` audience anchor (ADR-0090 D5),
`sys_position_permission_set`, `mapMembershipRole` normalization, the
platform-admin derivation and posture rung, and the `ai_seat` synthesis.

No response-envelope change: `positions` / `permissionSets` / `systemPermissions`
/ `tabPermissions` keep their names and shapes, and now carry the grants the
server was already enforcing.
