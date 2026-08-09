---
"@objectstack/runtime": patch
---

Dispatcher-face `/share-links` enforcement now receives the caller's complete resolved `ExecutionContext` (#6551 — the dispatcher half of #6206). The domain handler used to rebuild a two-field `{ userId, tenantId }` subset and hand it to `createLink` / `listLinks` / `revokeLink`, dropping `accessible_org_ids`, `positions`, `permissions`, `org_user_ids`, `systemPermissions`, `posture` and `tabPermissions` on the way into enforcement. Under the `group` tenancy posture the Layer 0 wall reads `accessible_org_ids` and an absent set denies (fail closed), so creating a link answered 403 for records the caller reads fine elsewhere; a record visible only through a position-bound permission set was likewise refused even under the `single` posture. The envelope is now passed through whole per the #6511 contract; the routes' own 401 gate still reads only `userId`.
