---
"@objectstack/spec": minor
---

`ObjectSchema.attachedOnRead`: an object declares the blocks a service attaches to each row it serves, computed per caller on read and never stored

Clause-②: yes (widening: a new optional `ObjectSchema` key)

- **The key.** `attachedOnRead` is an optional map from block name to that block's leaves, each leaf naming its value type: `attachedOnRead: { viewer: { can_act: 'boolean', can_override: 'boolean', is_submitter: 'boolean' } }`. Block names and leaf keys take the field-name grammar (lowercase snake_case). A leaf's type is one of `number`, `text`, `boolean` or `date`, the four value types `Field.returnType` declares.
- **It is not a field.** It provisions no column, and no driver, form, list view, export, write path or translation bundle reads it. Its reader is the shared build validator, `@objectstack/lint`'s expression rule over `@objectstack/formula` (what `os build` and `os validate` run): `record.<block>` resolves, and `record.<block>.<leaf>` resolves only to a leaf the block declares (see the `@objectstack/formula` and `@objectstack/lint` entries). No other field-existence check reads it.
- **Refused at parse:** a leaf type outside the four, a leaf that is a nested block or a field definition, a block or leaf name outside the grammar, a block that names no leaf, and a block that repeats a field name the object declares. Each refusal is located at the offending key.
- **Nothing to migrate.** The key is optional and nothing writes it by default; an object without it parses and validates exactly as before.
