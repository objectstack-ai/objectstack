---
'@objectstack/spec': minor
---

feat(spec/ai): a solution blueprint's select options declare their lifecycle `kind`, and a blueprint object names its `stageField`

Clause-②: yes

The object schema already requires a lifecycle `kind` (`open` / `won` / `lost`) on every option of the field an object's `stageField` names. The AI blueprint had no slot for either key, so a model could not say which field was an object's stage or which option ended its lifecycle, and that rule never applied to an AI-built object. Both blueprint shapes now carry both keys.

- **Option `kind`**, on `BlueprintFieldSchema.options[]` and on the strict structured-output mirror's (`SolutionBlueprintStrictSchema`) field options. It is `SelectOption.kind`'s own enum, taken by reference, so the blueprint accepts exactly the kinds an object field's option accepts. Lenient: optional. Strict: required and nullable (null = no kind stated).
- **Object `stageField`**, on `BlueprintObjectSchema` and the strict mirror's objects: a snake_case name of one of the object's own fields, mapping onto `ObjectSchema.stageField`. Lenient: optional. Strict: required and nullable (null = no stage field). The object schema's `false` value ("no linear lifecycle") has no blueprint spelling.
- Both describes state what the object schema refuses: the field `stageField` names must be a single-value `select` or `radio` whose inline options each declare `kind`. A multiselect / checkboxes / tags field that carries options is refused as a stage field, and `kind` on such a field's options is refused by the field schema. The blueprint does not check these rules itself; the object schema does, when the applier writes the object.
- Additive only: every blueprint that parsed before still parses with the lenient schema. A producer of the STRICT shape must now send `stageField` on each object and `kind` on each option (null when it has none), as with every other key in that mirror.
