---
'@objectstack/objectql': patch
---

fix(objectql): a `runAs: 'user'` hook now sees the acting user's organization members in `sys_user`, as the same user's own request does

A hook declaring `runAs: 'user'` is pinned to the triggering user. When the triggering write carried a hand-built system context such as `{ isSystem: true, userId, tenantId }` (the approvals writes are the shipped producers), the pinned context carried no `org_user_ids`, the peer list the request path resolves for every user. The shipped `sys_user_org_members` policy (`id in current_user.org_user_ids`) therefore dropped out, and the hook's `ctx.api` read of `sys_user` returned the acting user's own row only, while the same user's request returned their organization's members too.

The hook wrapper now seeds the pinned context through the resolver the request path uses (`resolveUserAuthzGrants` from `@objectstack/core`):

- The peer list is the members of the context's organization (`tenantId`) plus the acting user. A context with no organization gets the acting user alone, which is what an organization-less request gets. A user who belongs only to other organizations is never in it.
- A context with no `permissions` also takes the user's resolved positions and permission sets, so the hook acts with the user's real grants rather than the security plugin's member baseline. Positions and permission sets the context already carries stay exactly as they were, so a narrowed ceiling is not re-broadened; only the peer list is added.
- A context that already carries a peer list, such as a request-resolved one, resolves nothing and is handed through as before.
- If the resolver fails, the hook runs on the unseeded pin, as before, and a warning says so. Policies that read `org_user_ids` then drop out: the hook sees less, never more.

`runAs: 'inherit'` (the default) and `runAs: 'system'` are unchanged, and a `runAs: 'user'` hook whose trigger names no user is still refused with `HOOK_UNSCOPED_DATA_ACCESS`. A `runAs: 'user'` hook fired from a context that lacks either list now pays one grants resolution per dispatch.

Clause-②: no (a runtime producer fix: a `runAs: 'user'` hook reads what the same user's own request reads. Nothing `@objectstack/spec` declares moves; owes the seat's review of record before the queue)
