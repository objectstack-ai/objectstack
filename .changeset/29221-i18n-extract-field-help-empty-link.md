---
'@objectstack/cli': patch
---

fix(cli): `os i18n extract` scaffolds a field's description when its `inlineHelpText` is empty

Clause-②: no
Metadata-protocol: none

Nothing changes in what a metadata author can write. What changes is the seed `os i18n extract` (and the `os i18n check` coverage gate) takes for a field's `objects.OBJECT.fields.FIELD.help` entry.

- **Before.** The seed was `help ?? inlineHelpText ?? description`, which stops at an empty string. A field with `inlineHelpText: ''` (or `help: ''`) and a `description` got a help entry with no seed, so the description, which is the line the console draws for that field, was never offered for translation.
- **Now.** The first link that carries authored text wins: an empty string reads as absent, as it does in the console's help line (`inlineHelpText || description`). Whitespace-only text still counts as authored, as it does in the console.
- **Unchanged.** `help` still wins over `inlineHelpText`, and a non-empty `inlineHelpText` still wins over `description`. A field whose links are all empty still gets the seed-less entry it got before.
