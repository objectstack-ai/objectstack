---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

feat(console): an app's documentation pages draw in the app shell from 768 px up

Clause-②: no
Metadata-protocol: none

From 768 px up every app page lost the top bar and keeps the app menu, search, notifications and account in the sidebar. An app's documentation pages (`/apps/APP/docs`, a book, a flat doc link, an article) were the one exception: they kept the top bar at every width and mounted no sidebar. They now draw like every other app page there: no top bar, the resident sidebar with its usual head (the app-name menu, collapse, search, notifications) and foot (the account), and the page header's button group (assistant and help) at the top right.

The documentation still has one navigation, its own: the sidebar's body carries the docs column (「← Back to APP」, every book of the app with the current one open, a title filter and 「All documentation」) in place of the app's menu. The reader no longer draws that column inside the page there. The app's other docs pages (its docs index, a book with no articles, a book or doc that is not found) carry the same column in the sidebar instead of a back link above the page.

Unchanged: every docs address resolves to the same page as before, and a phone keeps its app bar, no sidebar and the in-page column. The `/docs` portal is not changed by this release. Nothing to migrate.
