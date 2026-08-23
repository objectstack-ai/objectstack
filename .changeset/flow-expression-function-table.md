---
"@objectstack/service-automation": minor
---

Flow value expressions (`create_record`/`update_record` `config.fields`, `assignment` `config.assignments`) now support a small numeric function table — `round`, `floor`, `ceil`, `abs`, `min`, `max` — with every name and semantic mirrored 1:1 from the `@objectstack/formula` CEL stdlib (no second dialect: `round` is integer-only exactly like CEL's; for N-decimal rounding write `round(x * 100) / 100`, the same pattern CEL authors use). A flow can finally write a computed money value that satisfies its field's declared `scale` (`{round(amount * (1 - discount / 100) * 100) / 100}` → a `scale: 2` currency field).

Loud diagnostic in the same stroke: an identifier in call position that is not a supported function — `ROUND(...)`, `Math.round(...)`, `(x).toFixed(2)`, or the next name anyone invents — now fails the node with a named `FlowExpressionFunctionError` (guard-marked, so a `fault` edge cannot swallow it) instead of being silently rewritten to `null` and writing the field as `undefined`. Non-call template resolution is unchanged: unresolved plain tokens still become `null`/empty, and `NOW()`/`TODAY()` whole-token macros behave exactly as before.
