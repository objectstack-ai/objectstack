---
'@objectstack/spec': patch
---

fix(spec): a field that authors both `inlineHelpText` and a different `description` keeps its source-language `description`

Clause-②: no
Metadata-protocol: none

Nothing changes in what a metadata author can write. What changes is the served, translated read of an object: `translateObject` serves a field's `objects.OBJECT.fields.FIELD.help` translation on ONE slot, the one the i18n extractor scaffolded the entry from.

- **Before.** The translation was served on `description`. The extractor scaffolds the entry from `help ?? inlineHelpText ?? description`, so on a field that authors both a non-empty `inlineHelpText` and a different `description`, the entry translates the `inlineHelpText`, and every reader of `description` (Studio, the designer) showed that other sentence's translation.
- **Now.** A field that authors a non-empty `inlineHelpText` is served the translation there and keeps its source-language `description` (and gains none when it has none). `description` takes the translation only when neither the served field nor its packaged declaration authors a non-empty `inlineHelpText`. An empty `inlineHelpText` reads as absent, as it does in the extractor and the console.
- **Unchanged.** A field that authors only `description` is served its translation there. Each slot keeps a value that diverged from the packaged declaration (a tenant's own edit). Nothing is ever served on a `help` key.
