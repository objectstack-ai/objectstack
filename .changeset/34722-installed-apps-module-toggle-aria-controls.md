---
'@object-ui/app-shell': patch
---

fix(app-shell): the Installed Apps module toggle names the module lines it shows

Clause-②: no
Metadata-protocol: none

In Setup › Installed Apps, the button that shows and hides an app's modules carried `aria-controls` with an id that no element had, so a screen reader was pointed at nothing. Each module line now has its own id. While the modules are shown, the button's `aria-controls` lists those ids. While they are hidden, the lines are not drawn and the button has no `aria-controls`. `aria-expanded` is unchanged.
