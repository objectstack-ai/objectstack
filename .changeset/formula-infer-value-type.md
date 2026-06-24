---
"@objectstack/formula": minor
"@objectstack/spec": minor
---

Formula field typing: `inferExpressionType()` + a declared `returnType`.

- `@objectstack/formula`: new `inferExpressionType()` (and lower-level `inferCelType()`) surfaces the cel-js type-checker's result for a CEL value/formula expression, mapped to `number | text | boolean | date | unknown`. Conservative — two `dyn` operands stay `unknown`; typed literals/stdlib returns pin a concrete type.
- `@objectstack/spec`: `FieldSchema` gains an optional `returnType` (`number|text|boolean|date`) so a formula field can carry its declared value type (the way Salesforce/Airtable do), letting consumers (dataset measures, formatting, validation) read a declared type instead of re-parsing the expression.
