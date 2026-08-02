---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

The ADR-0078 completeness gate ships: a Zod-valid metadata instance that silently does nothing now fails at author time, on every authoring surface.

This closes the hole *between* the platform's existing gates. An instance can be Zod-valid (gate 1 green), use only *live* properties (gate 2 green), and a correctly-authored sibling can be proven to run (gate 3 green) — and still be dead, because it omits a config its consumer needs and the consumer silently no-ops. The founding case (cloud#687): an AI authored `{ type: 'summary' }` with no `summaryOperations`; the engine's index builder skips it, the field reads 0 forever, the dependent "occupancy rate" is stuck at 0 — and the agent reported the work done, because every gate it could see was green.

**Why this is worse than the unknown-key hole #4001 just closed.** There, the author wrote a key we don't know, and the parse now rejects it with a prescription. Here every key is one we know, the schema is satisfied, nothing warns, and the author gets a success. It manufactures false completion without the author mistyping anything — and the review step that catches a human's bare summary (seeing the field render `0`) is exactly the step AI authoring removes.

**One shared predicate, every surface — the ADR's core decision.** Instance-completeness checks previously existed *only* in cloud's AI-build graph-lint, so a stack authored with `os` + a coding assistant, an MCP agent, `os validate` in CI, or by hand got none of them (`formula_without_expression` existed nowhere in the framework). The judgement now lives in `@objectstack/spec/kernel`'s `checkFieldCompleteness` / `checkViewCompleteness` — sibling of `isIncoherentAggregate`, the ADR-0019 pattern — consumed by the new `@objectstack/lint` `validate-functional-completeness` and registered as an author-time rule (28 → 29), so `os build` / `os validate` / `os lint` / MCP / hand authoring are all covered. Cloud graph-lint can re-home its duplicate rules onto the same predicate rather than drifting from it.

**Every rule cites the runtime line that makes it true**, because the completeness audit's scariest candidate — a "sharing rule fails open and shares every record" — collapsed on a three-file read, and #4001's last two batches shipped four confidently wrong prescriptions before learning the same thing:

| rule | the silent skip | severity |
|---|---|---|
| `field/summary-without-operations` | `engine.ts` — `if (!d.summaryOperations) continue` | error |
| `field/formula-without-expression` | `engine.ts` builds the formula plan only from fields that HAVE one | error |
| `field/relationship-without-reference` | `$expand` — `if (!referenceObject) continue` | error |
| `field/choice-without-options` (`select`, `radio`) | `record-validator.ts` — an empty option list disables server-side value validation | error |
| `field/choice-without-options` (`checkboxes`) | same branch, but shared with free-form | warning |
| `view/layout-without-binding` (`kanban`, `calendar`, `gantt`) | renderer falls back to literal default field names | warning |

**The deliberate NON-rules are pinned as hard as the rules.** `multiselect` without options is *not* flagged: `record-validator.ts` says verbatim `// free-form (tags without options)`. The runtime blesses it as a mode, which makes it ADR-0078 case (3) "genuinely optional" — flagging it would be another false prescription, and the test is where that attempt fails first. `timeline` / `tree` views are likewise out of v1: they have config schemas, but their renderer behaviour has not had its verification pass.

**It found a real one on its first run against a real app.** `showcase_field_zoo.f_summary` was a bare `Field.summary({ label: 'Roll-up Summary' })` — one line below an `f_formula` that *is* complete, in the object whose entire job is to show what each field type looks like. So the canonical example of a roll-up in this repo computed nothing. It could not be fixed by adding `summaryOperations`: a roll-up aggregates a child into its parent, and the zoo is a leaf (`f_master_detail` makes it a child of `showcase_project`, and nothing is a child of the zoo). Removed, with the working examples named — `showcase_invoice.total` for the plain sum, `showcase_expense_report.total_amount` / `approved_amount` for the `summaryOperations.filter` variant. The rule it broke was the file's own: "relationship types point at the other showcase objects so they have REAL targets."

Tracked in #4544. This is Phase 1; Phase 2 (the cloud authoring-path config-drop fix) is in the `cloud` repo, and Phase 3 lands the Tier-B shapes one verification pass at a time.
