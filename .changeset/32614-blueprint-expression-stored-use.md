---
'@objectstack/spec': patch
---

fix(spec): the blueprint field's `expression` describe teaches the stored computed value, so an AI-built total can be summed

Clause-②: no
Metadata-protocol: none

The AI solution blueprint's field `expression` describes, on `BlueprintFieldSchema` and on the strict structured-output mirror's fields (`SolutionBlueprintStrictSchema.objects[].fields[]`), taught one use only: the body of a `formula`. The strict mirror, the one the design model generates against, said the key was "null for every other field type". A value the user meant to total (销售额 = 销量 × 单价) was therefore authored as a `formula`, which is computed on read and stores nothing, and every `sum` / `avg` over it was refused.

Both describes now name the two uses, in the same words:

- On `type: "formula"`: computed on read and stored nowhere, so it is shown everywhere but cannot be sorted, searched or totalled. The describe carries the one remedy sentence the aggregate refusals print.
- On a field of the value's own return type (`number` / `currency` / `percent`, `date`, never `formula`): a stored computed value, computed by the engine on every write and kept in a column, so `sum` / `avg` and sort work on it. Name the return type: a date expression on a `number` field is refused at every write. A stored expression reads only the record's own fields; a value from a related record stays a `formula` or comes through a `summary` or a flow, and an input that changes over time is frozen at the write.

The closing rule is now: null (strict) or omitted (lenient) on a field that is neither a formula nor a stored computed value. No shape changed: both schemas already accepted an `expression` on a non-formula field, and a blueprint field `{ type: 'number', expression: 'record.quantity * record.unit_price' }` parses under both and keeps its `expression`. The reference page `content/docs/references/ai/solution-blueprint.mdx` is regenerated from the new describes.
