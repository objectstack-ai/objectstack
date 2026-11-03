---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a push route from the mobile shell opens the record, hosted under an app the way the inbox hosts it

Clause-②: no
Metadata-protocol: none

A push delivery carries the notification's link as `route`: app-relative (`/opportunity/123`) or already a Console route (`/apps/crm/opportunity/123`). The Console's listener for the mobile shell's navigate event moved its router to that route as written, so `/opportunity/123` matched no route and the person landed on Home instead of the record.

What changes:

- The listener resolves the route with the same resolver the inbox bell and Home use for that notification. An app-relative route is hosted under the app the person is in or last had open; an `/apps/...` route passes through unchanged.
- With no app open yet (a tap that starts the app), the route goes to the router as given, and the Console's unmatched-route page hosts it under the default app once the app list has loaded: the app the person last had open while it is still active, else the first active app. The same page handles an app-relative path that arrives as the page's first URL, which the shell sends when it re-creates its web view at a held route or when no listener answered.
- A path whose first segment names a Console route served outside an app (`/home`, `/dev`, `/studio`, ...) still redirects to `/`, as before. A path such as `/foo/bar` that names no Console route now opens `/apps/<default app>/foo/bar` instead of Home.
- `@object-ui/app-shell` exports `resolveNotificationTarget`, its `NotificationTarget` type and `CONSOLE_ROOT_SEGMENTS` from the package root.

What to do: nothing.
