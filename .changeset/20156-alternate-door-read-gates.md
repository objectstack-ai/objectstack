---
"@objectstack/rest": patch
---

**Every read door beside `GET /api/v1/meta/:type/:name` now applies the same per-caller read gate as the plain read.** The plain read withholds a document per caller in four ways: the documentation audience on `doc` and `book` (a `{ permissionSet }`-gated doc or book is `403 PERMISSION_DENIED` to a non-holder, `401 UNAUTHENTICATED` to an anonymous caller), the app navigation filter on `app` (an app whose `requiredPermissions` the caller lacks is `403`, an unpublished app is `404` to a non-builder, and entries gated by `requiredPermissions` or the docs audience are left out), and the field mask on `object` schemas. The doors beside it served the same stored document with none of those gates:

- `GET …/:name/layers`, and the deprecated `GET …/:name?layers=true`, served every layer. This exposed a gated doc's or book's body to any signed-in member. Through `?layers=true`, which sits on the route anonymous callers may reach for public docs, it also exposed any doc or book to a caller who was not signed in.
- `GET …/:name/published` served a gated doc's or book's body, a gated or unpublished app whole, and an object schema's unreadable fields.
- `GET …/:name/diff` served both compared versions' values, including a doc's content, an app's navigation and an object's fields.
- `GET …/:name/history` and `GET …/:name/audit` served the change log and audit trail of an item the caller may not open.

What each door answers now:

- `/published` answers exactly what the plain read answers the same caller: the same refusal, or the same pruned or masked document.
- `/layers`, `?layers=true` and `/diff` serve stored versions. Where the plain read refuses the item, they refuse it with the same status and code. Where the plain read would serve a caller only part of an app, they answer `403 PERMISSION_DENIED` instead of a pruned version, because Studio's designer saves back what it loads, and a pruned version saved back deletes the entries withheld from that caller. They mask object fields as the plain read does. Per-deployment gates are not applied to them: a dashboard widget or app entry whose optional service is off in this deployment is still shown, because it is stored.
- `/history` and `/audit` answer the plain read's refusal when the plain read refuses the item whole. Otherwise they serve the events, which carry no document body.
- `/diff` of a `doc`, `book` or `app` with nothing behind the name answers `404 RESOURCE_NOT_FOUND`, as the plain read does.

Nothing changes for a caller the plain read serves in full: every door answers as before. Types no per-caller gate judges (`view`, `flow`, and others) are untouched on every door. A client reading these doors as a caller the plain read restricts now receives the plain read's answer. That includes an integration reading `?layers=true` anonymously. To read a gated doc, hold the permission set its book names. To use the layered view or the diff of an app, hold every permission its entries require.
