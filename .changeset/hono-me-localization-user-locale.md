---
"@objectstack/plugin-hono-server": minor
---

feat(hono-server): `GET /auth/me/localization` → `locale` is now the signed-in user's language — `sys_user.locale` when set, then the request's `Accept-Language`, then the deployment default (#14788)

Maintainer ruling 2026-09-03 (option D on #14788): this endpoint is the ONE
read face for "what language is this user", now that `sys_user.locale` is a
user-stated preference (#13881 / #14787) and the never-produced
`SessionUser.language` is retired from the session contract
(`@objectstack/spec`, same release).

What changed, for an authenticated caller:

- `locale` resolves **the user's own `sys_user.locale`** first — read under a
  system context by the caller's own id and accepted only when it passes the
  column's OWN `locale_bcp47_shape` rule as the registry declares it (the
  endpoint evaluates that rule; it carries no second locale parser). A
  malformed, blank or unverifiable value falls through, it is never served.
- then **the request's `Accept-Language`** preference (`preferredLocaleFromHeader`,
  the same parse REST and the runtime dispatcher feed `execCtx.locale` from);
- then **the deployment default** (`resolveLocalizationContext` — the
  `localization.locale` settings cascade, floor `en-US`).

Before, the resolver behind this endpoint assembled no localization at all, so
`locale` was `null` for every authenticated caller; it is now always a string
for an authenticated caller. The response shape is unchanged
(`{ authenticated, currency, locale, timezone }`), `currency` / `timezone`
are untouched, and the unauthenticated answer (`{ authenticated: false }`) is
unchanged. `resolveSignedInUserLocale` is exported for hosts that compose the
current-user endpoints directly.
