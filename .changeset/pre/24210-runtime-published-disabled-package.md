---
'@objectstack/runtime': minor
---

fix(runtime)!: the dispatcher's `/meta/:type/:name/published` answers a disabled package's non-object item as a missing name

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of one runtime read door for an item whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

- **Absent now, `404 RESOURCE_NOT_FOUND` "Not found", byte for byte the missing name's answer:** `GET /meta/:type/:name/published` for an item of every type but `object` and `package` whose owning package is disabled, on the stored published row and the code/package snapshot alike. The owner is the one the by-name read's protection envelope names (`packageId`), as `RestServer`'s `/published` asks it. Objects already answered `404 OBJECT_PACKAGE_DISABLED` here.
- **Unchanged:** items of enabled packages, and a name with nothing behind it.

What changes for you: re-enable the package to read its items' published versions again.
