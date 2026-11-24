---
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

fix(i18n): the full search page names component, doc and link results in every language

Clause-②: no
Metadata-protocol: none

The console's full search page (opened from the command palette's "Open Full Search Page") titles each result group and badges each result by the navigation item's type. Component items, doc items and link items printed raw keys (`search.typeComponents`, `search.badgeDoc`, `search.typeUrls`, …) because no locale pack defined them, English included. Every shipped console locale pack now carries a heading and a badge for the three types, and the search placeholder and its accessible label also name components and docs. A new test in `@object-ui/app-shell` renders the page with one navigation item of every spec type and fails when any heading or badge key the page asks for is missing from a pack.
