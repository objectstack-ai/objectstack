---
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/mcp': minor
'@objectstack/spec': minor
---

fix(lint)!: every flow condition's text-vs-number comparison gets a verdict that says what the run does — a record-triggered flow's `record.<field>` read and `decision` branch are refused like its bare name, and any other flow's warning says the run fails instead of "evaluates to null" (#29959)

Clause-②: yes (narrowing) — the author-time gate (`os build`, `os validate`, the package publish and the flow publish door) refuses, on a record-triggered flow, a `type-mismatch` in a `decision` branch and in a `record.<field>` / `previous.<field>` read of a start or edge condition, which it passed with no verdict before; and a flow condition's `type-mismatch` warning is served under its own code `type-mismatch-run-may-fail` instead of `type-mismatch`. Added beside them (the widening half): the optional `severity` and `triggerKind` inputs of the `validate_expression` MCP tool, and the code `type-mismatch-run-may-fail` in `@objectstack/formula`'s `ExpressionRefusalCode`.
Metadata-protocol: narrowed
Skills-docs: updated here — `content/docs/data-modeling/formulas.mdx` (the type-soundness row names the decision branch, the `record.<field>` read and the warning on other flows) and the MCP skill text in `packages/mcp/src/skill-md.ts` (the two new `validate_expression` inputs); `skills/**` teaches no text-vs-number comparison in a flow condition (grep for `type mismatch`, `evaluates to null`, `validate_expression` and the decision examples), so no skill or eval moves.

<!-- adr-0087: registered flow-record-read-and-decision-type-mismatch-refused -->

**BREAKING** accept-set narrowing at the author-time expression gate, served by `os build`, `os validate` and `POST /api/v1/packages/:id/publish-drafts`.

- **Record-triggered flows — before.** The start and edge conditions refused `name > 5` on a text field (`type-mismatch-run-fails`), but `record.name > 5` in the same slot, and `name > 5` in a `decision` node's `config.conditions[].expression`, published with no verdict at all. Both fail the run the same way: the engine's `evaluateCondition` throws on the fault, the run binds the trigger record both as `record` and flattened to bare names, and a decision branch is evaluated over the same variables as an edge.
- **Now.** Both are refused as `expression-invalid` at `severity: error`, code `type-mismatch-run-fails`, with the message the bare name already gets: the run fails at the condition and the triggering write still lands. `previous.<field>` is judged the same way. The date verdicts stay on the bare name only, as before.
- **Any other flow** (no `triggerType`, a `schedule` or time-relative flow, an `api` flow) and an inert node `condition` keep a warning. Its text said the expression "silently evaluates to null", which is false on every flow: a condition that faults fails the run. It is now `type-mismatch-run-may-fail`, worded for the failed run, and a warning because such a flow is handed whatever its entrance carries (an API request body, an action's partial record, a parent flow's record, or nothing), so the field's type is not proven to be what the name holds. A `record.<field>` read and a `decision` branch there get the same warning. The flow registration log line reads the same text.
- **`validate_expression` (MCP).** Two optional inputs, so the tool answers what the gate will: `severity` (`error` | `warning` | `info`, site `validation`; default `error`) gives an advisory rule the gate's `type-mismatch-fail-open` instead of the fail-closed verdict, and `triggerKind` (`record_change` | `time_relative` | `schedule` | `api` | `none`, site `flow_condition`; default `record_change`) gives a flow that is not record-triggered the gate's warning instead of the run-fails error. Either input on a site it does not describe is refused as a tool error. A call that passes neither answers as before.
- **`@objectstack/spec`.** Upgrade guide entry `flow-record-read-and-decision-type-mismatch-refused` (semantic: no mechanical rewrite).

**FROM → TO.** In a record-triggered flow: `record.name > 5` (or a decision branch `name > 5`) on a text field → `size(record.name) > 5` for its length, `record.score > 5` on a number field for a value, or `double(record.name) > 5` only when every value is numeric text. A boolean: `record.active > 0` → `record.active == true`. A consumer keyed to the code of a flow condition's warning: `type-mismatch` → `type-mismatch-run-may-fail` (`@objectstack/formula@18.3.0` and `@objectstack/mcp@18.3.0` serve `type-mismatch` there; the record-scoped `type-mismatch`, on a formula field or a display predicate, is unchanged).
