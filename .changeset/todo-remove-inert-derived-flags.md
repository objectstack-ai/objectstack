---
"@objectstack/example-todo": patch
---

fix(example-todo): remove the inert `is_completed` / `is_overdue` flags and repair every filter that read them (#7226)

`examples/app-todo/src/objects/task.object.ts` declared `is_completed` and
`is_overdue` as `readonly: true` booleans defaulting to `false`. Nothing in the
app ever wrote either one — no hook leg, no flow node, no action handler, and
the seed data set neither — so both were `false` on every row for the life of
the app, while **twelve** view / dashboard / report / flow filters read them as
if they were maintained.

The consequence was not cosmetic. Every surface asking `is_completed: true` was
permanently empty: the "Completed Today" tile, the "Weekly Task Completion"
trend, and both the "Completed Tasks" and "Time Tracking" reports. So was the
whole "Overdue Tasks" list view, which asked `is_overdue: true`. The eight
surfaces asking `is_completed: false` were vacuously true instead — they matched
completed tasks too. `task.hook.ts` also carried an `afterUpdate` branch gated
on `data.is_overdue && previous && !previous.is_overdue`, which could never run.
Since #7036 started stamping `completed_date` on the completion transition, the
divergence was directly readable in the shipped app: a task could carry a
completion date and `is_completed: false` at the same time.

**Removed rather than derived as formula fields, for a measured reason.** A
`Field.formula(...)` computes both correctly — including the temporal one
(`date(record.due_date) < today()` evaluates per read, with a per-call `now`
snapshot) — so deriving looks like the obvious repair. It is not: a `formula`
field is virtual, no driver materialises a column for it, and so a *filter*
naming one matches nothing. Measured on this app's own sqlite-wasm driver,
`where { is_completed: false }` against a formula field returns **0 rows with no
error**, where the stored boolean returned every row. Deriving would therefore
have silently emptied the "Due Today" view, the daily reminder flow and both
open-task reports — trading a wrong answer for an invisible one.

`status` and `due_date` are stored, indexed columns that already carry the
information, and both are declared dimensions on the `task_metrics` dataset, so
every consumer now asks the semantic layer's own vocabulary directly:

| was | is now |
|---|---|
| `is_completed == true` | `status equals 'completed'` |
| `is_completed == false` | `status not_equals 'completed'` |
| `is_overdue == true` | `due_date less_than '{today}'` AND `status not_equals 'completed'` |

Updated across `task.object.ts`, `task.hook.ts`, `task.view.ts`,
`task.dashboard.ts`, `task.report.ts`, `task.flow.ts`, the three translation
bundles and the README. The hook's dead overdue branch is removed rather than
re-armed against `due_date`: becoming overdue is the passage of time, not a
record write, so a record hook is structurally the wrong instrument — the
clock-driven `overdue_escalation` scheduled flow already covers it.

Pinned by `examples/app-todo/test/derived-flag-removal.test.ts`, which walks the
app's real `defineStack` for any surviving reference, drives the replacement
filters across **both** sides of the completion transition (so a filter cannot
pass for the same reason the old flag did — everything being false), and records
the formula-filter measurement that decided the route.
