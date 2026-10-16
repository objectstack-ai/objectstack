---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': patch
---

feat(spec): the app item read answers by package id. `GET /meta/app/<packageId>` returns the package's app, or the same 403 / 404 the read by name gives (ADR-0048 §3.1)

Clause-②: yes (widening)

ADR-0048 §3.1 makes an installed package's id the route key of its UI. With one app per package the app is the package container, so the console opens an app at `/apps/<packageId>`. The app item read now accepts that key too.

- **`GetMetaItemRequestSchema.name`** declares it. For `type: 'app'` only, a key in the package-id grammar (`MANIFEST_ID_PATTERN`, at least one dot) names the package. App names are snake_case with no dot, so the two grammars never overlap and every read by name is unchanged. The new export `isAppPackageIdKey(type, name)` is the one test for the arm.
- **`getMetaItem`** (`@objectstack/metadata-protocol`) resolves it to the package's one app, as the package-scoped list (`GET /meta/app?package=<id>`) serves it, read by its own name in that package. The response's `name` is the app's name. Both hosts' item reads (`RestServer` and the `@objectstack/hono` catch-all) answer it with no change of their own, and the per-caller read gate judges the app exactly as it does by name:
  - a caller the app is withheld from gets `403 PERMISSION_DENIED`;
  - an unknown package, a package with no app, a package whose app is unpublished, and a package holding more than one app all get the `404` absence answer, byte-identical to the one for an unknown app name. A package holding more than one app (ADR-0019 D3 allows at most one) is also reported once in the server log, naming its apps;
  - a caller who holds the app is served it.
- A `packageId` (`?package=`) naming a different package than the key is refused with `400 INVALID_REQUEST`.
- `/meta/app/<key>/history`, `/audit` and `/diff` stay by name (`@objectstack/rest`): the package-id key belongs to the plain item read only.

From a client: `client.meta.getItem('app', 'com.acme.crm')`.
