---
'@object-ui/fields': patch
---

fix(fields): a lookup's picker is wide enough to read an option name, and never wider than the screen

Clause-②: no
Metadata-protocol: none

The lookup picker opened exactly as wide as its trigger. In a narrow line-item grid cell that left the options a few letters wide, so a product read as "Data Migr…" and could not be told from the next one. The picker keeps its trigger's width when the trigger is wider, is never narrower than 18rem, and is capped at the width the viewport leaves on the side it opens to, floor included, so on a narrow phone screen it fits inside the viewport instead of running past its edge. A picker opened from a cell at the right edge moves left to stay on screen. Nothing changes in what a lookup searches, filters or stores.
