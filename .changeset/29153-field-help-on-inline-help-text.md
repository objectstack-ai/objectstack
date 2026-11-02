---
'@objectstack/spec': patch
---

fix(spec): a field's translated help reaches its authored `inlineHelpText`, the line the console draws

Clause-②: no
Metadata-protocol: none

Nothing changes in what a metadata author can write. What changes is the served, translated read of an object: `translateObject` (the resolver behind `GET /api/v1/meta/object/:name` and every other localized object read) now serves a field's `objects.OBJECT.fields.FIELD.help` translation on the field's own `inlineHelpText` when the field authors one.

- **Before.** The translation was served on `description` only. The i18n extractor scaffolds that entry from `help ?? inlineHelpText ?? description`, and the console draws a field's help line from `inlineHelpText || description`, so a field that authored `inlineHelpText` showed its source-language text in every locale and its translation never appeared.
- **Now.** A field that authors a non-empty `inlineHelpText` is served the translation there, the text the entry was scaffolded from, and keeps its source-language `description`. A field without one (absent, or an empty string, which the console reads as absent) gains no `inlineHelpText` key; its translation stays on `description`, which the console already draws.
- **Unchanged.** A locale with no `help` entry for the field, and the source locale, serve the authored text. Each slot keeps a value that diverged from the packaged declaration (a tenant's own edit), judged per slot by the same rule that already guards `description`. Nothing is ever served on a `help` key.
