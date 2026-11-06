---
'@objectstack/skills': patch
---

docs(skills): the platform skill teaches the declared action override and its access-widening refusal

Clause-②: no
Metadata-protocol: none

- **Before.** `objectstack-platform`'s customization paragraph (ADR-0146) listed the types a `.custom` pair's declared override is honoured for without `action`, and `content/docs/concepts/metadata-lifecycle.mdx` said an `action` override was not served yet. Both have been false since `action` opened (ADR-0146 D9).
- **Now.** The skill lists `action` and says what an action override may change: it keeps the base's `objectName` (the doors match the base's action as `OBJECT:NAME`, and moving it to another object is refused `declared_package_ships_no_such_item`), and it replaces the behaviour (`type`, `body`, `label`, `visible`, …) whole for whoever could already run the base. Dropping a `requiredPermissions` entry, turning `ai.exposed` on or `ai.requiresConfirmation` off is refused `403 NOT_OVERRIDABLE` with rule `declared_action_widens_access`. The docs page says the same, and the skill's evals gain a case for it.
- No schema, key or behaviour changes.
