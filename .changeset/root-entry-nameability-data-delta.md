---
"@objectstack/spec": minor
---

feat(spec): make `BaseValidationRuleShape` and `FilterCondition` nameable from the root entry (#11709)

Additive follow-up to the #11350 root-entry nameability fix, same invariant
(a type that appears structurally in an entry's public declarations must be
nameable from that same entry): a minimal consumer program with an
un-annotated `export default defineStack(...)` and **no** `@objectstack/spec/data`
import anywhere in its program still failed declaration emit with exactly two
TS2883 diagnostics — `BaseValidationRuleShape` and `FilterCondition`, both
mentioned structurally by `defineStack`'s return type but reachable only
through hash-named internal dist chunks. The root entry now re-exports both
types from their declaring `/data` modules (`data/validation.zod`,
`data/filter.zod`), exactly as #11350 did for `FormFieldInput` /
`NavigationItemInput` / `StateNodeConfig`. No runtime change; existing
consumers that already imported these names from `@objectstack/spec/data` are
unaffected.
