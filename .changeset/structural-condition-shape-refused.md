---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

A flow condition that is neither CEL text nor an expression is now refused at build time, instead of being read as an empty condition and answering a silent `false`.

`evaluateCondition` derives its source as `typeof expression === 'string' ? expression : (expression?.source ?? '')`. For a value that is neither — a number, a boolean, an array — the read yields `undefined`, the `??` supplies `''`, and the empty-source arm returns **`false`**: the "an unauthored branch must not open" rule, applied to a value that was very much authored. Measured: a `decision` node carrying `config: { condition: 42 }` **registered clean** and executed `success: true` with nothing said at any layer; `{ source: 1 }` did not even get that far and threw a bare `TypeError: exprStr.trim is not a function` out of the validator. `config.condition` is also the key a **start node's trigger gate** is read from, so the same value could gate a whole flow shut forever with no signal to the author.

- The new `structuralConditionRefusal` / `STRUCTURAL_CONDITION_SHAPE_REFUSAL` in `@objectstack/spec/automation` are the single shared notion of why, read by both validators so build time and author time cannot disagree about the shape. `registerFlow` throws, naming the node or edge and attributing the finding; `objectstack validate` reports the same refusal as a located `error`.

**This is deliberately NOT the `predicate`-slot rule, and the difference is measured.** A ledger `predicate` slot (`decision.conditions[].expression`, a screen field's `visibleWhen`) is declared `z.string()`, so `PREDICATE_SLOT_STRING_REFUSAL` refuses every non-string including an envelope. Neither structural slot is declared that way: `FlowEdgeSchema.condition` is `ExpressionInputSchema`, whose string arm **transforms into** `{ dialect: 'cel', source }` — so after `FlowSchema.parse` every authored edge condition *is* an envelope — and `FlowNodeSchema.config` is an open `z.record` that passes an envelope written at `config.condition` through verbatim, where `evaluateCondition` evaluates it correctly. Both shapes stay accepted here; an envelope with no `dialect`, and an `ast`-carrying one (`ExpressionSchema`'s own `source`-or-`ast` rule), stay accepted too.

**Strings are untouched, deliberately.** A whitespace-only condition still means "not authored" and still answers `false` on both sides — consistent behaviour, ruled correct, not a defect. What a non-empty string *says* is still `validateExpression('predicate', …)`'s verdict, brace trap and all. Only the shape moved.

An app that authored a number, a boolean, an array or a source-less object in a node or edge `condition` now fails to register with a message naming the site; the fix is to write the condition as bare CEL text (`record.rating >= 4`) or as an expression envelope.
