---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): `/auth/change-password` now clears the force-change flag and enforces password-reuse on the BEARER lane, not only on cookies (#8049)

An admin-provisioned user (`POST /auth/admin/create-user`, where
`mustChangePassword` defaults to **true**) is gated out of every protected route
with `403 PASSWORD_EXPIRED` until they rotate their password. On the **bearer
lane** — the documented API/agent/CLI lane — that escape hatch did not work:
`POST /auth/change-password` answered **200**, the password really rotated, and
the caller stayed locked out forever. `must_change_password` stayed `true` and
`password_changed_at` stayed `null`. The console was unaffected, because the
cookie lane cleared both correctly.

**The same root cause silently skipped a security control.** One stash —
`ctx.context.__osPwChangeUserId`, set by the before-hook when it resolves the
acting user — gates three behaviours: the `password_changed_at` /
`must_change_password` stamp, ADR-0069 D1's password-reuse **rejection**, and the
password-history append. With no principal resolved, none of them ran, so on the
bearer lane password history was **neither checked nor recorded** — a user could
immediately "change" their password back to the one they had just rotated away
and be told 200. A control enforced on one transport and absent on another is
worse than one absent on both, because the console and the existing tests both
exercise the working lane.

**Cause.** better-auth orders `options.hooks.before` (the auth manager's global
before-hook) ahead of every plugin before-hook — including `bearer()`'s, which is
what rewrites `Authorization: Bearer` into a session cookie. The resolver used a
bare `getSessionFromCtx(ctx)`, which reads that cookie, so on the bearer lane it
read a cookie that did not exist yet and resolved nothing, while better-auth's
own password write — running after the conversion — succeeded.

**Fix.** The acting principal is now resolved once, for both lanes, through the
shared hook-order-independent `resolveActor` (which falls back to explicit token
lookup) rather than a second stamp site. That resolver also now strips the
signature from a bearer credential the way it always did for cookies: `bearer()`
hands clients the signed `<token>.<sig>` form in `set-auth-token` and accepts it
back, while `sys_session.token` stores the unsigned value — so the credential the
documented lane actually issues resolved nothing. This also repairs the same
lookup for the `/sso/register` admin gate, which shares the resolver.

No behaviour change on the cookie lane.
