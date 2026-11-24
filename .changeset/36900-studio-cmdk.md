---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(studio): ⌘K on every Studio design page lists the package's whole menu and its items

Clause-②: no
Metadata-protocol: none

Studio redesign decision 7 (switch items by ×, ‹ › and ⌘K) · #36900, part of #36890.

- **⌘K / Ctrl+K opens the command palette on every Studio design page**: a package's pillars and "All metadata" area, the package-less flows (`~org`) and the cross-package leg (`~all`). Since the left menu replaced the top pillar nav, only the `/studio` landing had a palette, so `~all` had lost the one it used to have.
- **On a package it lists the left menu, group by group**: Data, UI, Automation, Platform, Access, AI (数据、界面、自动化、平台、访问、AI), in the menu's order and under the menu's names. Each group holds the menu's own entries (each type's list, Organization flows, Default sharing, Diagnostics, Positions and permissions), then every item of the types it lists, read from the package and its `.custom` pair together. Each item shows its type on the right, and a `.custom` item names that package too. The packages stay listed, so another package is one pick away. Every package's objects and flows are no longer listed there: the package's own items replace them. `~org` and `~all` keep those lists and add their own menu entries.
- **What the palette opens comes from the one Studio address builder**: an object, a flow or a permission set opens in its designer, and any other item opens its page in the "All metadata" area on its owning package (`?package=`), the address its list row links to. A menu entry goes where the menu entry goes.
- **It leaves the way the menu does.** With unsaved work on the page it asks first. A pick that is the page already open on another query (Default sharing, from the Access pillar) reopens that page on the new query. A pick of the page already shown just closes the palette.
- The query matches an item by its label, its name or its type, and a menu entry by its label, its type or its group. While the package's lists are still loading, an empty result says "Searching…". Nothing is read until the palette opens.
