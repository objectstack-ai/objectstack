---
'@object-ui/fields': patch
---

fix(fields): the people picker's list scrolls by wheel and touch inside a dialog, and in its desktop dialog

Clause-②: no
Metadata-protocol: none

A user field's inline people picker could not be scrolled when it was opened inside a dialog form. Two things held it. The dropdown is rendered outside the dialog, so the form dialog's scroll lock cancelled every wheel and touch move over it; the dropdown is now modal, its own scroll-lock layer, as the lookup dropdown already is. Under that, the list area took the full height of its rows instead of the room the dropdown gives it, so the rows past the bottom edge were clipped rather than scrollable, inside a dialog or not; the list now shrinks to that room and scrolls. The same list in the people picker's centred desktop dialog scrolls now too. While the inline dropdown is open, the page behind it is hidden from assistive technology and a click outside closes it first, as with the other dropdown menus. The phone's bottom sheet is unchanged.
