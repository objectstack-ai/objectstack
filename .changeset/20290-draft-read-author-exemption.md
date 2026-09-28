---
"@objectstack/rest": patch
---

**`GET /api/v1/meta/:type/:name?state=draft` now serves the pending draft as a stored version: whoever may save an app reads its draft whole, and nothing is left out because a service is off in this deployment.** Studio's app editors build their edit baseline by merging this draft over the layered view (`…/layers`) and save the result back as a draft. The draft read used to run the rendered read's gates, so it left out the navigation entries an author may not open. For every caller it also left out an entry, an app or a dashboard widget bound to an optional service this deployment does not register. The pruned draft replaced the whole navigation in the merge, and the author's next draft save deleted those entries without any error.

- A caller who may save the app (the one `PUT /api/v1/meta/app/:name` admits: a system context or `manage_metadata`) receives the stored draft whole, including the entries that `requiredPermissions` or the documentation audience withhold from them. This is the answer `/layers`, `?layers=true` and `/diff` already give that caller.
- Every other caller who may open the app receives the draft without the entries `requiredPermissions` or the documentation audience withhold from them, as before.
- No caller has anything left out of a draft by a per-deployment gate any more: an app, a navigation entry or a dashboard widget whose `requiresService` names a service this deployment lacks is part of the stored draft, as on `/layers`.
- Unchanged: an app the plain read refuses whole (an app-level `requiredPermissions` the caller lacks, or an unpublished app to a caller without Studio or Setup access) is still refused on the draft read, to an author too. A read with no pending draft still answers `404 NO_DRAFT`. The rendered reads, meaning the plain read without `?state=draft`, its `?preview=draft` preview and `/published`, still prune for every caller, authors included. Docs, books and object schemas answer as before.

A client that reads `?state=draft` as a caller who may save the app now receives every entry of the stored draft. A client that reads it as any caller now also receives the entries and widgets bound to an optional service this deployment lacks.
