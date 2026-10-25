---
'@objectstack/cli': patch
---

fix(cli): `os i18n check` reads a field's `inlineHelpText` as the default-locale text of its `help` key

Clause-②: no
Metadata-protocol: none

The field help key (`objects.OBJECT.fields.FIELD.help`) took its inline source from `help` then `description` only, while `FieldSchema` spells help text `inlineHelpText`. An app that authored `inlineHelpText` and translated `help` into one locale had its default locale reported as missing a translation. The inline source is now `help`, then `inlineHelpText`, then `description`, like an authored label; a non-default locale with no `help` is still reported as a gap.
