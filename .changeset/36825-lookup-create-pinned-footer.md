---
'@object-ui/fields': patch
---

fix(fields): a lookup's quick-create and "show all results" stay whole and clickable in a short popover, and its list scrolls inside a dialog

Clause-②: no
Metadata-protocol: none

The lookup popover drew its quick-create row and its "show all results" row as the last children of the scrolling option list. The popover is held to the room the browser leaves on the side it opens to, and when that room is shorter than the list the list shrinks, so those two rows were the first thing cut: in a dialog near the bottom of a short window the create row showed only its top edge and could not be clicked. Inside a modal form the list could not be scrolled to it either, because the form dialog's scroll lock cancelled every wheel and touch move on the popover, which is rendered outside the dialog.

Both rows now sit in a footer pinned under the list, quick-create on the left and "show all results" on the right, and the list is what gives way. The footer shows quick-create only when the field offers it and the user may create the target record, the same rule as before; when there is nothing to create and nothing more to show, no footer is drawn. A search with no match keeps its centred create button. The popover is now modal, its own scroll-lock layer, so its list scrolls by wheel and touch inside a dialog; while it is open the page behind it is hidden from assistive technology and a click outside closes it first, as with the other dropdown menus. The list cell's editor keeps both rows at the end of its list.
