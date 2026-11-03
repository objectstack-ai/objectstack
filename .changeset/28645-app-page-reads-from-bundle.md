---
'@object-ui/app-shell': patch
'@object-ui/data-objectstack': patch
---

perf(console): an app page reads its views, its page and its nav dashboards from the app bundle, and reads the `/meta/view`, `/meta/page` and `/meta/dashboard` lists only for what the bundle does not hold

Clause-②: yes (widening)
Metadata-protocol: none

Since the app metadata bundle landed, entering an app downloads the app, its objects and their views, pages and dashboards in one request. The console still read the per-type lists beside it. Now:

- **`view` is no longer read at mount.** An object the bundle holds is composed with the bundle's views. A route's object scope reads the `/meta/view` list only when a name it asks is outside the bundle, and then only for the objects the bundle does not hold; such a scope waits for the list before it answers. The whole object registry still reads the list beside it.
- **The console enters the app's bundle once, at its root**, as soon as the app list names the app, and `AppContent` reuses that entry instead of asking the bundle again. Leaving the app ends the entry, so coming back revalidates it.
- **Whether an object exists** (the presence check of the bell and activity surfaces) is asked without views, so it never reads the `/meta/view` list.
- **The page a page route opens** (`/apps/APP/page/NAME`), the phone bar's page or dashboard title, a dashboard nav entry's label and a recent page's label are read from the bundle first. A name the bundle does not hold, or a same-named item another package owns, is read from the list as before, prefer-local resolution included. The page route no longer waits for the page list to load.
- **The app bar reads views only on an object's view route**, the one title that labels a view.
- **New in `@object-ui/data-objectstack`:** `ObjectStackAdapter.peekAppBundle()` reads the active app bundle without waiting (`none` before an app is entered, `pending` while its first answer is on the wire, `ready` with its items), and the types `AppBundlePeek`, `AppBundleItems` and `AppBundleEntry` are exported. A stale bundle is revalidated with `If-None-Match` and keeps answering from what it holds until the revalidation lands.

Navigation sync still reads the page and dashboard lists after the first paint; that read is not changed here.
