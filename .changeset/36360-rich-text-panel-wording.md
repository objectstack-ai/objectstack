---
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
---

docs(grid): the rich text cell panel is described for the select-first grid only

Clause-②: no
Metadata-protocol: none

The READMEs of `@object-ui/plugin-grid` and `@object-ui/fields` now say that the panel under the cell, with Ctrl/Cmd+Enter and a click outside saving, is the select-first grid's (`cellSelection`). A grid without `cellSelection` opens the text box over the cell, where Ctrl/Cmd+Enter does nothing, Esc discards and a click outside keeps the text as a pending change for the grid's save buttons. Text only; no behaviour changes.
