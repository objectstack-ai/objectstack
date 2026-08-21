---
"@objectstack/plugin-auth": patch
---

**Fix:** `POST /api/v1/auth/admin/impersonate-user` now admits ObjectStack **platform admins**. It previously refused every one of them with `403 YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS` — byte-identical to the refusal a plain member received — so the `sys_user` "Impersonate User" button was dead on every deployment (#9968).

better-auth's `admin` plugin authorizes on the legacy `user.role === 'admin'` scalar that ADR-0068 D2 stopped synthesizing. ObjectStack's platform admin is a `sys_user_permission_set` row pointing at `admin_full_access` with `organization_id = null`, which the vendor cannot be pointed at, and re-synthesizing the scalar is permanently vetoed.

**What an operator will now observe.** A platform admin who could not impersonate anyone can now impersonate a non-admin user, and the impersonation takes effect for cookie and bearer clients alike. Refusals are unchanged for everyone else: a signed-in non-platform-admin (including an organization owner or admin, who is **not** a platform admin under ADR-0068) still gets `403 YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS`, and an anonymous caller still gets `401` from better-auth's own `adminMiddleware`.

**One refusal is newly reachable.** The vendor refuses to impersonate an admin-grade *target* by reading that same `role` scalar against `adminRoles: ['admin']` — a column nothing writes after ADR-0068 D2, so the guard was inert. It is now asked through the ADR-0068 predicate, so impersonating a **platform-admin target** is refused with `403 YOU_CANNOT_IMPERSONATE_ADMINS` where it previously succeeded.

Implemented as a better-auth **plugin endpoint**, replacing the vendor endpoint in place on the `admin` plugin's own `endpoints` record — not a raw Hono mount. That keeps the signed-cookie contract with `/admin/stop-impersonating` and keeps the `/admin/impersonate-user` path-keyed rotation hook attached, so bearer-client impersonation does not regress to a silent 200 no-op.

Every other better-auth-native `/admin/*` route still gates on the legacy scalar and still refuses platform admins — unchanged here.
