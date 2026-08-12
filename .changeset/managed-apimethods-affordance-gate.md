---
"@objectstack/spec": minor
"@objectstack/lint": minor
"@objectstack/objectql": patch
---

feat(spec,lint): gate `enable.apiMethods` ⊆ affordances at authoring time, not only in the boot log (#7521)

A `managedBy` object that advertises a generic write verb in `enable.apiMethods`
while its own resolved affordances refuse that write is internally
contradictory — ADR-0049's `declared != enforced` class, stated entirely within
one object's declaration. `reconcileManagedApiMethods` (objectql's registry) has
always caught it at registration and **stripped** the verb, so nothing was ever
exposed. What it could not do is tell anyone: the only signal was a
`console.warn`.

`sys_environment` and `sys_package` declared
`apiMethods: ['get','list','create','update']` against `userActions` that refused
all three writes. The strip and its warning fired on **every control-plane boot
for the life of the divergence and nobody noticed** — the split was eventually
found by hand-driving the HTTP seam while writing something unrelated, not by
any gate. A boot log is not an authoring surface: it is read after an incident,
by an operator, in a repo whose author has long since moved on.

**New rule — `object/managed-api-method-unaffordable` (`error`).** `os lint`,
`os validate` and `os build` now report the contradiction where the author is
standing, naming the refused verbs, the `userActions` flags that would be needed
and both ways out. It runs pre-parse, so the finding survives an unrelated schema
error elsewhere in the stack.

**One predicate, two consumers.** The judgement moved to
`checkManagedApiMethodAffordances` in `@objectstack/spec/data` — beside
`resolveCrudAffordances`, the affordance authority both sides already read — and
the registry's strip is now a pure reaction to it. That is the point rather than
a tidy-up: a second copy of this table at either consumer would *be* the
declared≠enforced drift the rule exists to detect. Same shape, and same reason,
as `checkFieldCompleteness` under ADR-0078.

**Boot behaviour is deliberately unchanged.** `reconcileManagedApiMethods` still
warns and strips; it does not throw. Failing registration closed would let one
metadata typo kill a control-plane boot, which is too harsh for ops — the
author-time gate is where this blocks. The boot warning now cites the lint rule
id, so an operator who greps a stripped verb out of a log lands on the gate.

Also exported: `validateManagedApiMethods` and `MANAGED_API_METHOD_UNAFFORDABLE`
from `@objectstack/lint`. A repo whose object definitions live in **code** — which
`os lint` never walks — can run the same rule over its own registry instead of
hand-rolling the affordance table, which is what every such repo has had to do
until now.
