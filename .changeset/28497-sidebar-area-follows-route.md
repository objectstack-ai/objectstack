---
'@object-ui/app-shell': patch
---

fix(console): the sidebar opens on the area that holds the current page

Clause-②: no
Metadata-protocol: none

In an app with several `areas`, the Console sidebar always opened on the first visible area, so a deep link, a bookmark or a per-audience `landing` that named an entry of a later area showed a menu that did not contain the page the reader was on. Now, on the first render and whenever the route moves to a page no entry of the shown area addresses, the sidebar shows the area whose navigation holds the entry the route addresses, and that entry is highlighted. The match is the one that already highlights the active row, so the area and the highlight agree. With no area holding such an entry, the sidebar keeps the area it shows, else the first visible one. A reader's own area pick holds while they stay on a page an entry of that area addresses.
