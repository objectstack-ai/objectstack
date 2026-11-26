---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/platform-objects': patch
---

feat(spec): a Studio metadata form's select choices are translatable — `metadataForms.<type>.fields.<path>.options.<value>`

Clause-②: yes (widening)
Metadata-protocol: added

- **Translation slot.** A `metadataForms.<type>.fields.<path>` entry accepts `options`, a map from option `value` to its translated name — the shape `objects.<object>.fields.<field>.options` already uses. `choices` and `values` are accepted as its aliases, as on the object-field face.
- **Served forms.** `resolveMetadataFormLabels` (what `/api/v1/meta/types` localizes forms with) now overlays each option's `label` with the translation keyed by its `value`; an option with no translation keeps its own label. Before this, a select on a Studio metadata form (sharing model, ownership, field type, delete behaviour, default period, …) showed English choice names in every locale while the label and help text around it were translated.
- **Extraction.** `os i18n extract` and `pnpm check:i18n` emit the new `options.<value>` keys for every form row that lists `options`.
- **Shipped locales.** The ten translated metadata-forms packs of `@objectstack/platform-objects` name all 185 choices (38 select rows across nine forms). The Default Period choices reuse the wording of the console's period chip.
