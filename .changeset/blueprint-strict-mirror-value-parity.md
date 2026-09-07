---
"@objectstack/spec": minor
---

The model-facing solution-blueprint mirror can no longer generate an identifier the applier rejects.

`SolutionBlueprintSchema` (what `apply_blueprint` validates against) and `SolutionBlueprintStrictSchema` (the OpenAI-strict structured-output contract the design model generates against) are two declarations of one shape. Their KEYS were pinned by an existing parity test; their VALUES had never been. Every identifier in the lenient schema carried `.regex(/^[a-z_][a-z0-9_]*$/)` and not one identifier in the strict mirror carried it — 20 leaves apart, measured.

The consequence was a build whose approval did nothing. Asked for a CRM, the design model emitted a `company_size` select whose option values came straight off the labels — `1_49` for 「1-49人」. Generating that was legal. Applying it was not: on the turn the user clicked 「确认，开始搭建」 the deterministic confirm replay handed that exact blueprint to `apply_blueprint`, which refused it wholesale (`objects.0.fields.2.options.0.value: Invalid string: must match pattern /^[a-z_][a-z0-9_]*$/`) and staged nothing. The app appeared only because the model noticed the error card and retried with a repaired blueprint the user had never seen.

Every identifier leaf in the strict mirror now carries the same `SNAKE_CASE` constraint the lenient schema enforces — object / field / view / dashboard / widget / app / nav names, `reference`, `nameField`, `columns`, `groupBy`, `measure`, roll-up `object` / `field` / `relationshipField`, condition `field`, and select option `value`. The constraint is emitted into the JSON Schema the model is given (`pattern`), so an out-of-pattern identifier is refused at generation instead of after approval. Option `value` additionally spells out the case that produced the incident: it may never start with a digit, so 「1-49人」 is authored as `size_1_49` — the `label` keeps the human wording untouched, and only the stored value is an identifier.

A new `strict mirror ↔ lenient schema — VALUE parity` test walks both schemas leaf by leaf and fails on any future divergence, the value-side twin of the key-parity gate that already guards this pair.

Refs cloud#1967.
