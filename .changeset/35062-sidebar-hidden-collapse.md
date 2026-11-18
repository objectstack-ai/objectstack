---
'@object-ui/app-shell': patch
---

fix(app-shell): a collapsed console sidebar hides fully, and its full menu floats out from the window's left edge

Clause-②: no
Metadata-protocol: none

From 768 px up, a collapsed app sidebar no longer leaves a column of unlabelled icons: it is hidden, the list and record pages get its width, and nothing in it can be focused or is announced. Both ways of collapsing look the same: collapsing it with the app bar's button, and the fold that collapses it on its own on a window narrower than 1416 px. To get the menu back, rest the pointer on the window's left edge (or press there): the full menu, with its labels and groups, floats over the page and folds back when the pointer moves away, a choice is made, Esc is pressed or the page is clicked. Floating it does not expand the sidebar, so a reload still finds it collapsed. The app bar's button and ⌘B work as before: on a sidebar you collapsed they expand it beside the page, and while it is folded on a narrow window they float the menu and move the keyboard focus into it; Esc gives focus back to the button. "Keep sidebar open" still stops the fold. The phone keeps its bottom menu bar and drawer.
