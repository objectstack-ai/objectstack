---
"@objectstack/example-showcase": patch
---

fix(showcase): put the remaining eight authored validation messages on the translation channel (#14518)

`showcase_account` declares seven author-written `validations[].message` and
`showcase_task` one, and none of them had an
`objects.OBJECT._validations.RULE.message` entry. An authored message is emitted
VERBATIM without one, so on a `zh-CN` session those refusals arrived in English
beside the platform's own — which have shipped `zh-CN` since #3957 — two
languages inside one `400 VALIDATION_FAILED` envelope. #14311 fixed the same
defect for `showcase_project`; its scope was one wizard, so these were left.

Both nested `conditional` branches get their own entry. `checkConditional`
delegates to the matching branch and renders THAT branch's message, addressed by
the branch's own `name`, so `churn_reason_consistency`'s own sentence is
structurally unreachable — translating only the wrapper would have translated
the one sentence nobody reads. Its entry is kept anyway so the bundle mirrors
the declared rule set 1:1.

The pin is now BUNDLE-WIDE rather than per-object: it walks the composed stack's
objects and object extensions, descends into conditional branches, and asks the
question for every locale `i18n.supportedLocales` claims, so a newly declared
rule without a translation fails instead of rotting. It also pins the
default-locale entry to the authored sentence verbatim — the bundle wins in
every locale, `en` included, so a drifted `en` entry turns the object's own
message into dead text no reader ever sees.
