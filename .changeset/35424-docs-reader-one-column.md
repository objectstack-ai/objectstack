---
'@object-ui/console': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-markdown': patch
'@object-ui/i18n': patch
---

feat(console): an app's docs page has one navigation — the docs column — with the path to its book and the previous and next article

Clause-②: yes (widening) — @object-ui/plugin-markdown exports MermaidEnlargeContext and MermaidEnlargeText; @object-ui/i18n adds 12 help.* keys; nothing removed
Metadata-protocol: none

Inside an app, the documentation pages (`/apps/<app>/docs/…`) no longer draw the app menu beside the docs: the left column is the docs' own, with 「← Back to <app>」 at its top, a title filter, every book of the app's package (the current book open, the others folded, each with its article count; long titles wrap instead of truncating) and 「All documentation →」 at its foot. Every other docs page inside an app (the app's docs index, a book with no articles, a book or doc not found) carries the same 「← Back to <app>」 at its top. The app bar stays, and reads 「<app> / Documentation」; the separate 「Documentation / <title>」 bar under it is gone, and the path above the article names the book (Documentation › <book>). 「On this page」 marks the section being read as the page scrolls, and the article ends with its book's previous and next article. The article column is 720 px wide at 15 px, and a diagram carries an 「Enlarge」 control that opens it full size.

`@object-ui/plugin-markdown` adds `MermaidEnlargeContext`: a host that provides its words gets the enlarge control on every rendered diagram; with no provider a diagram renders exactly as before. `@object-ui/app-shell` exports `matchAppBySegment` and `useServedAppLabel`, and `isAppDocsPath` beside `isRecordPagePath` from its `ConsoleLayout` module. New `help.*` keys in every shipped locale. No doc content, doc metadata, route or API changes.
