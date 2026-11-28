---
'@objectstack/formula': minor
---

fix(formula): a date field compared with `addDays(today(), N)`, `addMonths(…)`, `date(…)`, `timestamp(…)` or the working-day functions evaluates the way the `today()` comparison does

Clause-②: no
Metadata-protocol: semantic

A `date` field reaches a flow condition, a validation rule or a formula as its `YYYY-MM-DD` text. The runtime already converts that text when it meets `today()`, `now()`, `daysFromNow()` or `daysAgo()`. It missed every other call that returns a timestamp, though every save door (`os validate`, publish, flow registration) accepted the condition:

- An ordering such as `record.due_date < addDays(today(), 30)` failed on every run with `no such overload: dyn<string> < google.protobuf.Timestamp`. A flow with it as its start condition never ran its steps.
- An equality such as `record.due_date == addDays(today(), 1)` answered `false` on the very day it names (and `!=` answered `true`), with no error, so the flow was skipped as "condition not met". `== date("2026-06-21")` and `== timestamp("2026-06-21T00:00:00Z")` did the same.

Both now answer what the `daysFromNow(N)` spelling of the same comparison answers. The set of functions converted is read from the functions the engine declares as returning a timestamp, so a function added later is covered too.

**What changes for a deployed app.** Nothing to rewrite. A flow, validation rule or formula that already uses one of these comparisons starts behaving as written: a flow whose start or decision condition failed or was skipped on every run now fires on the records the condition names. Review such flows before upgrading if they send email, create records or call out, since they will start doing so. An author who worked around the defect with `date(record.due_date) < addDays(today(), 30)` keeps the same answer.
