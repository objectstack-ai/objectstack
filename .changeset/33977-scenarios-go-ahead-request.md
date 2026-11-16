---
'@objectstack/scenarios': patch
---

fix(scenarios): a reply that asks for the person's go-ahead before a write grades as `pending_confirmation`, and the invoice card's `add_line` ask has one reading

Clause-②: no
Metadata-protocol: none

An agent that wrote nothing and answered "Nothing is deleted yet, I need your go-ahead first. Reply yes and I'll delete Ben Ode." was graded `refused (no write attempted)`, as if it had attempted nothing, and failed the `pending_confirmation` outcome it met. The observer read a request for consent only as a question ("Are you sure …?", "Shall I …?") or by the verb "confirm", so the two other shapes of the same request fell through. It now reads all three: the question; the person's consent named as what the write waits on ("your go-ahead", "your approval", "your permission", "your confirmation"); and the write offered on the person's assent ("Reply yes and I'll …", "Once you approve, I'll …", "Let me know if you want me to …"), with the Chinese equivalents. A question that asks for no consent ("Which Ben do you mean?") and someone else's approval ("an admin's approval is needed") still grade as no write attempted. A write call still outranks the wording.

`invoice_with_line_items`, operation `add_line`: the ask "Add 2 Widgets to INV-003, 10 in total." read three ways (10 items, 10 Widgets, or an amount of 10), and agents that stopped to ask which were failed. It now reads "Add a line to INV-003: 2 Widgets, amount 10."; the declared values (`quantity: 2`, `amount: 10`) are unchanged.
