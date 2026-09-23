---
"@objectstack/plugin-sharing": patch
---

`sys_sharing_rule.recipient_id` now declares `dependsOn: ['recipient_type', 'object_name']` — every sibling field its `recipient-picker` widget actually reads.

The picker reads two siblings, not one: `recipient_type` picks the mode (a record picker over `sys_user` / `sys_team` / `sys_business_unit` / `sys_position`), and for the `field` recipient kind (#15072) it reads `object_name` to offer that object's user-valued columns. The declaration named only the first. The neighbouring `criteria_json` field already declares `dependsOn: ['object_name']` for its own `filter-condition` widget, so the key is live and correctly used a few lines up — the omission was an omission.

Nothing was broken at runtime: the form renderer hands widgets the WHOLE watched record as `dependentValues` rather than a `dependsOn`-scoped slice, which masked the under-declaration. A renderer that ever scoped it — which is exactly what this key asks for — would drop the object name and degrade the `field` recipient mode to a plain text input **in silence**, with no error anywhere. This is the declaration catching up with what is read, so the scoping change can never be the one that breaks it.

The same commit corrects the `recipient_id` docblock: the picker no longer "has no mapping for that kind and degrades to its text input" — the pinned console (`.objectui-sha` 87af769e, which includes objectui#10049 / commit 23b99585) offers the shared object's user-valued columns for the `field` kind, using a "holds users" predicate that is a clause-for-clause copy of this plugin's own `fieldHoldsUsers`.

Authors and stored rows are unaffected: no key is added, removed or renamed, no value is newly accepted or refused, and no wire byte moves.
