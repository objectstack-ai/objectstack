---
'@objectstack/rest': minor
---

fix(rest)!: the `/data` API-exposure check treats an object of a disabled package as no object, so every operation on it answers `404 OBJECT_PACKAGE_DISABLED` again, with no fail-open warning

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the change is which refusal a runtime REST door answers for an object whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the object -->

**BREAKING** (a refusal moves), shipped as `minor` under the launch-window convention for breaking changes.

The by-name `/meta` read now refuses an object of a disabled package with `404 OBJECT_PACKAGE_DISABLED`. The API-exposure check reads that object by name. It now reads that refusal as "no object here": there is no exposure policy to judge, and nothing failed, so it logs nothing. The request then reaches the data plane, which refuses it with the same code.

- **Changed back:** for an object whose package is disabled, a denied operation goes from `405 OBJECT_API_METHOD_NOT_ALLOWED` (an operation outside `apiMethods`) or `404 OBJECT_API_DISABLED` (an object with `apiEnabled: false`) back to `404 OBJECT_PACKAGE_DISABLED`. That is what it answered before the check read one object by name. An allowed operation still answers `404 OBJECT_PACKAGE_DISABLED`.
- **No warning now:** such a request no longer logs `api-exposure gate: object metadata read failed — failing open`.
- **Unchanged:** any other failed read still fails open and still logs that warning. Objects of enabled packages get the same exposure answers as before.

What changes for you: nothing to rewrite. No accepted request is now refused, and no refused request is now accepted.
