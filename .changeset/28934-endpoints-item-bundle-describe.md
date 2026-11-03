---
'@objectstack/spec': patch
---

docs(spec): `metadata.endpoints.item` names the app metadata bundle route it already gates (#28934)

Clause-②: no
Metadata-protocol: none

The `describe()` of `RestServerConfig.metadata.endpoints.item` claims to enumerate every mount the switch takes, and it listed twelve. The switch takes thirteen: `GET /meta/app/:appId/bundle`, the app metadata bundle, registers through the same per-item registrar, so `endpoints.item: false` already removes it. The description now names it, with the reason it rides this switch: every member the bundle serves is the item read's own answer.

Only the description text changes. No route, default or accepted value moves; the radius was already pinned at thirteen routes in `@objectstack/rest`'s mount-table test.
