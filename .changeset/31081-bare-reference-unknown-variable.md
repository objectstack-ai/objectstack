---
'@objectstack/formula': patch
'create-objectstack': patch
---

fix(formula): the bare-reference and unbound-root refusals say the expression faults, not that it evaluates to null

Clause-②: no
Metadata-protocol: none

- **`@objectstack/formula`.** In a `record`-scoped expression, a bare field name (`amount` where `record.amount` is meant) and a mistyped root (`pge.…` where the surface binds `page`) are unknown variables: the expression faults with `Unknown variable: NAME` and never reads the field. The `bare-reference` and `unbound-root` refusals used to say the name "resolves to nothing and the expression silently evaluates to null", which is true only of a formula field. They now say the expression faults, and `bare-reference` names three outcomes of that fault: a formula field reads null, an `error` validation rule refuses the write, an action's `visible` hides the action. `os validate`, `os build` and the `validate_expression` tool print the new sentences.
- Codes and params are unchanged (`bare-reference` `{ name }`, `unbound-root` `{ name, roots, suggestion }`). What is refused, warned or passed is unchanged. Only the English `message` changed, so a consumer that matched the old text re-keys to the `code`.
- **`create-objectstack`.** The scaffolded `AGENTS.md` no longer says a bare field reference "evaluates to `null`". It now says the predicate cannot be evaluated on any record, so an action whose `visible` reads it is hidden everywhere and an `error` validation rule that reads it refuses every write. Projects scaffolded earlier keep their copy until it is edited.
