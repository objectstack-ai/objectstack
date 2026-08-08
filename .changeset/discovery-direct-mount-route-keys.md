---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
"@objectstack/rest": minor
"@objectstack/client": patch
---

feat(spec,metadata-protocol,rest,client): the direct-mount surfaces (`packages`, `datasources/:name/external/*`) become discoverable, and the SDK follows the advertised base (#6633)

The rest surface's `/discovery` never advertised `routes.packages` — routes
mounted but not advertised, the unstated half of ADR-0076 D12 — so the SDK's
`packages.*` always fell back to the hard-coded `/api/v1/packages`; and the
SDK's `datasources.external.*` had no discovery mechanism at all, hard-coding
`/api/v1/datasources/...` in each of its five methods. On any deployment with a
non-default API base, both families built wrong URLs (measured in #6633).
Maintainer ruling 2026-08-08 (route B, prerequisite for #6306):

- **spec** (minor, additive): `ApiRoutesSchema` declares a `datasources` key —
  the base of the federation-admin family. Optional like `mcp`: absent = not
  mounted.
- **metadata-protocol** (minor, additive): `getDiscovery()` advertises
  `routes.packages: '/api/v1/packages'` iff the `package` service is
  registered (`serviceToRouteKey` gains the mapping; the route flows through a
  non-slot table because `package` is not a `CoreServiceName`). `datasources`
  is deliberately NOT advertised by this builder — the mount belongs to the
  REST host it cannot see (same disposition as `mcp`).
- **rest** (minor): `/discovery` advertises `routes.packages` and
  `routes.datasources` as projections of the RECORDED direct mounts (#5822) —
  advertisement and mounting derive from one fact, so #6306's later mount-base
  move carries the advertisement along by construction. Not mounted ⇒ not
  advertised. An end-to-end parity pin (`discovery-advertised-direct-mounts.
  parity.test.ts`) drives the composed surface and goes red on any change that
  moves only one side.
- **client** (patch, behavior fix): the five `datasources.external.*` methods
  derive their base via `getRoute('datasources')` — connected clients follow
  the advertised base; unconnected clients (or servers that advertise no
  `datasources` key) keep building byte-identical `/api/v1/...` URLs.

No key is removed and no wire shape changes for existing deployments: servers
gain two advertised keys, and the SDK changes URLs only when a server
advertises the new keys with a non-default base.
