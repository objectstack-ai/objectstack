---
'@object-ui/app-shell': patch
---

fix(console): the bare data page's side drawer draws ⤢ 「Open as full page」

Clause-②: no
Metadata-protocol: none

On the bare data page (`/apps/APP/OBJECT/data`), the side drawer a record opens in (from the name cell's 「Open in side panel」 icon, or a `?recordId=` link) now draws the same ⤢ 「Open as full page」 button in its top bar that the object list's drawer draws. It closes the drawer and opens the record's full page with the same origin a click on the record's name carries: the data page's URL with its conditions, its name, the rows it shows and the count it matched. The full page's ✕ returns to the data page with its conditions and no drawer.
