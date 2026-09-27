---
'@objectstack/formula': minor
'@objectstack/spec': minor
---

Expression refusals now carry a stable `code` and typed `params` beside their English `message`, so a localized author surface can render its own words: `validateExpression` (every entry in `errors[]` and `warnings[]`), `collectCelRootIdentifiers` (its `ok: false` arm) and `predicateSlotRefusal` (#20291)

Clause-②: yes

Until now the only thing a refusal said was an English sentence, and a designer running in another locale could only show it verbatim, beside its own translated headings. Each refusal now also names its code — one of a closed, kebab-case set — and the values its sentence interpolates, so a consumer keys a catalogue row to the code and fills it from the params. The `message` is the same sentence, byte for byte; nothing is removed or renamed, so no existing reader changes.

- `@objectstack/formula` exports `EXPRESSION_REFUSAL_CODES` (the closed set as a frozen list) and the types `ExpressionRefusalCode`, `ExpressionRefusalParams` (code → params), `ExpressionRefusal`, `ExprValidationCode`, `CelRootsRefusalCode`, `CelFieldRole`, `ExpressionSourceKind` and `CelRootIdentifiersResult`. `ExprValidationError` gains `code` and `params`.
- `@objectstack/spec/automation` exports `PREDICATE_SLOT_REFUSAL_CODES` and the types `PredicateSlotRefusalCode`, `PredicateSlotRefusalParams`, `PredicateSlotRefusal` and `PredicateSlotValueKind`. `predicateSlotRefusal` returns `PredicateSlotRefusal`, which is its previous `{ message, source }` plus `code` and `params`.
- Narrowing on `code` narrows `params`. A code never changes once published: a reworded message keeps its code, and a new refusal gets a new one.
- A `detail` param is the CEL or template engine's own diagnostic, in English, passed through as the message carries it.
- These are authoring diagnostics returned as values, not ADR-0112 request error codes, which is why they are kebab-case.
- The `validate_expression` MCP tool forwards `validateExpression`'s `errors` and `warnings` as they are, so each entry in its answer now also carries `code` and `params`.
