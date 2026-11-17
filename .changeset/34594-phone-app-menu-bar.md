---
'@object-ui/app-shell': patch
'@object-ui/layout': patch
'@object-ui/i18n': patch
---

feat(console): on a phone, an app's menu is a bar along the bottom edge, and 「More」 opens the full menu with a star on every entry

Clause-②: yes (widening — one @object-ui/layout export + new @object-ui/i18n locale keys; no metadata key)
Metadata-protocol: none

Below 768 px, inside an app, the Console draws a menu bar at the bottom of every list, dashboard, report and page. Before, the app's menu was only in the sidebar drawer, behind an unlabeled icon at the top left.

- The bar holds up to four of the app's entries, then **More**. The four are the entries the user pinned in this app, in their pinned order, then the app's own entries in menu order. Pins are the existing per-user pins (the desktop sidebar's Favorites), so a pin made on one device shows on the others. No metadata key is involved.
- **More** opens the full menu: the app's groups, a search box, and a star on every entry. A tap on the star pins or unpins the entry, and the bar follows at once.
- The top-left control on a phone now goes back to the environment's home. From 768 px up it is still the sidebar toggle.
- A record page and a record form (create or edit) draw no bar: their bottom edge belongs to the record's actions and the form's buttons.

`@object-ui/layout` exports `drawnNavigationEntries(items, options)`: the entries a navigation tree draws, in the sidebar's reading order, through the sidebar's own guards. `AppSchemaRenderer`'s bottom navigation now uses it too, with no change in what it shows.
