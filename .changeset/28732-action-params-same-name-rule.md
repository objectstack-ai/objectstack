---
'@objectstack/spec': patch
---

docs(spec): `ActionSchema.params` states the same-name param rule

Clause-②: no
Metadata-protocol: none

The `params` member's description now says what the params check already does when an action declares one param name more than once: a name may repeat only for per-gate variants of one input (declarations that differ in `visible` / `requiresFeature`), the name is required only when every declaration of it requires it, and its value is judged by the first declaration's shape (`type`, `multiple`, `options`). Until now this rule was stated only on `validateActionParams`, where an author writing an action does not read. Description text only: no key, no accepted value and no refusal changes, and the generated JSON Schema and reference pages carry the same sentence.
