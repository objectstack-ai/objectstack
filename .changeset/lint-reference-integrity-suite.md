---
"@objectstack/lint": minor
"@objectstack/cli": patch
---

refactor(lint): one entry point for the reference-integrity suite (#3583 D5)

Six rules that answer the same question — "does this name resolve to anything?"
— were wired by hand into three CLI commands, so landing a rule meant editing
`validate`, `lint` and `compile`, and forgetting one meant the same stack got a
different verdict depending on which command the author ran.

New public API on `@objectstack/lint`:

- `validateReferenceIntegrity(stack)` — runs every reference-integrity rule and
  returns the concatenated findings.
- `REFERENCE_INTEGRITY_RULES` — the ordered list behind it (`validateObjectReferences`,
  `validateActionNameRefs`, `validatePageFieldBindings`, `validateChartBindings`,
  `validateNavAccess`, `validateTranslationReferences`).
- `ReferenceIntegrityFinding` / `ReferenceIntegrityRule` / `ReferenceIntegritySeverity`
  — one finding type instead of a six-way union.

Adding a rule to that list reaches `validate`, `lint` and `compile` with no
further wiring. The individual rule exports are unchanged, so nothing that
imports them directly needs to move.

Behaviour-preserving: identical findings on the three example apps (zero) and
on the HotCRM corpus (24, unchanged per rule). `os doctor` is deliberately not
converted — it runs only `validateWidgetBindings` and is an environment health
check rather than an authoring gate.
