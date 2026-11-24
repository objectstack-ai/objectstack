---
'@object-ui/app-shell': patch
---

fix(app-shell): a collapsed console sidebar hides fully, and its full menu floats out from the window's left edge

Clause-②: no
Metadata-protocol: none

From 768 px up, a collapsed app sidebar no longer leaves a column of unlabelled icons: it is hidden, the list and record pages get its width, and nothing in it can be focused or is announced. Both ways of collapsing look the same: collapsing it with the app bar's button, and the fold that collapses it on its own on a window narrower than 1416 px. To get the menu back, rest the pointer on the window's left edge (or press there): the full menu, with its labels and groups, floats over the page and folds back when the pointer moves away, a choice is made, Esc is pressed or the page is clicked. The app bar's button and ⌘B float the same menu, however the sidebar was collapsed, and move the keyboard focus into it; Esc gives focus back to the button. Floating it does not expand the sidebar, so a reload still finds it collapsed. To put the sidebar back beside the page, choose "Keep sidebar open" at the foot of the floated menu: the sidebar stays expanded, after a reload too, and on a narrow window the fold stays off. The phone keeps its bottom menu bar and drawer.
