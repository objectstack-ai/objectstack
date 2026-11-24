---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(app-shell): on a phone, sign-in lands in an app whose home is its whole menu, and the bottom bar is fixed to Home, Notifications, Approvals and search

Clause-②: no
Metadata-protocol: none

Phone width only (below 768 px). Desktop and tablet widths do not change.

- **Where sign-in lands.** A phone opens the app the person used last. The app the product marks as default is used only when there is no record yet, for example on a first sign-in. With one app it opens that app; with several and neither, it opens the app list. The last app is kept per person with their other console preferences (the `ui.app.last` key), so it follows them across devices. It is read in the same request as those preferences, not in a new one. A desktop still lands on the declared default first, as before.
- **The app's home is its whole menu.** On a phone, `/apps/SEGMENT` shows the app's menu with its groups, order and icons, one row per entry. It no longer redirects to the first entry. This is the sidebar's own menu drawn in a second place, so it cannot list an entry the sidebar hides. 「‹」 on a page one level down goes back to it, and the page comes back scrolled as it was left. An app that shows the member no entry still says so.
- **App switcher.** The app pill at the top left opens a bottom sheet: 「Current app」 with a check, then 「Other apps」 with Setup last, and a search box at the bottom. On a phone, `/home` is that same list as a page.
- **Bottom bar.** The bar has three fixed cells, Home, Notifications and Approvals, and a round search button. They do not change with the app and cannot be configured. Home opens the app's home. Notifications and Approvals open the pages the bell opens, with the bell's two counts as badges. Search opens the command palette. The bar shows only on those three pages; a list, a record, a form or any deeper page has the screen to itself. The bar no longer holds menu entries, a 「More」 cell or pinned entries (objectstack#34594). Pins already stored are ignored, and the drawer's menu search and pin hint are gone. The drawer still opens with a swipe in from the left edge.
