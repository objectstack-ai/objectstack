---
'@objectstack/spec': patch
---

docs(spec): `server.trustProxy`'s description names both consumers of the client-address rule

Clause-②: no

The `.describe()` on `server.trustProxy` named only the inbound rate limiter. `objectstack serve` also passes the value to the authentication plugin, whose IP allow-list (`allowed_ip_ranges`) judges, and whose login audit stamps as `last_login_ip`, the address that the same rule establishes (`@objectstack/plugin-auth/client-address`). The description now names both. No key, type, default or accepted value changes.
