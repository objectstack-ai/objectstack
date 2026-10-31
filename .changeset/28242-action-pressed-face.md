---
'@object-ui/core': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

The record header and the declared actions bar now draw an action's `pressed` predicate. A button whose action declares `pressed` is a toggle button: `aria-pressed="true"` and Shadcn's toggle-on face while the predicate holds for this reader and record, `aria-pressed="false"` while it does not. A predicate that cannot be evaluated draws the unpressed button and is reported once. Display only: a pressed action stays enabled and still runs. `ActionDef` declares `pressed`, derived from the spec's `ActionSchema.pressed`.

Clause-②: yes (widening)
Metadata-protocol: none
