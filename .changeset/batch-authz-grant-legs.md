---
"@objectstack/core": patch
---

perf(core): batch `resolveUserAuthzGrants`' independent reads — 8 sequential legs become 4 (#10825)

`resolveUserAuthzGrants` is legs 6–13 of every authenticated request. It read
`sys_member`, `sys_user_position`, `sys_member` (fellow-org peers),
`sys_user_permission_set`, `sys_position`, `sys_position_permission_set`,
`sys_permission_set` and `sys_user` **one after another**, each `await`
blocking the next, although only three of those seven edges are real data
dependencies.

cloud#1539 measured causally (latency injection, R² = 0.9994) that an
authenticated request's server time follows `≈ 33 + L × 36.6` ms, where `L` is
the count of **sequential legs** — not the count of queries. Batching is
therefore worth exactly as much as deleting, at none of the risk.

The reads that depend on nothing are now issued together, leaving one genuine
chain (`sys_position` → `sys_position_permission_set` → `sys_permission_set`,
which needs position names, then position ids, then the union of set ids):

|  | queries | sequential legs |
| --- | --- | --- |
| before | 8 | 8 |
| after | 8 | **4** (3 with no active `sys_position` row, 2 with no permission sets) |

Measured by latency injection at 25 ms and 50 ms per query — 412 ms → 206 ms at
D = 50 — and independently by a leg-counting engine double across an 11-shape
fixture matrix.

**No caching. Nothing survives a request.** Every read is still live, so a grant
revoked at T is honoured at T; there is no TTL, no invalidation contract and no
staleness window. That is the whole reason this is separable from #10757's
caching tranche.

**Query count, filters, limits and tenancy scoping are unchanged — proven, not
asserted.** On an authorization path a batch that returns even one different row
is a privilege bug a green suite cannot see, so the two `sys_member` reads are
deliberately **not** merged into one `$or` read partitioned in memory: they
answer different questions under different limits (200 vs 1000), and a merge
would feed other members' rows to the `accessible_org_ids` and org-role loops.
`resolve-authz-context.batch-equivalence.test.ts` pins the whole resolved
envelope and the exact multiset of issued `{object, where, limit}` triples,
captured from the sequential implementation and asserted against the batched
one.
