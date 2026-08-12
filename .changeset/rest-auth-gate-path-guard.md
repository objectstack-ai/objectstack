---
"@objectstack/rest": patch
---

fix(rest): exempt a request from the ADR-0069 auth gate only when it carries a REAL path (#7432)

`isAuthGateAllowlisted(undefined)` returns `true` — it treats "no path" as
allow-listed. REST's `enforceAuth` passed `req.path` straight through, so a
request whose `path` was absent or an empty string read as allow-listed on
**every** route and the ADR-0069 gate (expired password / enforced MFA) did not
fire for a session policy says must be blocked.

`enforceAuth` now applies the guard its sibling seam already carries
(`shouldDenyAnonymous`, `@objectstack/core/security`): a path exempts a gated
session only when it is a non-empty string that the allow-list actually accepts.

**Nothing shipped was bypassable.** The hono adapter populates `path` at all
three request-construction sites, so no live transport reached this seam without
one. What is fixed is the direction of the default: the guard was carried by the
**caller's** discipline on a fail-OPEN seam, so a new transport adapter — or any
synthetic request — disabled a security gate by omission with no test going red.

No behaviour change for any request that carries a path: allow-listed paths
(auth, remediation, health, UI-bootstrap reads) still pass, protected paths still
block, and `OPTIONS` preflight is still exempt. A gated session with no path is
now blocked rather than waved through.
