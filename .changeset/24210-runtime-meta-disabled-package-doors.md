---
'@objectstack/runtime': minor
---

fix(runtime)!: the dispatcher's `/meta` doors that read past the protocol answer a disabled package's object or item as the protocol's by-name read does

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of runtime read doors on the dispatcher transport: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The registry keeps a disabled package's objects on purpose, and the metadata service knows nothing of a disable. Four dispatcher doors read one of them for a disabled package's object or item and served it.

- **Refused now, `404 OBJECT_PACKAGE_DISABLED`:** `GET /meta/object/:name/state/:field`, and the legacy one-segment `GET /meta/:name` exit, for an object whose owning package is disabled. Both read `registry.getObject`; they now answer the protocol's refusal, the answer `GET /meta/object/:name` gives.
- **Refused now, `404 OBJECT_PACKAGE_DISABLED`:** `GET /meta/object/:name/published`. When the layered read refused the object, this door fell through to the published snapshot and served it. The refusal is now the answer, as on `RestServer`'s `/published`.
- **Absent now, `404 RESOURCE_NOT_FOUND`:** `GET /meta/:type/:name` for a non-object item of a disabled package. The protocol answers it as absent, and the door no longer serves the metadata service's copy in its place. The body is byte for byte the answer for a missing name.
- **Unchanged:** objects and items of enabled packages, and every other fall-through.

What changes for you: re-enable the package to read the object or item again.
