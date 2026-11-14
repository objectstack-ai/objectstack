---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
---

fix: a row action's declared `disabled` predicate greys its inline row button, and every row surface gives its `disabledReason`

Clause-②: yes (widening) — new exports `useDisabledReason`, `DisabledReasonTrigger`, `DisabledReasonMenuLabel`, `menuItemReasonAria` and the type `DisabledReason` from `@object-ui/components`, the helper the `action:*` renderers already used, now shared with `@object-ui/plugin-grid`'s row menu. Nothing that rendered before is refused.
Metadata-protocol: none

An action placed on list rows (`list_item`, or `record_related` on a parent's related list) with `variant: 'primary'` renders as the row's inline button. That button ignored the action's `disabled` predicate: it stayed enabled and clickable on a row whose record made `disabled` true, while the same action in the record header rendered disabled. `ActionSchema.disabled` reads "shown but refused when it evaluates TRUE", so the row now does what the header does:

- **Inline row button** (`@object-ui/plugin-grid`, the object list and the enlarged related list): `disabled` is evaluated with the same row-predicate evaluator the "⋮" item beside it uses, against that row's record. A predicate that faults disables the button, as on the record header. A disabled button carries the action's `disabledReason` (the generic "Not available for this record" when it declares none) as its `aria-describedby` and in a tooltip on a focusable wrapper.
- **"⋮" row menu items** (`@object-ui/plugin-grid`'s grid row menu and `@object-ui/components`' `data-table` row menu, which the record page's related list draws): they already greyed out on a true `disabled`; they now also show the reason as a second line under the label and name it as the item's accessible description, the way `action:menu` does.

The server still refuses a disabled action's call either way; this is the display catching up with the declaration.
