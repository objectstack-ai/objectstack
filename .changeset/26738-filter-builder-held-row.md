---
'@object-ui/app-shell': patch
---

fix(app-shell): "Add filter" in the Studio list-view inspector adds a row that can be edited

Clause-②: no
Metadata-protocol: none

The `filter-builder` widget (the Filter row of the Studio list-view inspector and of each tab preset) now holds its condition rows until they are complete. It used to rebuild the rows from the stored rules on every render, and the save-side fold drops a row that is not complete yet, so the blank row "Add filter" inserts vanished on the next render and no list-view filter could be authored in Studio. An incomplete row now stays on screen and writes nothing; completing it writes exactly the complete rule. What is saved is unchanged: an incomplete rule still never reaches the view, and a stored filter shows as its rows and round-trips as stored.
