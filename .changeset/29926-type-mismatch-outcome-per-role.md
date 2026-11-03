---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/mcp': minor
'@objectstack/spec': minor
---

fix(lint)!: a text-vs-number comparison in a record-triggered flow condition is refused with what really happens (the run fails, the write lands), and in an advisory validation rule the refusal no longer says the write is refused (#29926)

Clause-②: no (narrowing) — the author-time gate (`os build`, `os validate`, the package publish and the flow publish door) refuses a `type-mismatch` in a record-triggered flow's start or edge condition that it used to pass with a warning; and the fail-closed arm of the verdict is served under its own code `type-mismatch-fail-closed` instead of `type-mismatch` with `params.outcome`. Added beside them: the codes `type-mismatch-run-fails` and `type-mismatch-fail-open`, and the exported type `ExprFaultOutcome`.
Metadata-protocol: narrowed
Skills-docs: updated here — `content/docs/data-modeling/formulas.mdx` (the type-soundness row names each outcome) and the MCP skill text in `packages/mcp/src/skill-md.ts` (`flow_condition` now errors too); `skills/**` teaches no text-vs-number comparison in a flow condition or an advisory rule, so no skill or eval moves.

<!-- adr-0087: registered flow-condition-type-mismatch-refused -->

**BREAKING** accept-set narrowing at the author-time expression gate, served by `os build`, `os validate` and `POST /api/v1/packages/:id/publish-drafts`.

- **Record-triggered flow conditions — before.** `name > 5` on a text field, as the start node's `condition` or an edge `condition` of a flow whose start `triggerType` is `record-*`, published with an `expression-invalid` warning saying the expression "silently evaluates to null". It does not: the engine's `evaluateCondition` throws on the fault, so the run fails at that condition, and the record-change trigger isolates the write that fired it, so the write lands and the flow's work is not done.
- **Now.** The same condition is refused as `expression-invalid` at `severity: error`, code `type-mismatch-run-fails`, with a message saying the run fails at the condition and the triggering write still lands. This is the severity and outcome the nullable-comparison verdict already has on those conditions (#29026). A flow that is not record-triggered, and a node `condition` other than the start node's (inert), keep the warning. The `validate_expression` MCP tool answers the same for `site: 'flow_condition'`.
- **Advisory validation rules** (`severity: 'warning'` / `'info'`). Still refused at publish, as the nullable twin refuses them, but under `type-mismatch-fail-open` with a message that says what happens: the rule is skipped, the write proceeds, and the rule never gives its advisory. The nullable twin's message on the same rule now says the same instead of "the write is rejected fail-closed". A `severity: 'error'` rule keeps both refusals and their wording.
- **Refusal codes (`@objectstack/formula`).** A code names one message template, so each outcome has its own: `type-mismatch` (warning, reads null), `type-mismatch-fail-closed`, `type-mismatch-run-fails`, `type-mismatch-fail-open` (all errors). `ExprSchemaHint.faultOutcome` takes `'fail-closed' | 'run-fails' | 'fail-open'` (exported as `ExprFaultOutcome`); the `outcome` param on `type-mismatch` is gone.
- **`@objectstack/spec`.** Upgrade guide entry `flow-condition-type-mismatch-refused` (semantic: no mechanical rewrite). The `validation-type-mismatch-refused` entry's acceptance criteria now say a create answers 201, the data door's status.

**FROM → TO.** Flow condition `name > 5` on a text field → `size(name) > 5` for its length, `score > 5` on a number field for a value, or `double(name) > 5` only when every value is numeric text. A boolean: `active > 0` → `active == true`. A consumer keyed to the code: `type-mismatch` with `params.outcome === 'fail-closed'` → `type-mismatch-fail-closed`.

**Supersedes, in the same release.** The #29904 changeset (`29904-type-mismatch-fail-closed.md`) says the refusal's `params` carry `outcome: 'fail-closed'`, and that flow conditions keep the warning. Both are replaced here: the fail-closed refusal is served as `type-mismatch-fail-closed` with no `outcome` param, and a record-triggered flow's start and edge conditions are refused as above.
