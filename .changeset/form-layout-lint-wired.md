---
"@objectstack/cli": minor
---

Wire `validateFormLayout` into the authoring-rule registry, and close the
registry from the other direction (#4449).

`validateFormLayout` was implemented, unit-tested, exported from
`@objectstack/lint` and given published rule ids (`form-field-unknown`,
`absolute-colspan-discouraged`) — and **no command ever called it**. It ran on
zero stacks for as long as it existed, so a form section referencing a field
that is not on the bound object, or pinning an absolute `colSpan` under a
per-surface derived column count, produced no output anywhere. It is now an
`advisory` entry in `AUTHORING_RULES`, so `os validate`, `os build` and
`os lint` all run it. It is a pure structured-metadata walk with no lazy
dependency, so all three commands pay nothing measurable.

The wiring guard (#4409) could not have found this. Every one of its invariants
starts FROM a registry and looks at the commands, which is blind by construction
to a rule that never entered a registry — the same shape as #4402's name list
guarding only the names on it, one layer up. The guard now also runs the reverse
subtraction: every `validate*` / `lint*` symbol on `@objectstack/lint`'s public
barrel, minus `AUTHORING_RULES` ∪ `REFERENCE_INTEGRITY_RULES`, must be empty or
carry a written reason in `UNWIRED_RULE_LEDGER`. The ledger ships empty: today's
difference was exactly this one rule.
