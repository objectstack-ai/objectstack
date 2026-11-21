---
'@object-ui/app-shell': patch
'@object-ui/components': patch
'@object-ui/react': patch
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

feat(ui): the object's colour tile replaces its line icon wherever else the object is named

Clause-②: yes (widening) — `ConsolePageHeaderProps` gains the optional `iconTile` and `RecordSearchHit` the optional `color`; nothing removed or renamed
Metadata-protocol: none

The tile the navigation already draws for an object (a white glyph on the object's palette colour, gray when it has none) now also names the object in:

- **List and data pages:** the page bar and the view bar's object name in front of the view switcher; the URL data page's header.
- **The record page's related lists:** each section's title, with the list's own icon else the related object's, on that object's colour.
- **Search:** the command palette's recent records, record hits and object entries; the search results page (group headings and hit cards); the global search block.
- **Home:** a record row in "Recently accessed".
- **References:** a pointer cell in a grid (`referenceVia`) and the record hover card.
- **Studio:** the data pillar's object list and header, and the interfaces pillar's object entries and header.

`ConsolePageHeader` takes `iconTile`, an icon that draws its own square, drawn as given in every posture in place of `icon`. `RecordSearchHit.color` carries the object's palette name beside `icon`. `ObjectIconTile`'s glyph keeps its size inside a host row that sizes every nested `svg`.
