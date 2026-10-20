---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): every in-process auth bridge judges the request it re-dispatches on the same client-address facts as the request it serves (#24877)

Clause-②: no

Eight auth routes answer by re-dispatching a request to better-auth in-process: `POST /api/v1/auth/admin/remove-user`, `/admin/has-permission`, `/admin/sso/register`, `/admin/sso/register-saml`, `/admin/sso/request-domain-verification`, `/admin/sso/verify-domain`, `/send-verification-email` and `/sys-session/revoke`. `AuthManager.handleRequest` establishes the re-dispatched request's client address by the client-address trust rule: `X-Forwarded-For` (its first entry), then `X-Real-IP`, count only when the stack declares `server.trustProxy`, and otherwise the address is the connection's peer address. Each route handed `handleRequest` the request alone, without the connection it arrived on. Six of them also rebuild the request before re-dispatching it, and the rebuilt request did not carry the forwarding headers.

- **Now.** Each route hands `handleRequest` the connection it was called on, as the main auth mount does. Each rebuilt request carries the incoming request's `X-Forwarded-For` and `X-Real-IP`. Without a declared trusted proxy, the re-dispatched request is judged on the connection's peer address, whatever those headers say. With `server.trustProxy` declared, it is judged on the forwarded client address, the same address as the request the route serves.
- **For hosts.** `@objectstack/plugin-auth/client-address` exports `FORWARDED_CLIENT_ADDRESS_HEADERS`, the forwarding headers `resolveClientAddress` reads, in the order it reads them. A seam that builds a request of its own carries these headers by reading this list.
- **Unchanged.** What each route accepts or refuses, and every answer it gives. `resolveClientAddress` decides exactly as before. The main auth mount, and the `allowed_ip_ranges` allow-list in front of every auth route, already judged on the connection.
