---
"@objectstack/cli": patch
---

`os lint` no longer crashes on a localized label.

`convention/label-case` indexed its argument (`label[0].toUpperCase()`) on a parameter annotated `string`, while every call site reaches it through `any`-typed config walking and the spec does not require a label to be a string: `I18nLabelSchema` is `z.union([z.string(), InlineLocaleMapSchema])`. On the map form `label[0]` is `undefined`, the rule threw a `TypeError`, and the throw escaped `lintConfig` into the command's catch-all — so an author who localized an app label or a list-view label could not lint the project at all. Every face exited 1 with `Cannot read properties of undefined (reading 'toUpperCase')`, naming no rule, no path and no remedy, on input `ObjectStackDefinitionSchema` parses clean.

The rule now checks `typeof label === 'string'` first. Two of the four carriers it walks accept the inline locale map — `apps[].label` (`AppSchema`) and a view's `list` / `listViews.*` labels (`ListViewShapeSchema`); the other two are `z.string()` and reject the map at the schema door (`objects[].label`, `objects[].fields.*.label`).

**Nothing about a plain string label moves.** Same warning, same message, same `fix`, same path, on all four carriers — that is pinned per carrier rather than asserted.

**The rule deliberately says nothing about a localized label**, rather than resolving the map and case-checking one of its entries. Case is a property of a literal, and deciding which locale entry a case verdict is taken against is a product call, not a lint call. Widening the rule that way is a separate change.
