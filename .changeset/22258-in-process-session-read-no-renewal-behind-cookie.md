---
'@objectstack/types': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/plugin-hono-server': patch
'@objectstack/cloud-connection': patch
---

fix(auth): a server-side session read no longer renews a browser session behind its cookie (#22258)

**What was wrong.** better-auth's `getSession` renews a session older than `session.updateAge`: it moves `sys_session.expires_at` to `now + expiresIn` and stages the renewed session cookie on that call's own response. Ten doors read the session in-process (`auth.api.getSession`) and answer with their own response, so the renewal landed in the database and its cookie was discarded. The browser kept its old cookie, later `GET /api/v1/auth/get-session` calls found a fresh row and re-issued nothing, and the cookie expired first: a dead cookie beside a live bearer, and every cookie-only path then saw a signed-out user. Measured on a fresh dev stack (better-auth 1.7.3, `expiresIn` 604800 s, `updateAge` 86400 s, a session aged to `now + expiresIn − updateAge − 60 s`): `GET /api/v1/data/:object`, `GET /api/v1/auth/me/permissions`, `GET /api/v1/meta/object`, `GET /api/v1/i18n/locales`, `GET /api/v1/packages`, `GET /api/v1/marketplace/install-local` and the MCP door each moved `expires_at` by +86460 s and set no session cookie.

**The rule now, decided by what the request carries.**

- **A session cookie** (a browser, including a console that sends its cookie beside its bearer): the in-process read passes `query.disableRefresh`. The session renews only through `GET /api/v1/auth/get-session`, which re-issues the cookie with `Max-Age = expiresIn`, so cookie and session expire together. Measured after the change: every door above leaves `expires_at` unchanged on a cookie request and sets no cookie.
- **No session cookie** (a bearer-only client: `@objectstack/client` outside a browser, the `os` CLI): unchanged. A data read past `updateAge` still renews the session (+86460 s, measured on the same doors), so an active bearer client keeps sliding forward without calling `get-session`. No cookie is ever set on a response to a request that sent none.

**Upgrading.** Nothing to change. A browser session renews whenever the app calls `GET /api/v1/auth/get-session`; a tab that never calls it now signs out at the session's real expiry instead of keeping a live bearer beside a dead cookie.

`@objectstack/types` gains `inProcessSessionReadInput(headers)` (the `getSession` input for an in-process read: the request's own headers, plus `query: { disableRefresh: true }` when they carry a better-auth session cookie), `carriesSessionCookie(headers)` and the `InProcessSessionReadInput` type. A host that calls `auth.api.getSession` itself should read through `inProcessSessionReadInput` for the same reason.

Not changed here: the in-process readers in `@objectstack/plugin-auth`, `@objectstack/plugin-webhooks`, `@objectstack/plugin-sharing`, `@objectstack/service-storage`, `@objectstack/service-settings` and `@objectstack/service-datasource` still renew a cookie session without re-issuing its cookie.
