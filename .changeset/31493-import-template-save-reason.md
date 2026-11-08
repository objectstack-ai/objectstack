---
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

fix(plugin-grid): the import wizard's "Save current" template button says why it is disabled

Clause-②: yes (widening)
Metadata-protocol: none

On the mapping step, while no column is mapped, "Save current" in the mapping-template bar was natively disabled with no reason: no tooltip on hover, no accessible description, and Tab skipped it. It now sits in a focusable wrapper, the same pattern as the step's Next button, whose tooltip and accessible description read "Map at least one column to save a template." Once a column is mapped it is a plain enabled button, as before. The sentence is a new `grid.import.saveCurrentNeedsMapping` key in every `@object-ui/i18n` locale pack.
