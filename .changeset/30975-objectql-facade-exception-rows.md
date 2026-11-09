---
'@objectstack/objectql': patch
---

refactor(objectql): four more `engine.ts` bodies move into their facets

Clause-②: no
Metadata-protocol: none

- `ObjectQL#homeAmountServing` moves into `ReferencesAndMasterDetailFacet` unchanged. Its one call of the home-localization resolver now goes through the facet's host, so the resolver is called with the host as its receiver instead of the engine. The resolver type takes no `this`, and the only one the platform installs is an arrow function, so nothing reads that receiver.
- `ObjectQL#projectHomeAmountsOntoPatch` keeps its body in the facet. The class method now passes `serving` through as given, and the facet computes the default when the caller passes none, as the class did before.
- `ScopedContext`'s private `derive` and its `[APP_AUTHORED_HOOK_API]` method move into `ScopedContextFacet`. Each builds a new `ScopedContext` and sets that instance's private `appAuthored` through the instance's own internal host, which is not exported. A derived api still keeps the app-authored mark, and an app-authored hook's api still refuses a permanent delete.
- No behaviour changes and nothing to do on upgrade. The built declaration files are unchanged; the JavaScript moves between modules inside the bundle.
