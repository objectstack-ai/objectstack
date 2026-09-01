---
"@objectstack/lint": patch
---

fix(lint): a field-level `*When` reading `app` gets the scope diagnostic, not the false `record.app` prescription (#13935)

`fieldRuleRootIssue` judged field-rule roots against `@objectstack/formula`'s
`SCOPE_ROOTS`, which answers "is this root declared **platform-wide**". The
question this rule needs answered is "is this root bound at **some** evaluation
site". The two agreed for all 27 baseline roots and disagreed for exactly one:
`app`, which objectui's `ExpressionProvider` binds on the form-view surface an
author migrates a field rule *down* from.

Falling outside the membership test sent `app` to the generic bare-reference
check, whose prescription is ``Write `record.app` `` — and following that
advice earns ``unknown field `app` on `invoice` `` from the field-existence
pass. A first diagnostic that asserts something false about where the root
binds, plus a wasted correction cycle. `current_user`, `user`, `ctx`, `os`,
`features` and `data` all got the correct message; `app` alone did not.

Authoring a field-level `visibleWhen` / `readonlyWhen` / `requiredWhen` on
`app` now earns the same scope diagnostic every other unbound root gets —
"a field-level conditional rule binds only `record` (plus `previous`, and
`parent` on a master-detail line item)" — with a prescription tier of its own
that says what is actually true of an ambient root: it is *not* declared
platform-wide, it is mounted only by the renderer, and `record.app` is
explicitly refused rather than merely omitted, because that is the advice the
author just followed out of the old diagnostic.

**No accept set moves.** `SCOPE_ROOTS` is `@objectstack/formula`'s published
strict-lint baseline — adding `app` there would stop *every* surface that
judges bare identifiers from faulting it, to fix one surface's wording. The
widened vocabulary is assembled in `@objectstack/lint` instead, where the
per-surface question is asked, and both diagnostics involved were already
`severity: 'error'`, so this changes which message an author reads and nothing
about what lints clean.

`FIELD_RULE_AMBIENT_ROOTS` and `FIELD_RULE_JUDGED_ROOTS` are exported beside
the existing `FIELD_RULE_BOUND_ROOTS`.
