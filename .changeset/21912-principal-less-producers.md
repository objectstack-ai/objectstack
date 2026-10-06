---
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
---

Four producers that reached the data engine with no principal and no `isSystem` now carry the explicit system opt-in. Each is already authorized by its own door, so nothing it answers changes.

Clause-②: no

- **`@objectstack/plugin-auth` — the platform-admin OAuth client toggle route** (`POST /api/v1/auth/admin/oauth2/toggle-disabled`). Its `sys_oauth_application` read and write go through `withSystemContext`, the wrapper better-auth's adapter already writes those rows through. The platform-admin judge still runs first. The answers (`200`, `404 RESOURCE_NOT_FOUND`, the refusals) and the stored row are unchanged. One log line goes away: the engine's read-only `updated_at` warning on every toggle. The value it warned about was discarded before and the driver still stamps the column.
- **`@objectstack/plugin-auth` — `verifyScimBearerToken`.** The credential probe passes `isSystem: true` in the read's trailing options. It runs before any caller is known, and the digest equality is still all it matches. An unknown, inactive or expired bearer is still `null` (`401`).
- **`@objectstack/plugin-auth` — the organization slug guard** (`organizationHooks.beforeUpdateOrganization`). Its `sys_organization` and `sys_environment` reads go through `withSystemContext`. The organization id stays in the `where`. A slug change while an active environment references the organization is still refused (`FORBIDDEN`), and any other change is still allowed. The catches around both reads are unchanged: a read that throws still ends the hook without refusing.
- **`@objectstack/runtime` — the dispatcher's environment-membership gate.** The `sys_environment_member` read carries `isSystem: true` as its query context. The caller's user id stays in the `where`. A member still passes and a non-member is still refused with `403 PROJECT_MEMBERSHIP_REQUIRED`. The catch around the read is unchanged: a read that throws still lets the request through.

Why: the security middleware hands a context with no principal and no `isSystem` straight through (ADR-0096). That hand-through is not an authorization. A caller that is the platform acting for itself says so explicitly. ⛔ No new elevation API, no door's authorization moves, and no accept set changes.
