---
'@objectstack/spec': patch
---

feat(i18n): one label order on an overridden item, for all eight document translators — the pair's translation, then the override's own label, then the base's translation

Clause-②: yes (widening)
Metadata-protocol: none

- **New option `TranslateDocumentOptions.pairBundle`.** The translations the served item's paired `.custom` package ships itself (ADR-0146 D2/D3), locale-keyed as `bundle` is. The serving layer's `bundle` is one merged catalog per locale with the package ids dropped, so only this option can tell a translation the pair ships from the base's.
- **The order, per translatable string.** A string the override changed (`valueOverridesPackagedBase` against `packagedBase`, the comparison every translator already makes) reads the pair's translations only, along the locale chain, and otherwise keeps its own text: the base's translation is never read for it. A string the override left alone reads, locale by locale, the pair's translation and then the deployment catalog, so a pair that ships only `en` never displaces the base's `zh-CN` on an untouched label. Nested labels follow the same rule: widget titles, filter and option labels, view bulk-action defs and form sections, report blocks, field labels, help and options, page component copy, tab items and the header, dataset members, app navigation nodes and book groups.
- **`translatePage`, `translateDataset`, `translateApp` and `translateBook` now read `packagedBase`** (their third parameter widens from `ResolveOptions` to `TranslateDocumentOptions`), each string judged against the base's counterpart: the page's components by id and its header, the dataset's members by `name`, the app's navigation nodes by `id`, the book's groups by `key`. A page header title the override left as the base wrote it translates as the base's label.
- **Nothing moves for an existing caller.** With no `pairBundle` (or one that answers none of the chain's locales) every translator gives exactly the answer it gave before, and with no `packagedBase` nothing counts as changed. Passing both for a `.custom` override is the serving layer's half (#30062).
- An object's `validations[].message` and its inline `actions` keep reading the merged catalog: the rule evaluator answers the same message from `i18n.t()` with no pair input, and the refusal text must equal the served text.
