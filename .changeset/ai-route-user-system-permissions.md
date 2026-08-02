---
"@objectstack/runtime": patch
---

fix(runtime): carry the capability channel onto an AI route's `req.user` (#4705)

`/ai/*` was the one route domain in the platform where a capability check could
not be written. The dispatcher builds `req.user` from the request's
ExecutionContext, and `resolveAuthzContext` resolves a caller into **two** lists
that look alike and are not:

| ExecutionContext field | Carries |
|---|---|
| `permissions` | permission-**set names** (`admin_full_access`, `organization_admin`, `member_default`) plus the synthesized `ai_seat` |
| `systemPermissions` | **capabilities** — `manage_metadata`, `studio.access`, `setup.access`, … — the union of every resolved set's `systemPermissions[]` |

Only the first was copied. Every other surface gates on the second
(`domains/meta.ts`'s `manage_metadata` check, `action-execution.ts`,
`rest-server.ts`), so the same test written against an AI route's
`req.user.permissions` was **permanently false** — a gate built on it would not
have tightened the route, it would have closed it on platform admins too. That
is what blocked the capability gate on
`POST /api/v1/ai/tools/:toolName/execute`, where any authenticated user can
currently run any registered tool (`create_object`, `apply_blueprint`,
`create_seed`) in the default configuration.

`req.user` now carries `systemPermissions` alongside `permissions`, with the
same fail-closed default the neighbouring fields use: a non-array — or an
ExecutionContext that has none, since the field is optional — becomes `[]`,
never `undefined`. The two channels are copied **side by side and never merged**:
flattening either into the other would corrupt every existing reader of
`permissions` while appearing to fix this.

This is transport only. No route in this package gates on the new field, and the
declared-but-unenforced `route.permissions` mechanism is untouched — consumers
decide policy, on the platform's existing `systemPermissions` contract.

The other producer of an AI-route `req.user` — `dispatcher-plugin`'s
`resolveRequestUser`, backing the concrete per-route mounts — has no
ExecutionContext to read and stays capability-less on purpose. It now says so in
the same shape (`systemPermissions: []`, spelled out rather than omitted) so a
consumer never sees `undefined` on one path and `[]` on the other, and so needs
no fallback of its own to tell them apart.
