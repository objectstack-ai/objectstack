---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@objectstack/console': patch
---

feat(console): the documentation portal draws in the app shell's frame from 768 px up, belonging to no app

Clause-②: no
Metadata-protocol: none

The documentation portal (`/docs`, a book, an article) was the last desktop page that still drew a top bar, in a frame of its own, while an app's documentation pages draw in the app shell. From 768 px up the portal now draws in the same frame, in a variant that belongs to no app: no top bar; the sidebar with search and notifications in its head and the account at its foot; the page header's assistant and help buttons at the top right. Where an app's name sits in its sidebar, the portal's sidebar shows a neutral 「Documentation」 heading; it opens the list of your apps (none marked current) and 「Add app」, and choosing an app opens it. The sidebar's body is the documentation tree: 「All documentation」 first, a title filter, then every book under the heading of the app that carries it, as the portal's index groups them, with the book being read open. Books are named as the index names them, so a platform app's book reads as the app does (for example 「系统设置」) instead of its package's short name.

Opening the portal does not pick an app: no app's colours are applied, and the app you last used, and the one you had open, stay what they were.

「All documentation」 is now also the first row of an app's documentation sidebar, above 「← Back to APP」, so the two documentation sidebars match.

Unchanged: every documentation address resolves to the same page as before, and a phone keeps the portal's documentation bar and the in-page column, with 「All documentation」 at its foot. Nothing to migrate.
