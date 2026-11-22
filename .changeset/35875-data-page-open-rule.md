---
'@object-ui/app-shell': patch
---

fix(console): the bare data page opens a record the way an object's list does

Clause-②: no
Metadata-protocol: none

On the bare data page (`/apps/APP/OBJECT/data`) a click on a record's name used to open the record in the side drawer. It now follows the list's one rule: the name opens the record's full page, and the 「Open in side panel」 icon that appears in the name cell while the row is hovered opens the side drawer over the list (`?recordId=`). The full page carries the data page as its origin, with its URL conditions, its name, the rows it shows and the count it matched: the page's top bar counts the record among them, ↑ ↓ step through them, and its ✕ returns to the data page with its conditions. A click on any other cell still selects it and opens nothing; a touch tap on a row opens the full page; a phone draws no icon; a list-only object's rows still open nothing. `?recordId=` links keep opening the drawer.
