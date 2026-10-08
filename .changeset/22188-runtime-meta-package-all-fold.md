---
"@objectstack/runtime": patch
---

The runtime dispatcher's `/meta` domain reads `?package=all` as naming no package, as `RestServer` does, so a `PUT ?package=all` through the `@objectstack/hono` catch-all no longer binds the row to a package called `all`

Clause-②: no

- The dispatcher's `PUT /meta/:type/:name?package=all` stored the row with `package_id: 'all'`. It now stores it env-local (`package_id` null), as `RestServer`'s `PUT` does.
- Its layered read (`/meta/:type/:name/layers`), list (`/meta/:type`), book tree (`/meta/book/:name/tree`) and item read forwarded `all` to the store as a package id. The layered read answered `404` and the list `[]` for an item stored in a package. Each now answers `?package=all` as it answers the same request without `?package=`.
- Every branch reads `?package=` through `metaItemPackageBinding` from `@objectstack/rest`, the function `RestServer`'s doors read it through.
- Unchanged: a real package id still scopes each read and still binds a save.
