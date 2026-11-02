---
'@object-ui/app-shell': patch
---

perf(app-shell): a dashboard opens from the app bundle and asks only its widgets' objects by name

Clause-②: no
Metadata-protocol: none

Every open of `/apps/APP/dashboard/NAME` read the `GET /api/v1/meta/dashboard` list, the whole object registry (`GET /api/v1/meta/object`) and the `GET /api/v1/meta/view` list, and the widgets' dataset queries waited for all three, though the app bundle already held the dashboard. Now:

- The dashboard route reads its dashboard from the app bundle when the bundle holds the one the app's package owns, and the `/meta/dashboard` list (prefer-local) only for a dashboard outside it, as the page route does.
- It reads the app's object scope instead of the whole registry: the objects its widgets require (`requiresObject`), asked by name, beside the app's package list. A widget whose object the server answers absent is left out, as before. A dashboard whose widgets require no object does not wait for any object read.

What the dashboard shows is unchanged.
