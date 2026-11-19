---
'@objectstack/lint': minor
'@objectstack/spec': minor
'@object-ui/plugin-detail': minor
---

fix(lint): `field-group-shadowed` judges the six highlights the record page draws, from one shared constant

Clause-②: yes (widening)
Metadata-protocol: narrowed

The default record page draws the first six of an object's `highlightFields` (after the title field leaves the list) in its header strip and leaves those fields out of the Details body. The `field-group-shadowed` warning judged only the first four, so a field group whose only member sat fifth or sixth in `highlightFields` was empty on the record page and passed `os lint --strict`. It now judges the same six, and its hint says "first 6 highlightFields".

What was accepted before and is warned now: an object whose field group is emptied by its fifth or sixth highlight. Fix it as the hint says: keep a member of that group out of the first six highlights, or drop the group. A list the old count warned is still warned: six hoisted fields include the first four, so no list that passed only under six is refused.

New export: `@objectstack/spec/ui` adds `RECORD_HIGHLIGHTS_MAX` (6), the count both the lint and `@object-ui/plugin-detail`'s record page synthesizer read. `@object-ui/plugin-detail` now takes its own `RECORD_HIGHLIGHTS_MAX` from there; the value and the page are unchanged.

<!-- adr-0087: registered field-group-shadowed-six-highlights -->
