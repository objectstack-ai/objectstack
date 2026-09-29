---
'@objectstack/rest': patch
---

fix(rest): the environment-scoped `?layers=true` answer's successor `Link` names the path the request used, not the route template (#20508)

Clause-②: no

On `RestServer`'s environment-scoped mount (`api.enableProjectScoping`),
`GET /api/v1/environments/env_1/meta/view/lead_all?layers=true` answered its
`Deprecation` header with a successor `Link` naming
`/api/v1/environments/:environmentId/meta/view/lead_all/layers`: the route
template, with a literal `:environmentId` in it. A client that followed the
header requested that path. The `Link` now names
`/api/v1/environments/env_1/meta/view/lead_all/layers`.

`RestServer` builds the `Link` from the request's own path, read the way the
runtime dispatcher reads its request URL, so both transports name the successor
the same way. The unscoped mount's `Link` is unchanged for every name that needs
no percent-encoding. A percent-encoded name now stays encoded in the `Link`
(`lead%20all`, where the header used to carry a raw space), because the path is
parsed as a URL path instead of being assembled from decoded route parameters.
A request that carries no path of its own is still answered `Deprecation: true`,
and names no successor. The body, the status and the `Deprecation` header are
unchanged on both mounts.
