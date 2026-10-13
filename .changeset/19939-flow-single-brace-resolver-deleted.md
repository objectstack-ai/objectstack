---
'@objectstack/service-automation': major
'@objectstack/lint': major
'@objectstack/spec': patch
'@objectstack/verify': patch
---

No flow position reads the single-brace `{…}` template dialect any more, and its resolver is deleted (ADR-0032 Sequencing 6: "delete the single-brace resolver"). `AutomationEngine.evaluateCondition` evaluates every condition as CEL: a condition carrying a `{var}` hole is refused as the CEL brace trap, naming its source, and a `template` or `flow` envelope is refused before evaluation, where the deleted path substituted the variables and compared the text. A literal in a value slot is handed on as written: a `Date` in a code-defined flow reaches the write as the `Date`, where the deleted interpolator wrote `{}`.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused, flow-text-slot-single-brace-refused) The two step-18 D3 entries, registered on this line before this change, record the retirement of the single-brace dialect from every value and text position; this change deletes the resolver behind those positions and the condition path no registered flow reached. No authorable flow surface changes: registerFlow and objectstack validate already refused a braced condition and a template or flow envelope at every condition slot (ADR-0032 §1a), and the residual calls the resolver kept saw literals only. No new D3 entry and no D2 conversion. -->

**BREAKING**: a narrowing of a published runtime method and of published lint exports, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 3 keeps one template delimiter, `{{ }}`, and its Sequencing 6 deletes the single-brace resolver. The earlier changes on this line retired the dialect position by position — every value slot, the text slots, each CRUD filter operand — so the resolver's last readers were two calls that saw literals only and a condition path that only a direct call reached.

**What changes.**

- **Conditions.** `AutomationEngine.evaluateCondition(condition, variables, context?)` reads every condition as CEL — bare text, an envelope with `dialect: 'cel'`, or one naming no dialect. The template path it kept for a string carrying a `{var}` hole is deleted: such a string is refused as a CEL fault that names its source and says not to wrap field references in `{…}`, and an envelope with `dialect: 'template'` or `dialect: 'flow'` is refused before evaluation. `registerFlow` already refused both at every condition slot (a start node's `condition`, an edge `condition`, a `decision` branch's `expression`, a screen field's `visibleWhen`), so no registered flow changes. What changes is a direct caller: a plugin calling the method, or `@objectstack/verify`'s `stack.automation.evaluateCondition`, which hands the condition over as given.
- **Value-slot literals.** A literal in a value slot — a `fields`, `input` or `templateData` value, an `assignment` value in any of its three shapes, a `notify` recipient, an `http` `body`, a screen's `defaults`, `defaultValue` or `recordId` — is handed on as a copy of what was written (arrays and plain objects copied, every other value as it is). The deleted interpolator walked every object's own entries, so a `Date` written in a code-defined flow reached the write as `{}`; it reaches it as the `Date`.
- **`@objectstack/lint`.** `validateFlowTemplatePaths` reads the `{{ }}` holes of a node's strings and no single-brace token; a CRUD node's `filter` is not scanned, since each operand is a value slot that renders no template. So `flow-template-unknown-field` and `flow-template-lookup-traversal` report only `warning` now: their `error` at a filter operand, and every finding on a single-brace token, are gone, and the value-slot and text-slot judges refuse those tokens at the same doors as `expression-invalid`. Messages and hints spell a hole `{{ record.x }}`. `flow-double-brace-interpolation` and `flow-bare-dollar-reference`, at a string outside every value slot, text slot and declared literal (a plugin node's own config, a `connector_action` input), say the value is read as written, where they prescribed a `{var}` token nothing reads. The lint's mirror of the retired grammar is removed with its exports.
- **`@objectstack/spec`.** The `FlowSchema` example's `connector_action` input holds a literal, since nothing reads a token there. The upgrade guide's step-18 text-slot entry says no other flow string reads the single-brace dialect, where it said every other one kept it.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `engine.evaluateCondition('{amount} > 100', vars)` | `engine.evaluateCondition('amount > 100', vars)` | the template substituted text and compared it; CEL compares the values and fails the run on an absent variable |
| `"{status} == 'open'"`, `'{status} == open'` | `"status == 'open'"` | a string literal is quoted |
| `{ dialect: 'template', source: "{flag} == true" }`, `dialect: 'flow'` | `{ dialect: 'cel', source: 'flag == true' }` | — |
| `classifyFlowTemplateToken(inner)` (`@objectstack/lint`) | `valueSlotTemplateRefusals(value)` / `textSlotTemplateRefusal(text)` (`@objectstack/spec/automation`), which refuse a token with the spelling that replaces it | the grammar it classified is read by nothing |
| `FLOW_TEMPLATE_DATE_FUNCTIONS`, `FLOW_TEMPLATE_VALUE_FUNCTIONS` | the CEL stdlib: `isoDate(today())`, `isoDatetime(now())`, `round`, `floor`, `ceil`, `abs`, `min`, `max` | — |
| `FlowTemplateTokenVerdict` | nothing: the judges' reading of the retired grammar is internal to `@objectstack/spec` | — |

**The one-line fix: write a condition as CEL, without `{…}` around a reference.**

**Who is affected, measured.** In this repository at the base: no braced condition and no `template` or `flow` condition envelope in `examples/`, the docs or any package source; the deleted path's own pins in `@objectstack/service-automation` (`engine.test.ts`, `nested-region-parity.test.ts`) and `@objectstack/verify`'s door test are re-pinned to the refusal here. No authored `Date` literal in a flow was found; a compiled artifact serialises one to text, so only a flow handed to `registerFlow` in code carried one. Neither repository imports the removed lint exports. hotcrm at `0f84c9c` carries no braced condition and no `connector_action` input; its flows still author the single-brace dialect at value and text positions earlier changes on this line refuse, which its own upgrade migrates.

### The kit

- **The engine.** `AutomationEngine.evaluateCondition` (`@objectstack/service-automation`): the template path, its hole discriminator and its text comparison are deleted. The value-slot resolvers' literal arm and the `assignment` executor copy a literal (`copyLiteral`, `builtin/value-slot-map.ts`). The single-brace interpolator (`interpolate`, `interpolateString`, `resolveToken`, its function table and `FlowExpressionFunctionError`), which the package did not export, is deleted with its tests.
- **The lint.** `validateFlowTemplatePaths` and the two wrong-syntax hints (`lint-flow-patterns.ts`); `classifyFlowTemplateToken`, `FLOW_TEMPLATE_DATE_FUNCTIONS`, `FLOW_TEMPLATE_VALUE_FUNCTIONS` and `FlowTemplateTokenVerdict` are removed.
- **The verify handle.** `stack.automation.evaluateCondition`'s documentation states the engine's reading: CEL, a `{var}` hole refused.
- **ADR-0087.** No new entry: the step-18 D3 entries `flow-value-slot-template-dialect-refused` and `flow-text-slot-single-brace-refused` record the retirement.
