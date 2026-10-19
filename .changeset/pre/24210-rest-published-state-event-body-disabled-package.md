---
'@objectstack/rest': minor
---

fix(rest)!: `/published` and `/meta/object/:name/state/:field` answer a disabled package's item as the by-name read does, and the event and diff doors' absence is the plain read's body

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of two runtime read doors for an item whose owning package is disabled, plus the body of a 404 that already carried this status and code: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the reads -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

- **`GET /meta/:type/:name/published`, every type but `object` and `package`:** a disabled package's item is answered as a name with nothing behind it (`404 NOT_FOUND`, byte for byte), on both exits: the stored published row and the code/package snapshot. The owner is the one the by-name read's protection envelope names (`packageId`). Objects already answered `404 OBJECT_PACKAGE_DISABLED` here.
- **`GET /meta/object/:name/state/:field`:** a disabled package's object is refused `404 OBJECT_PACKAGE_DISABLED`, what `GET /meta/object/:name` answers, as the runtime dispatcher's twin already does. The schema is not read.
- **`/history`, `/audit` and `/diff`:** the `404 RESOURCE_NOT_FOUND` a disabled package's gated item gets is now the plain read's nested body, `{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "Metadata item not found or access denied." } }`, instead of the flat `{ "error": "…", "code": "RESOURCE_NOT_FOUND" }`. Status and code are unchanged; read `body.error.code`.
- **Unchanged:** items of enabled packages, a deleted item, and a name with nothing behind it.

What changes for you: re-enable the package to read its items' published versions and its objects' state machines again.
