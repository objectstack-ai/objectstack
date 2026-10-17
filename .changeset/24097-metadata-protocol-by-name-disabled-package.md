---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: the by-name `/meta` read refuses an object of a disabled package with `404 OBJECT_PACKAGE_DISABLED`, as the object list and the data plane already do

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of a runtime read door, getMetaItem and getMetaItemLayered for an object whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Disabling a package already took its objects out of `GET /meta/objects` and refused their data with `404 OBJECT_PACKAGE_DISABLED`. The by-name read still served them. It now gives the same answer.

- **Refused now:** `getMetaItem({ type: 'object', name })` (`GET /api/v1/meta/object/:name`, the plural spelling included) for an object whose owning package is disabled. The refusal applies to every state the read serves: the active read, `state: 'draft'` and `previewDrafts`. `getMetaItemLayered` (`?layers=true`) refuses it too. The answer is `404` with `code: 'OBJECT_PACKAGE_DISABLED'` and `object`, built by the same constructor as the data plane's refusal, so the two cannot drift.
- **Unchanged:** objects of enabled packages, other metadata types, and the registry's resolution reads (`registry.getObject`, `registry.listItems('object')`), which keep serving a disabled package's objects for migrations and cross-package references.
- **Still checked:** saving an object of a disabled package still runs the destructive-change check. A save that drops a field still answers `409 DESTRUCTIVE_CHANGE` until it is confirmed with `force`. The check reads the object's prior schema through the protocol's internal read, not the refusing door.

What changes for you: a client that read a disabled package's object by name now gets `404 OBJECT_PACKAGE_DISABLED`. Re-enable the package to read it again.
