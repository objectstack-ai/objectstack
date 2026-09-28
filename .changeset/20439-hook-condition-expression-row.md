---
'@objectstack/spec': patch
---

`hook.form.ts`'s `condition` row now declares `language: 'expression'`, matching the CEL predicate `HookSchema.condition` actually is.

Clause-②: no

The row previously declared `language: 'javascript'` — the same declared language as a real script row (`body.source`) — over a field that is `EvaluatedExpressionInputSchema`, a CEL predicate. A consumer keyed on the row's declared language could not tell the predicate apart from a script. The `helpText` moves from "Optional formula — skip the hook when this evaluates to false" to "CEL predicate — the hook runs only when TRUE", matching the phrasing every sibling predicate row (`field.form.ts` / `object.form.ts`'s `visibleWhen` / `readonlyWhen` / `requiredWhen`, and the formula `expression` row) already uses.

No key is added, removed, narrowed or widened, and no parse verdict changes — `type: 'code'` and `language` are already-declared form-DSL vocabulary. `metadata-form-declared-rows.pin.test.ts` pins the new value, with a control against a sibling predicate row.
