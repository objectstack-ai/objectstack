---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/metadata-core': patch
'@objectstack/driver-sql': patch
---

A field can declare cell formatting rules: `conditionalFormatting: [{ condition, style }]`, the rule a list view already declares for its rows

Clause-②: yes (widening)

- **`FieldSchema.conditionalFormatting`** (optional) is an ordered list of `{ condition, style }` rules. The first rule whose CEL `condition` holds applies its CSS `style` map to that field's cell, wherever the field renders. A list view's row rules still style the row, and both may apply to one record. Example: `amount: Field.currency({ conditionalFormatting: [{ condition: P\`value < 0\`, style: { color: '#b91c1c' } }] })`.
- **One rule element, no second style vocabulary.** The `{ condition, style }` element moved out of `ListViewSchema` into its own spec module, and both `ListViewSchema.conditionalFormatting` and `FieldSchema.conditionalFormatting` mount it. The list view accepts exactly what it accepted before. Its refusal of an unknown rule key now reads the same on both members: for a `color` written beside `style`, it says to put the colour in `style` first, then points a list view at `rowColor`.
- **The scope is `value` and `record`.** `value` is this field's value on the record and `record` is the row. `@objectstack/lint` judges each condition at `objectstack build`, `objectstack validate` and the object save: it must parse, read fields as `record.<field>`, name declared fields, and read no other root (`previous`, `parent` and the user roots are refused, naming the field and the rule).
- **For presentation only.** Use it for rules that carry no meaning of their own, such as an amount below zero in red or stock under its safety level in amber. A deadline's overdue state stays a declaration (`dueLike` with `settledWhen`).
- **Display only.** Nothing on the write path reads the key, and every metadata that parsed before parses unchanged. Field-level security drops a rule whose condition reads a field the caller cannot read, keeping the other rules in order (`@objectstack/metadata-core`). The SQL driver classifies the key as presentation, so it never reaches column DDL (`@objectstack/driver-sql`).
- **Who reads it.** objectui's cell renderers read the rules in a follow-up release, once this spec version is published. Until then a rule is validated when it is authored and styles no cell.
