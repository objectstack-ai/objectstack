---
'@objectstack/objectql': patch
---

fix(objectql): a `runAs: 'user'` hook now carries the acting user's email, so a `current_user.email` row policy admits it as it admits the same user's own request

A hook declaring `runAs: 'user'` is pinned to the triggering user, and the pinned context is seeded with the user's grants and organization peer list through the resolver the request path uses (`resolveUserAuthzGrants` from `@objectstack/core`). That seed never took the user's email, although the same resolution returns it. When the triggering write carried a hand-built system context such as `{ isSystem: true, userId, tenantId }` (the approvals status mirror and a `runAs: 'system'` flow's writes are shipped producers), the pinned context carried no `email`. Every row policy keyed on `current_user.email` (for example `assignee == current_user.email`) therefore dropped out, and the hook's `ctx.api` reads returned no rows where the same user's request returns theirs. It failed closed: rows were hidden, never leaked.

The seed now carries the email too:

- A pinned context with no `email` takes the user's stored email (`sys_user.email`), from the user-row read the resolution already makes, which is the fallback the request path uses.
- An email the context already carries, such as a session's on a request-resolved context, is kept exactly as it was.
- A context that carries `permissions` and a peer list but no email is no longer handed through unseeded: it resolves once and takes the email alone. Its positions, permission sets and peer list stay exactly as they were.
- A user with no stored email (a phone-only sign-up) still carries none, and email-keyed policies still drop out for them, as on their own request.

`runAs: 'inherit'` (the default) and `runAs: 'system'` are unchanged, and a `runAs: 'user'` hook whose trigger names no user is still refused with `HOOK_UNSCOPED_DATA_ACCESS`. A `runAs: 'user'` hook fired from a context that lacks the email now pays one grants resolution per dispatch, as one that lacks either list already did. If the resolver fails, the hook runs on the unseeded pin and a warning names the policies that drop out.

Clause-②: no
