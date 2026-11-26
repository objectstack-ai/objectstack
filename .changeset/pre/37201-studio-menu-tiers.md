---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the left menu shows the 常用 Common types first and folds everything else under one 「高级」 Advanced section

Clause-②: no
Metadata-protocol: none

Studio's left menu on a package now lists the ten Common types first, in building order: Objects · Apps, Pages, Dashboards, Reports · Flows · Permission sets · Agents, Tools, Skills. Every other type, and the four entries that are not a type (Organization flows, Diagnostics, Default sharing, Positions and permissions), sit under one **Advanced** (高级) button below a divider, still under their group names.

- The Advanced section is closed by default. Opening or closing it is remembered per browser in the `studio_menu_advanced` cookie, apart from the menu's own collapse cookie.
- Opening a page that is one of its entries (a bookmark to the hooks list, the default sharing overview) shows the section open, with that entry marked current; this does not change the remembered state.
- The menu search lists matches from both tiers, whether the section is open or not.
- Group names are small muted headings with no number. The muted number beside an entry is its item count.
- A Common type the package holds nothing of is listed anyway, dimmed and with no number, and still opens its list, so a new package shows where to make its first app, page, dashboard or report. Before the item counts have loaded, no type is dimmed.
- The organization's flows (`~org`) and the cross-package catalog (`~all`) have no Advanced section: their entries are listed flat, in the same order.

No address changes: every entry opens the same page as before, bookmarks keep working, and the ⌘K palette lists the same entries in the new order. Two new strings: "Advanced" (高级) and the dimmed entry's tooltip.
