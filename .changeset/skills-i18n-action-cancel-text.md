---
'@objectstack/skills': patch
---

docs(skills): objectstack-i18n teaches the action `cancelText` key and the dialog-key host refusals

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-i18n/SKILL.md`'s `_actions.{action_name}` row names `cancelText`: the dismiss button of the confirm or param dialog, only under an action that declares `confirmText` or a non-empty `params`.
- The `translation-target-unknown` paragraph adds `submitText` under an action with no non-empty `params`, and `cancelText` under an action that declares neither `confirmText` nor a non-empty `params`.
- Nothing to do on upgrade: the key is already accepted, checked and read by the console; this only teaches it.
