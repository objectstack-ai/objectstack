---
'@objectstack/spec': patch
---

docs(spec): `server.trustProxy`'s description names all three consumers of the client-address rule

Clause-②: no (prose only: no shape, key, default or accepted value moves)

The `.describe()` on `server.trustProxy` said the client-address rule had two consumers: the inbound rate limiter and the authentication plugin. There is a third. A declared endpoint (`apis:`) whose own `rateLimit` is enabled is metered by the endpoint policy chain, which keys anonymous callers by the same rule under the same `trustProxy`, whether or not `server.security.rateLimit.enabled` is set. The description and the TSDoc now name it. No key, type, default or accepted value changes.
