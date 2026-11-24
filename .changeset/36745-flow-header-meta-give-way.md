---
'@object-ui/app-shell': patch
---

fix(studio): the flow header's meta gives way item by item instead of shrinking every item to one character

In Studio's Automations pillar, the open flow's header shows its meta beside the title: Trigger, Status, Run as, version and, when set, On error. When the row was short of room — with the property panel open, about 80 px were left — every item shrank at once, so the row read as single characters with ellipses.

Each item now keeps its whole text. When the row cannot hold them all, they drop from the end (On error, then version, then Run as), and hovering the row names each dropped item in full. Trigger and Status always show together: when the row cannot hold those two whole, the meta hides and the hover text names every item. Widen the row and the dropped items come back. The designer's info bar is unchanged.
