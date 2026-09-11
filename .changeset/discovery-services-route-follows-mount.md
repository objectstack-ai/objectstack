---
"@objectstack/rest": patch
---

fix(rest): `/discovery` no longer contradicts itself — `services.*.route` follows the mounted paths, like `routes.*` already did (#16674)

The `/discovery` document states each service's address twice: once in `routes.X` (the flat convenience map) and once in `services.Y.route` (the per-slot entry). The REST discovery handler rewrote only the first half to the paths this server actually mounts, so any deployment that moved a prefix received a document that disagreed with itself — and the `services` half pointed at a path with nothing mounted on it.

Measured on a boot with `crud: { dataPrefix: '/objects' }`, reading `GET /api/v1/discovery`:

- before — `routes.data` = `/api/v1/objects` (the mounted path), `services.data.route` = `/api/v1/data` (unmounted)
- after — both answer `/api/v1/objects`

The same split opened on four keys at once for an `apiPath` deployment: `data`, `metadata`, `ui` and `auth`. All four now follow the mount. `services.*.route` is written as a projection of the finished `routes` map, so the two halves cannot state different answers whatever a future substitution does to `routes`.

**A default deployment's document does not move by a byte.** With `crud.dataPrefix` at its `/data` default and `metadata.prefix` at `/meta`, the values the correction writes are the values that were already there; only a deployment that had moved a prefix sees a change, and there the old value addressed nothing. Route-less slots (`cache`, `queue`, `job`, and an in-process `realtime` bus) never gain a route, and no advertisement is withdrawn.

If you have been reading `services.data.route` on a moved-prefix deployment and compensating for it — by re-deriving the path from `routes.data`, or by hard-coding the prefix — that workaround can go: the field now answers the mounted path directly.
