---
'@objectstack/lint': minor
---

Warn when a bare identifier in a flow node/edge condition is shadowed by a declared flow variable

A flow `condition` is evaluated in a flattened scope, so a bare `status` normally
resolves to the trigger record's field and is the correct, canon-taught spelling.
`objectstack validate` deliberately never judged a bare identifier there, and it
still does not — with one exception it now names.

When the same name is BOTH a declared flow variable and a field on the bound
object, the two collide silently: a run seeds its declared variables first and
flattens the record's fields only where nothing is bound yet, so the variable
wins, the field is unreachable under its own name, and nothing anywhere reports
it. The author reads `status` and gets the variable. On this surface that is the
least visible failure there is — a flow condition that never fires produces no
record, no error and no log line.

`validateStackExpressions` now emits a `warning` (never an error) on exactly that
case, naming the mechanism and both repairs: `record.status` for the field, or
rename the variable. A bare name that is only a field, or only a variable, stays
silent as before.

The variable set is collected across every ADR-0031 region of the flow, since a
run holds one variable map: flow-level declarations, loop/map iterator and index
variables, the try/catch error variable, node output variables, assignment
targets in all three shapes the executor accepts (including a legacy assignment
node with no `assignments` wrapper, whose top-level config keys are the variable
names), and node ids, which are bare CEL roots at runtime.
