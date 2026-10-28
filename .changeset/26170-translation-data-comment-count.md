---
'@objectstack/spec': patch
---

docs(spec): the `TranslationDataSchema` TSDoc counts sixteen per-app translation groups, not fifteen

Clause-②: no
Metadata-protocol: none

The comment on `TranslationDataSchema` said "Fifteen groups" after the `hooks` and `books` groups both landed; the per-app bundle (`appTranslationDataShape()`) has sixteen. Comment only: no schema, describe, refusal message or generated artifact changes.
