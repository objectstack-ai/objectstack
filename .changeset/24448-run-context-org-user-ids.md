---
'@objectstack/service-automation': minor
---

fix(service-automation): a `runAs: 'user'` flow now sees the acting user's organization members in `sys_user`, as the same user's own request does

A `runAs: 'user'` flow's data nodes ran without `current_user.org_user_ids`, the peer list the request path resolves for every user. The shipped `sys_user_org_members` policy (`id in current_user.org_user_ids`) therefore dropped out, and a `get_record` on `sys_user` returned the acting user's own row only, while the same user's REST read returned their organization's members too.

Run setup now seeds the peer list through the resolver the request path uses (`resolveUserAuthzGrants` from `@objectstack/core`), and every data node passes it on:

- It is the members of the run's organization (`tenantId`) plus the acting user. A run with no organization gets the acting user alone, which is what an organization-less request gets. A user who belongs only to other organizations is never in it, even one who shares another organization with the acting user.
- It is seeded for every trigger shape: the record-change shape (`userId` and `tenantId` only) and the REST and action doors' shape (positions and permission sets already resolved). For the second shape only the peer list is taken from the resolver; the forwarded positions and permission sets stay exactly as they were, so an agent's narrowed ceiling is not re-broadened.
- A `subflow` or `map` child and a resumed leg keep the list their run was seeded with.
- If the resolver fails, the run proceeds without the list, as before, and the `[runAs]` warning now says which half degraded. Policies that read `org_user_ids` then drop out: the run sees less, never more.
- A run suspended before this release resumes without the list and keeps today's answer (its own `sys_user` row) until it ends.

A `runAs: 'system'` flow is unchanged. The exported `RunIdentityContext` type gains an optional `org_user_ids` member.

Clause-②: yes (widening: the exported RunIdentityContext / RunDataContext type gains the optional org_user_ids member, the key ExecutionContext already declares; no accepted input moves)
