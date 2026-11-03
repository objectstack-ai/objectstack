---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's form view canvas draws a horizontal layout with the label beside its control

Clause-②: no
Metadata-protocol: none

A form view saved with `config.layout: 'horizontal'` drew every label stacked above its control in Studio Interfaces, in both Design and Run, while the console's form pages drew it beside. The canvas built its form from the view's `type`, `sections` and `fields` only and left `layout` out. It now passes `layout` through, so the canvas matches what end users see. `vertical` and an unset layout draw as before. Below the `sm` breakpoint a horizontal form still stacks, as it does everywhere.
