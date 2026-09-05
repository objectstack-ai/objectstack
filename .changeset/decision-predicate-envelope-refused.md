---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

A flow predicate authored as a CEL envelope is now refused at build time, instead of running unread by either validator.

A `predicate`-role expression slot holds **bare CEL text** — `DecisionConditionSchema.expression` is declared `z.string()`, and so is a screen field's `visibleWhen`. An author who instead wrote the `{ dialect, source }` expression *envelope* there reached a shape nothing could see: a flow node's `config` is an open `z.record(z.unknown())` that no Zod schema is parsed against, the unknown-key walk exempts the schemaless node types on purpose (`decision` publishes no descriptor `configSchema`), and the expression ledger's `predicate` arm skipped every non-string as "a type violation for the schema pass to report" — a schema pass that, for those node types, does not exist. `registerFlow` accepted the flow, `objectstack validate` reported nothing, and the evaluator was the only layer that ever read the predicate.

- `resolveFlowNodeExpressions` now emits a non-string sitting in a `predicate` slot, and the new `predicateSlotRefusal` / `PREDICATE_SLOT_STRING_REFUSAL` say why it is refused — one notion, derived once, read by both validators so build time and author time cannot disagree about the shape. `flow-template` slots keep the old rule: no validator implements that dialect, so a finding there is one nobody could judge.
- `registerFlow` throws, naming the node, the slot and the index, and attributing the finding to the envelope's own `source`. `objectstack validate` reports the same refusal as a located `error`.

**String predicates are untouched, deliberately.** A whitespace-only string still means "not authored" on both sides, exactly as before; what a non-empty string *says* is still judged by `validateExpression('predicate', …)`, brace trap and all. Only the shape moved.

An app that authored an envelope in one of these slots now fails to register with a message naming the slot; the fix is to write the predicate as bare CEL text (`record.rating >= 4`). The `{ dialect, source }` envelope remains the `value`-role spelling, on the `assignment` node's `assignments` map.
