---
"@objectstack/formula": minor
---

Add `inferExpressionType()` (and the lower-level `inferCelType()`): infer the coarse return type (`number | text | boolean | date | unknown`) of a CEL value/formula expression by surfacing the cel-js type-checker result. Conservative — two `dyn` operands stay `unknown`, while typed literals/stdlib returns pin a concrete type. Enables numeric-formula measure-eligibility in downstream dataset derivation.
