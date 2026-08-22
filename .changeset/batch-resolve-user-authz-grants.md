---
"@objectstack/core": patch
---

Batch the independent reads in `resolveUserAuthzGrants`: **8 sequential round
trips become 4**, with the same queries and the same rows (#10825).

`resolveUserAuthzGrants` is legs 6–13 of every authenticated data request. Five
of its reads build their `where` entirely out of the two inputs (`userId`,
`tenantId`) — `sys_user`, `sys_member {user_id}`, `sys_user_position`,
`sys_member {organization_id}` and `sys_user_permission_set` — so not one of
them feeds another's filter, and nothing but the `await` kept them apart. They
now go out in one wave. What remains is a genuine foreign-key chain (position
names → `sys_position.id` → `sys_position_permission_set` →
`sys_permission_set`) whose every filter is the previous read's output, so four
legs is the floor for this data model.

A round trip, not a query, is what multiplies request latency — cloud#1539
established it causally by latency injection (R² = 0.9994,
`server_ms ≈ 33 + L × 36.6`). Against that model this removes ~4 of an
authenticated request's measured 23.4 legs, roughly 150 ms of ~890 ms, and it
does so without touching an authorization semantic.

**Nothing was merged, cached or deleted.** The query count is unchanged (8 → 8):
every read keeps its own object, `where`, `limit` and `context`. In particular
the two `sys_member` reads stay two reads — they carry different limits (200 for
the caller's memberships, 1000 for the fellow-org peer list), and folding them
would silently truncate `org_user_ids` at 200 on any organization with more
members, narrowing an RLS scope with no error. Nothing survives the request:
there is no cache here and therefore no staleness — a permission revoked at T is
still gone at T.

Equivalence is proved rather than asserted. `resolve-authz-grants-batching.test.ts`
pins the full resolved envelope (array order included) and the full query log for
twelve principal shapes — multi-org membership, position-derived grants,
permission-set-derived `platform_admin`, the `ai_seat` read, deactivated
positions and sets, validity windows, an org-less principal, a 251-member
organization and an empty principal — against goldens captured by running the
pre-batch resolver itself, and measures round trips directly instead of
inferring them from a query count.
