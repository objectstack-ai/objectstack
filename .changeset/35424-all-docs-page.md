---
'@objectstack/client': patch
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the 「All documentation」 page has the console's top bar, groups its books by app, and searches every article

Clause-②: yes (widening) — @objectstack/client `meta.getItems` takes an optional `include` (`'content' | 'grants'`, sent as `?include=`) and exports its options type `MetaItemsListOptions`; @object-ui/i18n adds nine help.* keys (two of them plural, with their per-locale forms); nothing removed
Metadata-protocol: none

- **The console's top bar on every portal page.** `/docs`, a book (`/docs/<book>`) and an article (`/docs/<book>/<article>`) are drawn in Home's frame, whose bar reads 「<product> / Documentation」 (the crumb links to the portal's index) and carries the search, the inbox, the assistant and the avatar menu, so the reader can go back to any app. The portal's own 「Documentation / <title>」 strip is gone.
- **Books grouped by app.** The page lists each app's books under the app's name, as the launcher names it: a book goes under the first app whose navigation links to it (a module's navigation contributions included), else under its package's app; books no app carries are listed last under 「Other documentation」. No card shows a package id; a package's docs with no authored book are named by their app. A platform package's books (`com.objectstack.*`, such as Setup's) are listed only under an app in the member's list that carries them, never under 「Other documentation」, so they are not listed for a member whose app list has no such app. This is what the page lists, not who may read a doc: the server's audience gate decides that, as before.
- **The subtitle and the counts read the session language** (「9 篇」, not 「9 articles」).
- **「Search all documentation」.** A search field on the page searches every listed article's title, summary and body, and lists the matches with the words marked in context; each opens the article in its own book. The bodies are asked once, the first time the reader searches (`GET /meta/doc?include=content`, through the same audience gate as the list). The query stays in the URL (`?q=`).
- **A hand-typed article URL whose book does not hold the article** (`/docs/<book A>/<article of book B>`) now opens the article in its own book; with no book that holds it, the article draws no previous/next pager instead of showing both ends at once. Inside an app, an article whose book is in no package now keeps its 「← Back to <app>」 link.

`@objectstack/client`: `client.meta.getItems(type, { include })` and the environment-scoped `meta.getItems` send `?include=`; leaving it out sends nothing, as before. `@object-ui/app-shell`: `AppHeader` takes a `docs` variant and `DefaultHomeLayout` a `variant` prop for it.
