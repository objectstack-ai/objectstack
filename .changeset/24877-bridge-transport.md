---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): every in-process auth bridge hands better-auth the connection it was called on (#24877)

Clause-②: no

Eight auth routes answer by re-dispatching a request to better-auth in-process: `POST /api/v1/auth/admin/remove-user`, `/admin/has-permission`, `/admin/sso/register`, `/admin/sso/register-saml`, `/admin/sso/request-domain-verification`, `/admin/sso/verify-domain`, `/send-verification-email` and `/sys-session/revoke`. Each handed `AuthManager.handleRequest` the request alone. The client-address trust rule (`server.trustProxy`) establishes an address from the connection's peer when no trusted proxy is declared, and without the connection it had no peer to use for those requests.

- **Now.** Each route hands `handleRequest` the connection it was called on, as the main auth mount does. Without a declared trusted proxy, the request it re-dispatches is judged on the connection's peer address, whatever the request's `X-Forwarded-For` or `X-Real-IP` headers say.
- **Unchanged.** What each route accepts or refuses, and every answer it gives. The main auth mount, and the `allowed_ip_ranges` allow-list in front of every auth route, already judged on the connection.
