---
'@objectstack/plugin-security': minor
---

Explain and enforcement now resolve ONE authorization aggregation (#6352).

`buildContextForUser()` — the explain API's reconstruction of an arbitrary user's
context, behind `explain(request, callerContext)` and the `userId` parameter — was
a hand-written second implementation of `@objectstack/core`'s `resolveAuthzContext`
aggregation. Its agreement with enforcement was guaranteed by two comments saying
it mirrored the resolver ("mirroring the runtime resolver's semantics", "we compute
it here with the IDENTICAL rule") and by nothing else: no assertion anywhere in the
repo compared the two.

It did not agree. Measured over identical rows, the mirror dropped:

| input | resolver | explain mirror |
|---|---|---|
| `sys_member` role positions (ADR-0095 D3) | `org_admin`, … | — |
| position-bound permission sets (`sys_position_permission_set`) | resolved | — |
| the `everyone` anchor's bound sets (ADR-0090 D5) | resolved | — |
| `platform_admin` position projection (ADR-0068 D2) | projected | — |
| `systemPermissions` / `posture` / `email` / `ai_seat` | resolved | — |

The user-visible consequence: permission sets are resolved BY NAME from
`context.positions ∪ context.permissions`, and a set carried by a POSITION only
becomes a name inside the resolver. So for any user whose grants arrive through a
position — the ordinary way an org grants access — the explain panel resolved fewer
sets than enforcement and reported a denial the runtime never made. A security UI
that says "you have no access" about access you have is worse than no panel.

`buildContextForUser` now calls `resolveUserAuthzGrants` (core's userId-driven
resolver core, already the same entry point `runAs:'user'` automation runs use) and
adds presentation only: the ADR-0091 expired-grant and `delegated_from` annotations
the resolver correctly discards, and `hasPlatformAdminGrant`, which is now read
back off the resolver's own posture verdict instead of recomputed. The returned
context additionally carries `systemPermissions`, `org_user_ids`, `posture`,
`tabPermissions` and `email` — additive; no field was removed or renamed.

Pinned by a parity suite that runs both implementations over the same fixture rows
(org role projection, position-bound sets, the `everyone` anchor, both
`platform_admin` polarities, `organization_admin` → `TENANT_ADMIN`, ADR-0091
windows) and asserts each case's concrete expected output, so the pin cannot pass
by both sides resolving to nothing. Restoring the mirror turns 9 of those cases
red.
