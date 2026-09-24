---
'@objectstack/spec': minor
---

fix(spec)!: a blank string in a flow node's predicate slot — a `decision` branch `expression`, a screen field `visibleWhen` — is refused at authoring (#17493)

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-predicate-slot-blank-string-refused -->

**BREAKING** — an accept-set narrowing on two authored flow-node slots, shipped as
`minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level).

**What changed.** A `decision` node's `config.conditions[].expression` and a
`screen` node's `config.fields[].visibleWhen` are declared bare CEL text. A string
that is blank after trimming (`''`, `'   '`, a tab or a newline) used to be
accepted there by `FlowSchema.parse`, `AutomationEngine.registerFlow` and
`objectstack validate`, and was then read as "no predicate": the evaluator answers
a blank decision predicate `false`, so that branch was not taken, and nothing said
so. It is now refused at those doors — by `FlowSchema.parse` with a `custom` issue
anchored at the slot (for example `nodes.1.config.conditions.0.expression`), and
by `registerFlow` and `objectstack validate` through that same parse — with a
message that leads with the published `PREDICATE_SLOT_STRING_REFUSAL` sentence,
the one these slots already answered with for a non-string value. A flow stored
with such a value no longer registers: the boot log carries a
`failed to register flow` warn naming it, and its trigger is not armed.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `conditions: [{ label: 'high', expression: '   ' }]` on a `decision` node | the predicate you meant — `{ label: 'high', expression: 'record.amount > 10000' }` — or drop that branch |
| `fields: [{ name: 'reason', visibleWhen: '' }]` on a `screen` node | the predicate you meant — `visibleWhen: "status == 'rejected'"` — or drop the `visibleWhen` key |

**One-line fix:** write the predicate, or remove it — drop `visibleWhen` to show
the field unconditionally, or drop the whole decision branch (a branch requires
its `expression`).

Removing is behaviour-preserving on these two slots: a blank `visibleWhen` was
already read as absent at run time, and a branch with a blank predicate was not
taken. That is not true of a blank structural `condition` on an edge or a node,
where removing the key makes the step unconditional — see the separate
`flow-edge-condition-evaluated-slot-source-required` migration entry.

**Unchanged.** A non-blank predicate parses, registers and validates as before;
a non-string in these slots keeps its existing refusal at `registerFlow` and
`objectstack validate`; `edges[].condition` and a node's `config.condition` keep
their own rule and sentence (`EVALUATED_EXPRESSION_SOURCE_REQUIRED`); and
`AutomationEngine.evaluateCondition` still answers a blank predicate `false` for
a caller that reaches it directly. The `PREDICATE_SLOT_STRING_REFUSAL` constant
keeps its name and now also names the blank string, so code matching the
constant rather than a copy of its text is unaffected.
