---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
---

perf(console): opening a record no longer re-reads the list under it, asks its field access once, and the bell polls once a minute

Clause-②: no
Metadata-protocol: none

Measured in the console on app-crm, opening one record from a list and closing it again:

- **The list under the drawer is not read again.** The first record opened replaced the list with the route skeleton (the drawer made the route read the whole object registry instead of the app's object scope, and the route waited for it), so the list mounted again and re-read its rows; every later open and close handed the list a different document for its object, which rebuilt its columns and re-ran the list query. The drawer now reads the whole registry beside the route's scope, without holding the route, and the registry joins the scope once it lands with the scope's own documents kept as they are. The list page also holds `columns` and `searchableFields` by value, as it holds the view-type blocks. The record form overlay (`?form=`) still reads the whole registry.
- **One field-access request per record.** The record's sections, highlights, form and page each asked `GET /data/:object/:id/field-access` at once; `ObjectStackAdapter.getRecordFieldAccess` now shares one request between concurrent asks for the same record, remembers a 404 for that record until a write to its object, and stops asking a server that answers 501. A settled answer is not cached: the next ask after a save reaches the server.
- **The bell polls once a minute.** The inbox and approvals feeds polled every 10 s and 30 s on every console page. With no realtime channel in the platform, they now poll every 60 s in the foreground, every three minutes while the tab is hidden (and not at all once it has been hidden for ten minutes), and stop polling altogether while a host reports an open push channel (a pushed change reads the feed it names). A new inbox message can show up to about a minute later.
