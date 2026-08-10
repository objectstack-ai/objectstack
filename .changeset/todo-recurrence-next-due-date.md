---
"@objectstack/example-todo": patch
---

fix(example-todo): `task_completion`'s recurrence branch computes a real next due date — it wrote a literal `DATEADD(...)` string the driver refused (#7037)

`examples/app-todo`'s `TaskCompletionFlow` spawned the next occurrence of a recurring task
with

```
due_date: 'DATEADD({completedTask.due_date}, {completedTask.recurrence_interval}, "{completedTask.recurrence_type}")'
```

**Two independent faults, stacked.** `DATEADD` exists nowhere in the platform — not a CEL
builtin, not registered by `packages/formula` under any casing. And a `create_record`
node's `fields` values are TEMPLATE-interpolated, never evaluated: the `{…}` holes are
filled and the surrounding text passes through verbatim. So what reached the engine was
the literal string `DATEADD(2026-08-10, 1, "daily")`, and the field's own coercion refused
it with `Due Date must be a valid date (ISO-8601)`, failing the whole run.

**Reachability changed with #6882; the defect did not.** While the flow was unbound the
node never executed and the dead function text was inert. Armed, every completion of a
*recurring* task produced a failed run, so the recurrence feature the node exists for had
never once worked.

**Why the repair is a `script` node and not a better expression.** No flow node evaluates
a value-producing expression. The builtin vocabulary's only expression slots are
PREDICATES (`config.condition`, `edge.condition`, `decision.conditions[].expression`,
`screen.fields[].visibleWhen`) and `flow-template` REFERENCES (`loop.collection`,
`map.collection`) — the ledger is `FLOW_NODE_EXPRESSION_PATHS` in
`@objectstack/spec/automation` — and an `assignment` node interpolates rather than
evaluates. The next due date therefore has to be computed *before* the create node runs.

A `compute_next_due_date` `script` node now calls `computeNextTaskDueDate`, registered
through `defineStack({ functions })` — the pure-function shape (#1870, #4396) that
`showcase_task_completed` already uses: it takes `input`, returns the date, and
`create_next_task` persists it by reading the whole-string token `{nextDueDate}`. The
function handles all four authored cadences (daily / weekly / monthly / yearly × interval),
clamps a monthly shift to the target month's last day exactly as `@objectstack/formula`'s
`addMonths` does — so the app cannot teach a recurrence semantic that disagrees with the
platform's own formula function — and refuses an unknown `recurrence_type` or an interval
`min: 1` forbids instead of guessing a cadence.

The non-recurring path is unchanged: the `check_recurring` gate still routes straight to
`end`, skipping both nodes.

New suite `test/task-recurrence.test.ts` drives the app's real metadata, real object and
real function registry through a real kernel over sqlite: the spawned task's `due_date` is
asserted for daily / weekly / monthly completions, and a reverse fixture rebuilt from the
live flow shows the pre-fix shape — any function-call text left in a `create_record` field
value — still failing inside `create_next_task` with the date refusal, and notably *not*
with "no function named …", because nothing ever tried to call one. A class-level guard
asserts no write node in any of the app's flows leaves function-call text in a field value.
