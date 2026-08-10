---
'@objectstack/plugin-reports': patch
---

Reports read with the caller's whole execution envelope, so a `group`-posture report no longer under-reports

`executeReport` rebuilt a five-field projection of the caller's `ExecutionContext`
(`userId` / `tenantId` / `positions` / `permissions` / `isSystem`) before handing it to
the engine read that produces the report — while the method's own comment promised
"reports execute with the caller's identity".

**Before.** `accessible_org_ids` was not in that projection, and the engine reads it by
name (`buildDriverOptions`, ADR-0105 D2 / #3623) to widen the driver's native tenant
scope to the caller's whole membership set under the `group` tenancy posture. Absent, the
drivers fall back to active-org equality — "fail toward isolation". So the identical query
returned the membership union in an interactive list view and collapsed to the active org
inside a **saved or scheduled** report: silently short rows, no error, nothing in the
output saying so. Measured end-to-end on a real kernel + SQL driver: three rows across two
member orgs came back as three interactively and two in the report, and a scheduled CSV
digest emailed the owner the same two. `timezone` went the same way, so a read-time
formula field resolved its calendar day in UTC instead of the caller's business timezone;
`posture`, `org_user_ids`, `systemPermissions` and `onBehalfOf` were dropped too.

**After.** The read receives the caller's envelope whole (the #6206 ruling — enforcement
adjudicates on the whole `resolveAuthzContext` envelope, never a per-site subset), minus
the `__`-prefixed keys plugin-security stamps for the operation in flight, and as a fresh
object so a callee's stamp cannot write back into the caller's request context. The same
shape `plugin-audit` (#7141) and `service-storage` (#7145) landed. Direction is unchanged
outside `group`: the `isolated` posture, a deployment with no posture provider, and a
`group` caller with an empty accessible set all still read at active-org equality.
