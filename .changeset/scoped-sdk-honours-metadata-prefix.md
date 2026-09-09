---
'@objectstack/client': patch
---

fix(client): the scoped SDK reads `metadata.prefix` off the advertised routes instead of restating `/meta`

`metadata.prefix` is a live `RestServerConfig` key: REST mounts every metadata
route under `metaPath = ${basePath}${metadata.prefix}` and the discovery handler
advertises the same value as `routes.metadata = ${realBase}${metadata.prefix}`.
Three surfaces describe one set of paths — the mounts, the discovery document,
and this SDK.

`ScopedEnvironmentClient` restated `/meta` as a literal in all six of its
metadata methods — `getTypes`, `getItems`, `getItem`, `saveItem`, `deleteItem`,
`getHistory` — so on a deployment that moved the prefix, every one of them
called a path the server does not mount. The unscoped twin of each method was
already correct (it builds `${baseUrl}${getRoute('metadata')}`), so one SDK
disagreed with itself: the unscoped half read the advertised value while the
scoped half guessed. Measured on a live server booted at
`metadata: { prefix: '/metadata' }`, all six went to
`/api/v1/environments/<id>/meta`, which that deployment answers 404.

The six now build through `metaUrl()`, which takes its base from `_apiBase()`
and its prefix from the new `_metaPrefix()` — the exact sibling of the
`_dataPrefix()` derivation that fixed `crud.dataPrefix`, fallback discipline
included. `_metaPrefix()` prefers the advertised `routes.metadata`, recovers the
prefix from `routes.data` as a second equation over the same `realBase` when the
advertised value is not the conventional one, and **declines to `/meta`**
whenever the document does not determine the answer: an SDK must not become
unusable because a server's discovery document is missing a key.

Deployments on the default prefix are unaffected, by construction and by
measurement: the conventional-suffix rule is taken first, so a default
deployment is answered from `routes.metadata` alone, and a client that never
connected never reaches a rule at all. The pinned negative control asserts the
six request URLs of a default deployment byte for byte, for a connected client
and for an unconnected one, and that the unconnected client puts no discovery
request on the wire.

The unscoped metadata methods are untouched.
