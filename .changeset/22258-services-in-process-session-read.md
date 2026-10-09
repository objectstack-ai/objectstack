---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/plugin-sharing': patch
'@objectstack/service-storage': patch
'@objectstack/service-settings': patch
'@objectstack/service-datasource': patch
---

fix(auth,services): the remaining in-process session reads no longer renew a browser session behind its cookie (#22258)

**What was wrong.** better-auth's `getSession` renews a session older than `session.updateAge`: it moves `sys_session.expires_at` to `now + expiresIn` and stages the renewed session cookie on that call's own response. Nine doors in these packages read the session in-process (`auth.api.getSession({ headers })`) and answer with their own response, so the renewal landed in the database and its cookie was discarded. The browser kept its old cookie, which then expired before the session: a dead cookie beside a live bearer, after which every cookie-only path saw a signed-out user. The doors: `POST /api/v1/auth/admin/oauth2/toggle-disabled`, every `/api/v1/auth/admin/*` mount behind the shared platform-admin gate, `POST /api/v1/auth/admin/unlock-user` and `POST /api/v1/auth/admin/has-permission` (`@objectstack/plugin-auth`); `POST /api/v1/webhooks/redeliver`; the storage upload and download doors (`/api/v1/storage/*`); the share-link management routes (`/api/v1/share-links`); the settings routes (`/api/settings`); and the datasource-admin routes (`/api/v1/datasources/*`).

**The rule now** is the one the REST, dispatcher, current-user and cloud-connection doors already follow. Each of these reads goes through `inProcessSessionReadInput(headers)` from `@objectstack/types`:

- **A request carrying a session cookie** (a browser, including a console that sends its cookie beside its bearer) reads with `query.disableRefresh`. The session renews only through `GET /api/v1/auth/get-session`, which re-issues the cookie with `Max-Age = expiresIn`, so cookie and session expire together.
- **A bearer-only request** (`@objectstack/client` outside a browser, the `os` CLI) is unchanged: a read past `updateAge` still renews the session, and no cookie is set on a response to a request that sent none.

**Upgrading.** Nothing to change. `@objectstack/plugin-webhooks` now depends on `@objectstack/types` directly; it already reached it through `@objectstack/core`.
