---
'@objectstack/rest': patch
---

Fix `GET /discovery` advertising an unusable `routes.auth` on a scoped deployment.

`registerDiscoveryEndpoints` strips the environment scope off the advertised auth
route, because auth is a control-plane concern. That strip named only the retired
`/projects/:environmentId` spelling, while `isScoped` — the condition guarding the
branch — matches only `/environments/:environmentId`, so the strip could never match
where it ran. A scoped `/discovery` therefore advertised `routes.auth` as
`/api/v1/environments/:environmentId/auth`: still scoped, and carrying a literal,
unsubstituted route parameter. It now advertises `/api/v1/auth`, the same shape the
sibling `routes.mcp` already used. Unscoped deployments are unaffected.
