---
'@objectstack/spec': minor
'@objectstack/objectql': minor
---

fix(i18n): a tenant's rewrite of a packaged validation rule message is served as written in every locale, on the refusal and on `/meta` (#27221)

Clause-②: no
Metadata-protocol: semantic

A package's bundle translates the rule messages that package shipped (`objects.<object>._validations.<rule>.message`). When a tenant overlaid a packaged object and reworded one of its validation rule messages, keeping the rule's name, a reader in any locale the bundle carries got the package's translation instead of the tenant's sentence. The rejected write's error and the rule served by `/meta` (and the public form) both showed it.

- **Now.** Both readers apply the bundle entry only while the served message still equals the packaged rule's message of the same name. A message that differs is the tenant's own and is served and returned as written, in every locale. Rules the tenant left alone are still translated. A `conditional` branch is matched by its own name. A rule the owning package does not declare (one an `objectExtensions` entry adds, or one the tenant added) has no packaged message to differ from and is still translated under its own name, as before. With no packaged owner (an object authored entirely at runtime), nothing changes.
- **One rule, both readers.** `/meta` (`translateObject`) and the rule evaluator use the same comparison, the one already applied to an object's `label`, `description`, embedded list views and fields. `/meta` and the refusal of the same write still show one sentence for one rule and locale.
- **`scalarOverridesPackagedBase`** (`@objectstack/spec/system`) now also accepts the key `'message'`, so the rule evaluator judges a rule message through it. Its behaviour for the existing keys is unchanged.
- **`evaluateValidationRules`'s `messages` option** (`EvaluateRulesOptions.messages`, `@objectstack/objectql`) gains an optional `packagedRule` lookup, which the engine fills from the object's packaged owner. A caller that passes its own `messages` without it keeps the previous behaviour.
