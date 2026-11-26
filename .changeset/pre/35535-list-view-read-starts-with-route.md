---
'@object-ui/app-shell': patch
---

perf(console): an object list's saved-view read starts with the route, not after the list's lazy modules

Clause-②: no
Metadata-protocol: none

Opening an object's list (`/apps/APP/OBJECT`, or one of its views) read the object's saved views (`GET /api/v1/meta/view?object=OBJECT`) only once the list page had mounted, which waits for the list's lazy modules to load. On the built console that read left 486-883 ms after the app bundle answered, with no request in flight. The console now starts the same read as soon as the route can render (the app's object scope has settled with the route's object in it), so it runs while those modules load, and the list page joins it when it mounts: still one request per open. The list's first data page is still asked when the list mounts; the saved views are now in hand by then.

Not started under a draft preview (`?preview=draft`), whose list read is a different request, nor on a route whose object the app does not serve. A record page is unchanged. No props, exports or metadata change.
