---
'@object-ui/app-shell': patch
---

fix(app-shell): ⌘B / Ctrl+B does what the sidebar's expand / collapse button does

Clause-②: no
Metadata-protocol: none

From 768 px up, ⌘B / Ctrl+B is now a press on the console sidebar's expand / collapse button, on a window of any width. With the sidebar beside the page it collapses it; with the sidebar collapsed it puts it back beside the page; either way the browser remembers the choice for that side of 1280 px, as it does for the button, and a reload keeps it. On a window narrower than 1280 px, where the sidebar starts collapsed, ⌘B puts it beside the page and keeps it there. While the menu floats over the page, ⌘B puts it beside the page where it is. The key moves no focus, as a press on the button moves none.

Before, ⌘B floated the menu over the page without changing the collapsed state. The temporary float now comes only from the window's left edge: rest the pointer there, or press there. Unchanged: Esc, a chosen entry and a press outside fold the float; the phone's drawer, which ⌘B still opens and closes; the 1280 px threshold; the sidebar's width. The button's tooltip keeps naming ⌘B, which now does what it says.
