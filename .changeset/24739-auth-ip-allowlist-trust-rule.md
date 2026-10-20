---
'@objectstack/plugin-auth': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/service-settings': patch
---

fix(plugin-auth): the auth IP allow-list judges the client address the server established (#24739)

Clause-②: no

The `allowed_ip_ranges` auth setting (ADR-0069 D5) and the `last_login_ip` login audit (D7) now establish a request's client address by the same rule as the inbound rate limiter: `X-Forwarded-For` (its first entry), then `X-Real-IP`, count only when the stack declares `server.trustProxy`. Otherwise the address is the connection's peer address.

**For operators who set `allowed_ip_ranges`:**

- Behind a reverse proxy or load balancer, declare `server: { trustProxy: true }` in the stack before you upgrade. Without it, the allow-list judges the proxy's own address for every request.
- A request whose client address cannot be established (the transport reports no peer address, and no forwarded header is trusted) is now refused with `403 IP_NOT_ALLOWED`. Before, it was admitted. The first such refusal logs a warning that names `allowed_ip_ranges` and `server.trustProxy`.
- `CF-Connecting-IP` is no longer read. Behind Cloudflare, declare `server.trustProxy`, and the `X-Forwarded-For` it sets is used.
- A dual-stack listener reports an IPv4 client in IPv4-mapped form (`::ffff:203.0.113.7`). That address is now matched as the IPv4 address it denotes.
- With `allowed_ip_ranges` unset or empty, nothing changes.

**`last_login_ip`** records the address the allow-list judged, or no address when none could be established. It is no longer read from a forwarded header the deployment does not trust.

**By package:**

- `@objectstack/plugin-auth`: the rule is published as the dependency-free `@objectstack/plugin-auth/client-address` entry (`resolveClientAddress`). `AuthPlugin` and `AuthManager` take a `trustProxy` option. `AuthManager.handleRequest` takes an optional second argument that carries the transport's `remoteAddress`.
- `@objectstack/runtime`: the inbound rate limiter imports the rule from that entry instead of keeping its own copy. Its keys are unchanged.
- `@objectstack/cli`: `objectstack serve` passes the stack's `server.trustProxy` to `AuthPlugin` as well as to the dispatcher. A host that composes `AuthPlugin` itself passes `trustProxy` the same way.
- `@objectstack/service-settings`: the `allowed_ip_ranges` help text says which address is judged.
