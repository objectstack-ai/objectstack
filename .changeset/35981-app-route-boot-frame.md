---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

perf(console): an app route draws the console's frame right after the session read, and the chrome no longer waits for the route's own metadata

Clause-②: no
Metadata-protocol: none

Opening an app page by its URL (a reload, a pasted link) showed the full-screen splash until the permission answer, the app list, the admin verdict and the page's own metadata reads had all arrived. On a hosted environment the permission answer alone takes seconds.

- `LoadingFallback` (the console's boot-gate fallback) and `AppContent`'s readiness gate now draw `ConsoleBootShell` on an `/apps/:app/*` route once the session has answered with a user: the chrome's frame (the sidebar at the width the reader left it, from 768 px up with grey blocks where its head and foot put the app menu, the search, the bell and the account; the top bar on a phone, except on a record page, and on an app's docs pages, which have no sidebar; the route's skeleton in the slot: the shape the chrome draws on that route), with no app name, no navigation entry and nothing to press, because those are what the gates still decide. The splash stays for the session read itself and for every other route. The console's permission scope uses the same fallback.
- `AppContent` mounts the console chrome once the app list, the permission answer and the admin verdict are in; the route's own metadata reads no longer hold it on the first paint. The route slot draws the route's skeleton until they land, and a route element whose chunk is still loading draws the same skeleton instead of the full-screen splash inside the chrome.
- The frame and the first route skeleton carry `data-boot-splash`, so readiness waits and the reads deferred to the first paint past the splash wait exactly as before; `data-boot-shell` tells the frame apart.
