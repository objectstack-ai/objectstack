---
"@objectstack/rest": patch
---

**The read doors beside `GET /api/v1/meta/:type/:name` now apply the plain read's per-caller gates to docs, books and object schemas.** The plain read withholds a document per caller in several ways. On `doc` and `book` it applies the documentation audience: a `{ permissionSet }`-gated doc or book is `403 PERMISSION_DENIED` to a non-holder and `401 UNAUTHENTICATED` to an anonymous caller. On `app` it applies the navigation filter: an app whose `requiredPermissions` the caller lacks is `403`, an unpublished app is `404` to a non-builder, and gated entries are left out. On `object` schemas it applies the field mask. It also applies the optional-service widget gate on `dashboard`. The doors beside it served the same stored document with none of those gates:

- `GET …/:name/layers`, and the deprecated `GET …/:name?layers=true`, served every layer. This exposed a gated doc's or book's body to any signed-in member. Through `?layers=true`, which sits on the route anonymous callers may reach for public docs, it also exposed any doc or book to a caller who was not signed in.
- `GET …/:name/published` served a gated doc's or book's body, a gated or unpublished app whole, a dashboard's widgets bound to an optional service this deployment lacks, and an object schema's unreadable fields.
- `GET …/:name/diff` served both compared versions' values, including a doc's content and an object's fields.
- `GET …/:name/history` and `GET …/:name/audit` served the change log and audit trail of a doc, book or app the caller may not open.

What each door answers now:

- `/published` answers exactly what the plain read answers the same caller, for every type: the same refusal, or the same pruned or masked document. That includes the dashboard widget gate: a widget bound to an optional service this deployment does not register is left out of `/published`, as it is from the plain read.
- `/layers`, `?layers=true` and `/diff` refuse a `doc` or `book` the plain read refuses, with the same status and code, and mask object fields as the plain read does. `/diff` of a `doc` or `book` with nothing behind the name answers `404 RESOURCE_NOT_FOUND`, as the plain read does. They do not apply the dashboard widget gate or any other per-deployment gate: they show the stored version, which is what an author edits.
- **For `app`, `/layers`, `?layers=true` and `/diff` are unchanged in this release.** They still serve the stored app, including navigation entries the plain read withholds from the caller, to every signed-in caller. What they should answer is pending a decision, because both ways of matching the plain read restrict authors. Pruning the stored app would delete the withheld entries when Studio's designer saves back what it loaded. Refusing it would lock out any author who lacks one entry's permission, platform admins included.
- `/history` and `/audit` answer the plain read's refusal when the plain read refuses the doc, book or app whole. Otherwise they serve the events, which carry no document body.

Types no per-caller gate judges, such as `view` and `flow`, are unchanged on every door. `dashboard` is unchanged on every door except `/published`. A caller the plain read serves in full gets the same answers as before. A client reading these doors as a caller the plain read restricts now receives the plain read's answer, including an integration reading `?layers=true` anonymously. To read a gated doc or book through any of these doors, hold the permission set its book names.
