---
'@objectstack/spec': minor
---

feat(spec): a select option's `value` may be one character — grades `a` / `b` / `c` publish as written

Clause-②: yes (widening)
Metadata-protocol: added

`SelectOptionSchema.value` used `SystemIdentifierSchema`, whose two-character floor refused a one-letter option value at publish: an author (or an agent) asked for customer grades A / B / C wrote `{ label: 'A', value: 'a' }` and got `options.0.value too_small`, then had to invent `level_a`. The option value now has its own rule: the same characters as before (lowercase, starts with a letter, then letters, digits, `_` or `.`) with a floor of one character. `''` is still refused (`too_small`), and so are `A` and `1` (`invalid_format`).

Every face that reuses the option shape takes the new floor with it: object-field `options`, form-view options, picklist items and picklist extensions, and the `Field.select` shorthand (`Field.select(['A', 'B', 'C'])` now yields `a`, `b`, `c` and parses). A translation key `picklists.<name>.options.a` resolves like any other.

Nothing else moves: `SystemIdentifierSchema` and `SnakeCaseIdentifierSchema` keep their two-character floor, so object, field and every other machine name are judged as before. No stored value changes and nothing needs migrating — this only accepts values that were refused before.
