---
'@object-ui/core': patch
'@object-ui/components': patch
'@object-ui/console': patch
---

fix(form): formula fields are recomputed from the live inputs before the field rules are judged

Clause-②: yes (widening) — one new member on the `@object-ui/core` package entry, `planObjectFormulas` (with its `ObjectFormulaPlan` type); nothing removed or renamed
Metadata-protocol: none

A required field whose `visibleWhen` reads a `formula` field was judged on the formula value the form last read, or on nothing on a create. On a create form the field stayed hidden whatever was typed, or, when the formula was not drawn on the form, the rule faulted on the missing key and every submit was refused. On an edit that moved the inputs across the condition, the field stayed hidden while the server required it. In both cases the user could not save.

The object form renderer and the console's form-view page now compute the object's formula fields over the record being edited, in the platform's read order, with the canonical `@objectstack/formula` engine, and judge `visibleWhen`, `requiredWhen` and `readonlyWhen` over that record. The formulas are computed for the signed-in user as the server computes them: `current_user` (also `user` and `ctx.user`) carries the user's id and positions. A formula that faults the way a read faults (an operator over an empty operand, an undeclared key, a cycle, a scope root the server does not bind for a formula, such as `previous`) reads `null`, and the rule is judged on that `null`. A formula the form cannot compute is one that reads through a reference, calls `label()` or `current_user.can()`, reads `os`, reads the user when nobody is signed in, is served without its expression, or reads such a formula. A field whose `visibleWhen` reads one is shown and keeps its `required` flag, with one console warning, and the form does not refuse the submit for that rule; the server, which judges the write, decides. Computed values are used for the rules only and are never sent in the write.
