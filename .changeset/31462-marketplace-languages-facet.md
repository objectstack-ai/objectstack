---
'@object-ui/app-shell': patch
---

feat(app-shell): the marketplace catalog filters by the languages an app ships

Clause-②: no
Metadata-protocol: none

The catalog gains a Languages row beside the business-function, industry and type filters. Its buttons are the catalog's own language counts (`facets.languages` on the list answer): each language is named the way the header's language menu names it, carries how many listings ship it, and keeps the catalog's order. Picking languages narrows the catalog to listings whose latest release ships any of them (`?languages=zh-CN,ja-JP`, combined with the other filters). Picking one keeps the others on offer, and a picked language that another filter narrows to none stays on the row so it can be cleared. A catalog that serves no language counts draws no row.

The package page and the catalog card now mark a version's default language by the measured `default_locale` and list it first, instead of taking the first language listed: the measurement lists languages in bundle order when an app declares none, so the default is not always first.

No new strings: the row reuses the Languages label added with the language line.
