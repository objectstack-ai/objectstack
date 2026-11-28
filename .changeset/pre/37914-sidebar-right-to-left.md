---
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

fix(components): in a right-to-left language the desktop sidebar sits beside the page instead of over its header

Clause-②: no
Metadata-protocol: none

In Arabic (the console sets `dir="rtl"` on the page) the desktop sidebar's gap moved to the right while its fixed panel stayed on the left, so the panel covered the end of every page, where a right-to-left page header keeps its buttons: the page's own actions, help, comments and Ask AI entry could not be reached. The sidebar primitive now places its panel, its divider and its edge rail with logical insets, so `side="left"` is the inline start of the document (the right edge in Arabic) and `side="right"` its end. The edits are declared as the `sidebarLogicalInsetPatches` shadcn local-patch family, with the offcanvas family's offsets written the same way, so a registry sync keeps them.

`@object-ui/app-shell`: the console sidebar's own anchors follow it. The edge strip that floats a hidden sidebar, the floating card and its parked position, the resize edge and the expand button on pages with no header sit at the inline start, and the resize edge reads a drag and the arrow keys toward the page as widening in either direction. A floating menu folds when the pointer leaves it on either side.

Left-to-right languages are unchanged: every logical inset computes to the physical one it replaces.
