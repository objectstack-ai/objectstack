---
'@objectstack/spec': patch
'@objectstack/lint': patch
---

Re-measure four stale `current_user` binding-text sites, including the form SECTION slot

The claim that `current_user` is unbound on a form-view **section** predicate was true when
it was written and is not any more: the console form renderer threads the host shell's
predicate scope into `isSectionVisible` (objectui#6110), and the object-view chain now
carries an authored `section.visibleWhen` through to an evaluator via the `section-divider`
pseudo-field (objectui#6111). Text only — no schema, no verdict and no runtime behaviour
moves.

- `FormSectionSchema.visibleWhen` (`ui/view.zod.ts`) — the JSDoc and `describe()` now say the
  root resolves, carrying the two qualifications the field-slot text already carried: the
  binding is **client-side only** (no write-path evaluator reads a form-view section or field
  `visibleWhen` — the rule validator's list is field `readonlyWhen` / `requiredWhen` and
  per-option `visibleWhen`), and the scope is **empty on the public `/f/:slug` route**, which
  is mounted outside any provider on purpose. The `features.*` refusal sentence is unchanged:
  that root is unbound on both standalone form routes.
- `SelectOptionSchema.visibleWhen` (`data/field.zod.ts`) and
  `SELECT_OPTION_EDITABILITY_GUIDANCE` (`shared/editability-boundary.ts`) — the retired
  exclusivity claim ("the one `*When` surface where `current_user` resolves") is trimmed. The
  durable grounding stays and is now what the prescription rests on: per-option is the one
  visibility predicate the **server** enforces, so the rule validator refuses a write of a
  value whose predicate is false.
- `@objectstack/lint`'s field-rule message — the `visibleWhen` consequence clause is
  re-measured. Under a scope-publishing host the predicate no longer faults: it resolves, the
  control is hidden client-side, and the server still returns the value to every other reader
  — a silent enforcement gap. The fault-open leg survives wherever no host publishes a scope.
  The verdict is unchanged and the message says why it is now *more* justified: trading a loud
  lint error for a gap nobody can see is worse than the error.
