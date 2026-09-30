---
'@objectstack/rest': patch
---

fix(rest): an org's published edit to a packaged dashboard or view is what the `/meta` item and list reads serve, in every locale, instead of the packaged translation of the string it replaced

An organization may edit a packaged dashboard or view in place and publish the edit. The metadata protocol's reads returned the edit, and `?layers=true` reported it as effective, but `GET /api/v1/meta/dashboard/:name`, `GET /api/v1/meta/dashboard`, `GET /api/v1/meta/view/:name` and `GET /api/v1/meta/view` served the bundle's translation of the string the package shipped. For example, a widget retitled `Total Users (edited)` on the platform's `system_overview` dashboard was served as `Total Users` to an `en` reader and as `用户总数` to a `zh-CN` reader. The console draws a dashboard from the list read, so the edit never appeared on the board.

The translators in `@objectstack/spec/system` already let an edited string win over the bundle when they are handed the item as the package shipped it, and the metadata protocol already answers that item (`getPackagedDashboardBase`, `getPackagedViewBase`). The `/meta` reads handed it over for objects only. They now hand it over for dashboards and views too, on both transports that serve `/meta` (the REST server and the runtime's HTTP dispatcher). A view is looked up by its full `<object>.<viewKey>` name.

What a reader sees now:

- An edited string is served as written, in every locale.
- A widget or view the org left alone is still translated.
- Resetting the overlay brings back the shipped string and its translation.
- A dashboard or view with no org edit is served exactly as before.

Nothing to migrate: no key, export or route changed.
