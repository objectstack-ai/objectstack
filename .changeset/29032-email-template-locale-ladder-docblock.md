---
'@objectstack/metadata-core': patch
---

docs(metadata-core): the `ITEM_KEY_DISCRIMINATORS` docblock no longer says email template resolution is exact with no language-subtag folding

Clause-②: no
Metadata-protocol: none

The docblock ships in the package's type declarations, and it still described the exact `(name, locale)` ladder: the named tag matched exactly, then `en-US`. Over the built-in registry template loader a named locale is now folded against the bundle's tags, then the stack's declared fallback locale is tried, then `en-US`. The docblock now cites `SendTemplateInput.locale` in `@objectstack/spec` as the ladder of record instead of restating its rungs, and keeps the point the table rests on: every rung loads one row at one tag exactly, so `en` and `en-US` stay two distinct rows of one bundle. No code changed.
