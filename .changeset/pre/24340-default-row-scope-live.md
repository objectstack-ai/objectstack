---
'@objectstack/spec': patch
---

`defaultRowScope`'s describe, TSDoc and liveness row now say what the security plugin's reader does with the key

Clause-②: no — only describe, TSDoc and liveness-ledger text move; `ObjectSchema` and `DefaultRowScopeSchema` accept and refuse exactly what they did.

- `ObjectSchema.defaultRowScope`'s describe no longer says the key is not applied. It states what the row-policy collection does: the default applies when no permission set the caller holds carries a row policy for the object and the operation (a `'*'` policy counts; one switched off, outside the caller's positions, or for another operation does not), it is judged like a held policy, a `using` the compiler cannot lower makes the reads it governs return no rows with one server warning, and authoring checks do not judge that predicate. The TSDoc on the key and on `DefaultRowScopeSchema` say the same.
- `liveness/object.json`: the `defaultRowScope` row and its eight members are `live`, citing the security plugin's collection, compiler and explain as their readers. Authoring the key no longer raises the `liveness-planned-property` warning.
