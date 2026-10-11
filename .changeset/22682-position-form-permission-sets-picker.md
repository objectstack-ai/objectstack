---
"@objectstack/spec": patch
---

`positionForm`: the `permissionSets` row now declares `widget: 'ref-multi:permission'` in place of `type: 'tags'`. ADR-0131 D4 resolves a reference to a declared item by machine name, registry-first, so the row names the permission-set registry (metadata type `permission`) for the designer to offer the declared sets and commit their names, instead of a free-text tag box where a name that does not exist can be typed.

Clause-②: no

- **The key.** `ref-multi:<type>` is the list form of the forms' `ref:<type>` pickers (`ref:object`, `ref:dataset`, `ref:component`, all single-valued). A distinct key, as `field-ref` / `field-multi` already are, because a single `ref:` picker writes one string and the widget registry declares one labelling per key.
- **Which renderer honours it.** A console whose metadata-admin widget registry has no `ref-multi:permission` entry renders this row as its announced fallback: a JSON editor with the note that no custom renderer is registered. The stored value is the same list of names either way.
- ⛔ Only this one form row changes. No schema, parse, export or accept-set change: `PositionSchema.permissionSets` stays a list of snake_case names, and `FormField.widget` stays a free string.
