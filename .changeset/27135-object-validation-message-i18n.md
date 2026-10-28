---
'@objectstack/spec': patch
---

fix(spec): `translateObject` serves `validations[].message` in the reader's language

Clause-②: no
Metadata-protocol: none

Under a translated locale, the server's refusal of a write that breaks a validation rule carried the translated message, while `GET /api/v1/meta/object` served the same rule's authored message. A client explaining a rule from the served object, such as the board's tooltip on a lane a rule closes, showed one sentence in the authoring language and the refusal of the same move another, in the reader's.

`translateObject` now overlays each rule's `message` from `objects.OBJECT._validations.RULE.message`, the key the rule evaluator refuses a write with (`objectValidationMessageKey`). It walks the same locale chain as the other overlays, and a `conditional` rule's branches are translated by their own names. A rule the bundle has no message for, or one with no name, keeps its authored message, as the refusal does. Field, action and list-view translations are unchanged.
