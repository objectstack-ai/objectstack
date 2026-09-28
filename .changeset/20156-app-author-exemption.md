---
"@objectstack/rest": patch
---

**The stored-version doors of an app answer by who is asking: whoever may save the app reads it whole, everyone else reads it pruned.** `GET /api/v1/meta/app/:name/layers`, the deprecated `?layers=true` and `…/diff` serve the versions Studio's designer loads and saves back. Until now they served an app the caller may open as stored to every such caller, including the navigation entries that `requiredPermissions` or the documentation audience withhold from them, which exposed those entries' names and targets to members the plain read hides them from.

- A caller who may save the app receives the full stored version on these three doors, so a designer that saves back what it loaded keeps every entry. "May save" is exactly what `PUT /meta/app/:name` admits that caller: a system context or `manage_metadata`. `manage_org_presentation` does not save apps, so it does not qualify.
- Every other caller who may open the app receives it without the entries `requiredPermissions` or the documentation audience withhold from them, left out as the plain read leaves them out: on each layer, and in the values on both sides of a diff. A diff keeps all of its entries; only their values are pruned.
- Unchanged: the plain read (its `?preview=draft` included) and `/published` still prune for every caller, authors included. The plain read's `?state=draft` is the exception: it serves the pending draft, a stored version, and answers as these three doors do. An app the plain read refuses whole (an app-level `requiredPermissions` the caller lacks, or an unpublished app to a caller without Studio or Setup access) is still refused on every door, to an author too. `/history`, `/audit`, and the doc, book and dashboard answers do not change.

A client that reads these doors as a non-author now receives fewer navigation entries. To read an app's full stored version there, read it as a caller the app's save door admits.

For code that runs the shared read gate: `MetaReadGatePolicy.app` is `'gate'` or `'author-exempt'`, and a door that passes `'author-exempt'` supplies the caller's save verdict as `MetaReadGateCaller.mayWriteItem`.
