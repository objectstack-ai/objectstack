---
'@object-ui/app-shell': patch
---

fix(app-shell): a parenthesised metadata form condition is evaluated as a group, so the field form offers its percent and currency rows only where the field type allows

Clause-②: no
Metadata-protocol: none

The Studio metadata form evaluator had no parenthesised grouping. A `visibleWhen` such as `data.type == 'percent' || (data.type == 'formula' && data.returnType == 'percent')` read its group as the path `(data.type`, failed to resolve it and showed the row on every draft. The field form's `percentDisplay` and `currencyConfig` rows were therefore offered on text, currency, number-returning formula and empty drafts. The evaluator now reads `(expr)` as CEL does, at any depth and under `!`. A condition it still cannot read (an unbalanced parenthesis, a function call) keeps failing open with its development warning, unchanged.
