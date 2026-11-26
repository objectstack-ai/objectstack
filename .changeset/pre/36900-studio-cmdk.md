---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

feat(studio): ⌘K on every Studio design page lists the package's whole menu and its items

Clause-②: no
Metadata-protocol: none

Studio redesign: an author switches between items with ×, ‹ › and ⌘K · #36900, part of #36890.

- **⌘K / Ctrl+K opens the command palette on every Studio design page.** That covers a package's pages and its "All metadata" area, the organization's own flows, and the cross-package positions-and-permissions catalog. Until now only the Studio start page had a palette, and the cross-package catalog had lost the one it used to have.
- **On a package it lists the left menu, group by group**: Data, UI, Automation, Platform, Access, AI (数据、界面、自动化、平台、访问、AI), in the menu's order and under the menu's names. Each group holds the menu's own entries (each type's list, Organization flows, Default sharing, Diagnostics, Positions and permissions), then every item of the types it lists, the package's customizations included. Each item shows its type on the right; a customization is marked "Customization of" the package's name. The packages stay listed, so another package is one pick away. On a package the palette no longer lists every package's objects and flows: the package's own items replace them. The organization's flows and the cross-package catalog keep those lists and add their own menu entries.
- **A pick opens what the menu and the lists open**: an object, a flow or a permission set in its designer, any other item on its own page in "All metadata", exactly where its list row leads. A menu entry goes where the menu entry goes.
- **It never drops unsaved work silently.** A pick, like Studio's Back to app, asks first whenever the page holds unsaved edits, the "All metadata" item page's included. A pick of the page already open on another view (Default sharing, from the Access page) reopens that page on it; a pick of the page already shown just closes the palette.
- The query matches an item by its label, its name or its type, and a menu entry by its label, its type or its group. While the package's lists are still loading, an empty result says "Searching…". The item lists are read only once the palette opens.
- Pressing Escape to close a dialog over a full-screen item editor (the palette, for one) no longer also leaves full screen.
