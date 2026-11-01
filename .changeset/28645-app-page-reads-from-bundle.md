---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
---

perf(console): an app page reads its views, its page and its nav dashboards from the app bundle, and reads the `/meta/view`, `/meta/page` and `/meta/dashboard` lists only for what the bundle does not hold

Clause-②: yes (widening)
Metadata-protocol: none

Since the app metadata bundle landed, entering an app downloads the app, its objects and their views, pages and dashboards in one request. The console still read the per-type lists beside it. Now:

- **`view` is no longer read at mount.** A set of objects a route composes is composed with the bundle's views when the bundle holds every one of those objects. The `/meta/view` list is read beside the whole object registry, or for a set holding an object outside the bundle, and such a set waits for it before it answers.
- **The page a page route opens** (`/apps/APP/page/NAME`), the phone bar's page or dashboard title, a dashboard nav entry's label and a recent page's label are read from the bundle first. A name the bundle does not hold, or a same-named item another package owns, is read from the list as before, prefer-local resolution included. The page route no longer waits for the page list to load.
- **The app bar reads views only on an object's view route**, the one title that labels a view.
- **New in `@object-ui/data-objectstack`:** `ObjectStackAdapter.peekAppBundle()` reads the active app bundle without waiting (`none` before an app is entered, `pending` while its first answer is on the wire, `ready` with its items), and the types `AppBundlePeek`, `AppBundleItems` and `AppBundleEntry` are exported. A stale bundle is revalidated with `If-None-Match` and keeps answering from what it holds until the revalidation lands.

Navigation sync still reads the page and dashboard lists after the first paint; that read is not changed here.
