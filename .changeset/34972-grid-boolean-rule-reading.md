---
'@object-ui/fields': patch
---

fix(fields): a line-items grid reads a boolean column as a boolean in its `requiredWhen` / `readonlyWhen` rules

Clause-②: no
Metadata-protocol: none

A master-detail grid draws a `boolean` / `toggle` child field as a select whose two options store the strings `'true'` / `'false'`. Its per-cell rules evaluated `record.won == true` against that string, so the required marker and the readonly lock showed the opposite of what the server enforces: since the engine stores and judges these writes as booleans, a line the grid showed as complete was refused on save.

The grid now evaluates each column's `requiredWhen` and `readonlyWhen` over the row with every boolean column's cell read as the boolean it stands for. The readings are the ones the engine's write normalisation accepts (`'true'` / `'1'` / `1` and `'false'` / `'0'` / `0`). Only the predicate's view changes: what the cell shows and what the row saves are unchanged. A select column over any other field keeps its string value.
