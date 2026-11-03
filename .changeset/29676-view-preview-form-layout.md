---
'@object-ui/app-shell': patch
---

fix(app-shell): Studio's form view canvas draws a horizontal layout with the label beside its control

Clause-②: no
Metadata-protocol: none

A form view saved with `config.layout: 'horizontal'` drew every label stacked above its control in Studio Interfaces, in both Design and Run, while the console's form pages drew it beside. The canvas built its form from the view's `type`, `sections` and `fields` only. It now reads `layout` through the same mapping the console's form hosts use, so the canvas matches what end users see. `vertical` and an unset layout draw as before. Below the `sm` breakpoint a horizontal form still stacks, as it does everywhere.

The canvas also passes the other form view keys the form reads: `columns`, `defaultTab` and `tabPosition` (tabbed forms), and `allowSkip` and `showStepIndicator` (wizards). A tabbed view now opens on its authored tab in Studio, as it does on the record page.
