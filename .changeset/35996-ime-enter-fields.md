---
'@object-ui/components': minor
'@object-ui/fields': patch
---

Clause-②: yes (widening)
Metadata-protocol: none
Skills-docs: none — no skill teaches the input-method key guard (zero hits for `isImeKey` or `isComposing` under `skills/`); the field behaviour a skill describes is unchanged outside a composition

An Enter that picks a word in a Chinese, Japanese or Korean input method no longer acts in three more field widgets: a line grid's cell no longer moves to the next line or appends one (its arrows no longer move either), the date picker no longer commits the half-typed date, and the record picker's page-jump box no longer jumps and clears itself. Safari's 229 Enter raised just after the composition ends is treated the same way; the next Enter does what it always did.

`@object-ui/components` now exports `isImeKey(event)`, the one "does the input method own this key?" predicate. The list grid and every `@object-ui/fields` widget that reads its own keys ask it, so the copy `@object-ui/fields` kept is gone.
