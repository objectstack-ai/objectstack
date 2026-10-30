---
'@object-ui/fields': patch
---

fix(fields): an empty currency or percent box shows the field's own placeholder, or none, instead of `0.00` / `0` (#27398)

Clause-②: no
Metadata-protocol: none

The edit-mode `CurrencyField` fell back to the placeholder `0.00` whenever the field declared none, so an optional amount nobody had filled in (a public form's Annual Revenue) read as a filled-in zero, and a JPY or KWD field was offered a two-decimal stand-in. It now shows the field's `placeholder` when one is declared and nothing otherwise, as `NumberField` does. It reaches every host that draws the widget: the public form, the record form and the grid's inline editor. A real zero still shows as `0`, and an authored placeholder (including one a form row overrides) is shown as before.

The edit-mode `PercentField` had the same fallback, the placeholder `0`, which beside its `%` adornment read as a filled-in 0%; it now shows the field's `placeholder` or nothing, the same way.
