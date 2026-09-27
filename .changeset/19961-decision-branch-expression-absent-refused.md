---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

fix(spec)!: a `decision` branch with no `expression` — the key absent, or `null` — is refused at authoring (#19961)

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-decision-branch-expression-absent-refused -->

**BREAKING** — an accept-set narrowing on one authored flow-node slot, shipped as
`minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level).

**What changed.** `DecisionConditionSchema` declares a branch `{ label, expression }`
with `expression` a required `z.string()`. Nothing enforced that: a decision node's
`config` is an open record no schema is parsed against, and the expression ledger's
resolver skipped an absent value as "not authored". So `conditions: [{ label: 'y' }]`
passed `FlowSchema.parse`, `AutomationEngine.registerFlow` and `objectstack validate`,
and the run then failed at that branch — the executor evaluates every branch it
reaches, and a branch with no `expression` is a condition with no `source`, which
`evaluateCondition` refuses. The ledger now marks the slot `required` (reconciled
against the schema's own `required` list), and the branch is refused at all three
doors through the walk and the function that already refuse a blank one — by
`FlowSchema.parse` with a `custom` issue anchored at the slot (for example
`nodes.1.config.conditions.0.expression`), by `registerFlow` and `objectstack validate`
through that same parse, and by `validateStackExpressions` for a stack handed to it
directly — with one message, led by the published `PREDICATE_SLOT_STRING_REFUSAL`
sentence. `expression: null` is refused the same way, and so is a branch that wrote
its predicate under `condition` (the edge's spelling), which has no `expression`
either. The Studio flow designer writes the refused shape when a branch row's
expression cell is left empty. Where such a branch already sits, the whole flow is
refused: registered from the metadata
registry or `sys_metadata` at boot, it is skipped with a `failed to register flow`
warn naming it while the flows beside it register; a `defineStack({ flows })` source
throws `StackSchemaInvalidError` for the whole stack; an artifact file is refused
whole at load.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `conditions: [{ label: 'high' }]` on a `decision` node | the predicate you meant — `{ label: 'high', expression: 'record.amount > 10000' }` |
| `conditions: [{ label: 'high', condition: 'record.amount > 10000' }]` | the same predicate under `expression` |
| `conditions: [{ label: 'high', expression: null }]` | the predicate you meant, or `expression: 'false'` to keep the branch and never take it |

**One-line fix:** write the predicate under `expression`. `expression: 'false'` keeps
the branch and its label and never takes it — a change of behaviour, not a preserved
one: a run that reached the branch used to FAIL there, and now routes on to the next
branch or the declared fallback. ⚠️ Do not drop a decision's only branch: the node
then routes by its out-edges alone, and the out-edge that branch labelled is no
longer held back.

**Unchanged.** A branch carrying a non-blank predicate parses, registers and
validates as before; a blank one keeps its refusal and its own prescription
(`flow-predicate-slot-blank-string-refused`); a `decision` with no `conditions`, or
an empty list, still routes by its out-edges; an absent screen field `visibleWhen`
is still legal (that slot is not required); and `PREDICATE_SLOT_STRING_REFUSAL`
keeps its name and its text.
