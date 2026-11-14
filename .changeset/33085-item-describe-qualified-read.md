---
'@objectstack/spec': patch
---

docs(spec): `metadata.endpoints.item` names the package-qualified by-name read it already gates

Clause-②: no
Metadata-protocol: none

The `describe()` of `RestServerConfig.metadata.endpoints.item` claims to enumerate every mount the switch takes, and it listed thirteen. The switch takes fourteen: `GET /meta/:type/:ns/:name`, the package-qualified by-name read of ADR-0150 D5, answers through the item read's own handler, so `endpoints.item: false` already removes it. The description now names it, and the `endpoints.item` row note in `liveness/metadata_endpoints.json` counts fourteen mounts instead of thirteen.

Only description text changes. No route, default or accepted value moves; the radius was already pinned at fourteen routes in `@objectstack/rest`'s mount-table test.
