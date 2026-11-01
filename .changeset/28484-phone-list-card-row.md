---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

Clause-②: no
Metadata-protocol: none

A phone's list card row now reads like the board's list row: the declared name field as the title, one subtitle line joining the first two shown columns' display values with " · " (a masked or empty value is skipped), and one status chip at the right (the object's status field as `detectStatusField` names it, drawn through its own cell), with no per-column label lines. Every value is drawn through the same cell the desktop row uses, so the amount, date and percent faces the card used to draw on its own are gone. The enlarged related tab on a phone draws these same card rows at the body's full width instead of the inset gallery cards; 768 px and wider are unchanged.
