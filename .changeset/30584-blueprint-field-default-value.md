---
'@objectstack/spec': minor
---

feat(spec): a blueprint field carries a typed `defaultValue`, so an AI-built boolean flag defaults to false

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: none — no file under `skills/**` restates a blueprint field key (`skills/objectstack-ai/references/_index.md` only points at `solution-blueprint.zod.ts`); the reference page `content/docs/references/ai/solution-blueprint.mdx` is regenerated from the new describe.

The AI solution blueprint had no slot for a field's default. A blueprint that wrote `{ type: 'boolean', defaultValue: false }` for a 是否完成 / 已付款 / `is_active` flag, as the build guidance teaches, parsed with `success: true` and lost the key, so the built field had no default and every record created without the flag read empty instead of false. A filter on false missed those records.

- **`defaultValue` on `BlueprintFieldSchema` and on the strict structured-output mirror's fields (`SolutionBlueprintStrictSchema.objects[].fields[]`).** Both sides declare it as one scalar union, `boolean | number | string`. Lenient: optional. Strict: required and nullable (null = no default), as with every other key in that mirror. The describe says the value becomes the built field's `defaultValue`, and states the boolean-flag rule: a yes/no flag is a `boolean` field that is never `required` and carries `defaultValue: false`.
- **The value is checked against the field's `type`, on the lenient side.** The check is the field schema's own literal contract (`checkLiteralDefaultValue`, the one `FieldSchema` runs on a built field's `defaultValue`), so a default the blueprint admits is one the built field admits. These types take a default: `boolean` / `toggle` take true or false; `number` / `currency` / `percent` / `rating` / `slider` / `progress` take a number; `text` / `textarea` / `email` / `url` / `phone` / `markdown` / `html` / `richtext` / `code` / `color` take a string; `time` takes `"HH:MM"`; `select` / `radio` take the `value` of one of the field's own `options`, never a label.
- **Every other type is refused by name, never stripped.** The refusal is a `custom` issue at the field's `defaultValue` that names the field and its type, says why, and lists the types that take one: a `date` / `datetime` literal is frozen at design time; a reference or file type names a record or file that does not exist yet; a `multiselect` / `checkboxes` / `tags` field stores a list; a `formula` / `summary` / `autonumber` field is computed; `password` / `secret`, `signature` / `qrcode` and the structured JSON types have no one value right for every record. A runtime token (`NOW()`, `current_user`) is refused too: a blueprint default is a literal.
- The strict mirror cannot read `type` while it judges this key, so it can generate a value the lenient schema then refuses. `apply_blueprint` parses the lenient schema, and that refusal names the type at the key.

Additive only: every blueprint that parsed before still parses with the lenient schema. A producer of the STRICT shape must now send `defaultValue` on each field (null when it has none). The cloud build applier is what carries the value into the built field; it moves on its own pin.
