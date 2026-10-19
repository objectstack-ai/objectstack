---
'@objectstack/runtime': minor
---

fix(runtime)!: the dispatcher's `GET /meta/object/:name` answers an object of a disabled package with the protocol's `404 OBJECT_PACKAGE_DISABLED`, never the registry's copy

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of a runtime read door on the dispatcher transport: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The dispatcher's object read had two registry reads. On an unscoped kernel it read `registry.getObject(name)` before the protocol. On a scoped kernel it fell back to `registry.getObject(name)` when the protocol read threw. The registry keeps a disabled package's objects on purpose, so both reads served such an object.

- **Refused now:** `GET /meta/object/:name` on the dispatcher transport, for an object whose owning package is disabled. It answers the protocol's `404 OBJECT_PACKAGE_DISABLED`, on scoped and unscoped kernels alike.
- **Unchanged:** every other object read, including the registry fallback for an object the protocol misses for any other reason.

What changes for you: re-enable the package to read the object again.
