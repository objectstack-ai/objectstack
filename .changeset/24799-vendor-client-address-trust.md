---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the vendored auth library records and keys on the client address the server established (#24799)

Clause-②: no

better-auth reads a request's client address with its own reader, and three things are keyed on what it reads: a session's `ip_address` (and the `login` / `logout` audit rows copied from it), the address on the `login_failed` / `account_locked` audit rows, and the key of better-auth's own per-address rate limiter. That reader did not follow `server.trustProxy`. It now follows the same rule as the `allowed_ip_ranges` allow-list and `last_login_ip`: `X-Forwarded-For` (its first entry), then `X-Real-IP`, count only when the stack declares `server.trustProxy`. Otherwise the address is the connection's peer address. When neither is available, better-auth is handed no address.

**For operators:**

- Behind a reverse proxy or load balancer, declare `server: { trustProxy: true }` in the stack. Without it, sessions and audit rows record the proxy's own address, and better-auth's per-address rate limit counts every client behind the proxy as one client.
- With `server.trustProxy` declared, a forwarded chain (`client, proxy`) now resolves to its first entry. Before, better-auth read a multi-entry header as no address.
- A request whose client address cannot be established records no address, and better-auth's rate limiter counts it in one shared bucket.

**For hosts:** `AuthManager.handleRequest` now drops any `x-objectstack-client-address` request header a caller sends. The platform writes that header itself, from the address it established, and better-auth reads no other header for the client address. A programmatic `auth.api.*` call is handed whatever headers its caller passes. Route a client's request through `handleRequest` instead.
