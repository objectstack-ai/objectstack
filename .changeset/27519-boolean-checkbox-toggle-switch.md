---
'@object-ui/fields': patch
'@object-ui/app-shell': patch
---

fix(fields): a `boolean` field draws a checkbox and a `toggle` field a switch, in the record form, the grid's inline editor and the Studio canvas preview

Clause-②: yes (widening) — `@object-ui/fields` gains two public exports, `resolveBooleanControl` and `type BooleanControl`
Metadata-protocol: none

Studio's type picker offers "Checkbox — shown as a checkbox" (`boolean`) and "Toggle — shown as a switch" (`toggle`), but both types reached the one `field:boolean` widget, which drew a switch unless the field carried `widget: 'checkbox'`. A field authored as Checkbox therefore drew a switch on the Studio canvas and in the runtime create form. `resolveBooleanControl` (exported from `@object-ui/fields`) is now the one answer: `boolean` draws a checkbox, `toggle` a switch, and an explicit `widget` of `checkbox` / `boolean` or `switch` / `toggle` overrides the type. `BooleanField` and the canvas's control preview both read it.

Forms that relied on a `boolean` field drawing a switch now draw a checkbox; declare the field as `toggle`, or set `widget: 'switch'`, to keep the switch.
