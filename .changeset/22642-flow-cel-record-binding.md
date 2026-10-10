---
'@objectstack/service-automation': minor
---

fix(service-automation)!: in flow CEL, `record` is the record the run was handed, or unbound — never the run's variables

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-cel-record-variables-alias-retired -->

**BREAKING**, graded `minor` on the v18 prerelease line: Changesets is in pre mode with the tag `next`, and the fixed group is already majored by the line's opening marker, so this ships in an `18.0.0-next.N`.

**What changed.** A flow CEL expression — a node's or an edge's `condition`, a `decision` branch `expression`, a screen field's `visibleWhen`, and the CEL value envelopes of an `assignment` and of a `create_record` / `update_record` `fields` map — evaluates in the scope `AutomationEngine.celScope` builds. That scope used to bind `record` to the run's variables map whenever the run held no record, so `record.assignee` read a flow variable named `assignee` instead of failing. Now `record` is bound only when:

- an entrance handed the run a record: a record-change trigger's row, a time-relative sweep's row, the inbound hook's request body, a `type: 'flow'` action's record (the loaded row, or an empty record carrying at most the id it was given), a `subflow` or `map` parent's record, or a `map` item that carries a string `id`;
- or the flow binds a variable named `record` itself (a declared variable with a value, or an assignment target).

With neither — a run started through the REST trigger route or a declared endpoint, a cron schedule, or a child of such a run — `record.X` fails the run with `Unknown variable: record` and the expression's source, as every other unbound root does.

**What does not change.** A run that was handed a record reads `record.X` from that record, as before, over any variable of the same name. A bare variable name (`assignee`) and the `vars` namespace (`vars.assignee`) resolve as before. `$record`, `previous`, `vars` and `current_user` are untouched.

## Migration: FROM → TO

In a flow whose run holds no record, read a variable by its name:

| you wrote | write instead |
|:--|:--|
| `record.assignee` (a flow variable `assignee`) | `assignee`, or `vars.assignee` |
| `has(record.assignee) ? record.assignee : null` | `has(vars.assignee) ? vars.assignee : null` |

**The one-line fix: read a flow variable by its name or through `vars`; `record` is only ever the record the run was handed.** A flow that is also launched with a record (an action on a row, a record trigger) keeps reading that record's fields as `record.X`.

**Who is affected, measured.** Read statically over every flow CEL slot — 0 flows read `record` with no record entrance:

- this repository at `0ec4268972` (`examples/**`, `packages/platform-objects`, `packages/qa/dogfood`): 64 flows, 51 CEL slots, no flow in `packages/platform-objects`; the 2 flows that read `record` are an `api` hook flow and a record-change flow;
- `objectstack-ai/hotcrm` at `f0afcbda07` (`src/`, `test/`): 45 flows, 57 CEL slots; the 12 flows that read `record` are all record-change flows.

Deployed metadata and other repositories were not measured. `objectstack validate` does not refuse such a `record` read yet; the run fails it, naming the root and the source.
