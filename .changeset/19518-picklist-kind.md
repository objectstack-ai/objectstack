---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
'@objectstack/cli': patch
'@objectstack/driver-sql': patch
---

feat(spec): the `picklist` metadata kind — a shared option list that select fields reference by name (#19518)

Clause-②: yes (widening)

- **The kind.** `PicklistSchema` — `{ name, label, description?, options }`, where `options` is the field option shape (`SelectOptionSchema`) reused as is. Authored in a package as `*.picklist.ts` (`definePicklist`) or `defineStack({ picklists })`. It is a registered kind (`MetadataTypeSchema`, `DEFAULT_METADATA_TYPE_REGISTRY`, `getMetadataTypeSchema('picklist')`) that loads before `object`. It is package-owned, so a runtime create or a per-organization overlay is refused.
- **The reference.** `Field.select({ picklist: 'industry' })` adds a `picklist` key to `FieldSchema`. It is valid on the option types only (select, radio, multiselect, checkboxes, tags). A field that declares both `picklist` and `options` is refused at `options`, with a prescription. The functional-completeness predicate counts a `picklist` reference as the field's option source.
- **The served shape.** `PicklistServedFieldSchema` declares what a client reads for a picklist-bound field: the resolved `options` next to the `picklist` that names the list. The runtime resolves the reference onto that served field; see the picklist runtime entry of this release.
- **Extensions.** `defineStack({ picklistExtensions: [{ extend, options }] })` adds options to a picklist that another package owns. It can only add; removing or renaming a value stays with the owning package.
- **Translation.** `TranslationData` gains `picklists.<name>.{ label?, options: { value: label } }`. `translatePicklist` translates a served picklist item. `translateObject` gives a picklist-bound field the list's option labels, and a field-level `options` entry still wins over them.
- **Studio type label.** `@objectstack/platform-objects` carries the `picklist` type's label and description in its metadata-forms translation bundles (en, zh-CN, ja-JP, es-ES).
- **Extraction.** `os i18n extract` walks `picklists.NAME.{label, options.VALUE}`, including an extension's options under the list it extends, and `os lint` reports an untranslated option under its own rule, `i18n/missing-picklist`.
- **SQL driver.** The SQL driver classifies the `picklist` field key as presentation, so it adds no column.
