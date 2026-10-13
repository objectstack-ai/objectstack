---
"@objectstack/rest": minor
---

feat(rest): the `/meta` read gate enforces a list view's and a dashboard's `requiredPermissions` (#22639)

Clause-②: yes (widening)

- **What the server now does.** `requiredPermissions` on a list view and on a dashboard is a list of capabilities a user must ALL hold, the same key and meaning as on an app, a navigation item and an action. The `/meta` read gate applies it through the one predicate the app arm uses (`holdsRequiredPermissions`), on both transports (`RestServer` and the runtime dispatcher's `/meta` domain):
  - `GET /api/v1/meta/view` and `GET /api/v1/meta/dashboard` list only what the caller may open. A view the caller does not hold is left out, so the console's view switcher (`?object=`) lists only the views the caller may open. A view container is listed minus the `list` / `listViews` entries the caller does not hold.
  - `GET /api/v1/meta/view/:name` and `GET /api/v1/meta/dashboard/:name` refuse a view or a dashboard the caller does not hold with `403 PERMISSION_DENIED`, the same refusal and envelope an app the caller may not open gets. Every alternate door of the read refuses it too (`/published`, `/layers`, `?layers=`, `?state=draft`, `/diff`, `/history`, `/audit`), to an author as to anyone.
  - `GET /api/v1/meta/object` and `/meta/object/:name` serve an object without the `listViews` entries the caller does not hold. A caller who may edit the object (the ADR-0106 D4 exemption the field mask already honours) reads every list view, so a save of what they loaded keeps them.
  - A view container is served whole to a caller who may write it on the stored-version doors (`/layers`, `?layers=`, `/diff`, `?state=draft`), as an app is, so a designer's save keeps the entries withheld from its author elsewhere.
- **Caching.** The plain read's cached arm runs the same gate for `view` and `object`. Its `ETag` folds in what the gate withheld, and the conditional request is judged against that validator, so a caller who no longer holds a capability is never answered a `304` for the body that carried the gated view. When nothing is withheld the `ETag` is the same as before.
- **Type surface.** `MetaItemReadRefusal` gains the `audience-permission` reason (`403 PERMISSION_DENIED`). A consumer that switches on `reason` writes it the way it writes `app-permission`.
- **Nothing to migrate.** Only a list view or a dashboard that sets `requiredPermissions` is affected. The key was not accepted on either before the release that declared it.
