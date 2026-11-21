---
'@object-ui/components': patch
'@object-ui/layout': patch
'@object-ui/app-shell': patch
---

feat(ui): every menu row is a tile: objects and their views in the object's colour, everything else on a light grey tile

Clause-②: yes (widening) — `@object-ui/components` adds `NeutralIconTile`, `NeutralIconTileProps` and `NEUTRAL_ICON_TILE_CLASS`; `@object-ui/layout` adds `NAV_KIND_ICON` and `resolveNavKindIcon`; nothing removed or renamed
Metadata-protocol: none

The sidebar drew an object entry as its object's colour tile and every other entry as a bare line icon, so one column mixed solid squares and outlines. Now every row is a tile of the same size and corners, and colour still says only which object a row opens:

- **Object entries, and object entries that open one of its views** (a `viewName`, such as "My deals"): the object's tile, as before.
- **Every other entry** (`dashboard`, `report`, `page`, `url`, `component`, `doc`, `action`): a light grey tile with a dark grey glyph, the entry's own `icon`, else its kind's (`NAV_KIND_ICON`: a dashboard, a column chart, a page, an outward arrow, a grid, a book, a bolt). No kind gets a colour of its own.
- **Recent, Favorites and Starred in the sidebar, and Home's "Recently accessed"**: an object, one of its views or one of its records is that object's tile; a dashboard, page or report is the neutral tile. The emoji these rows drew are gone.
- Group headings and separators are unchanged. The phone's app home lists the same menu, so it follows.
