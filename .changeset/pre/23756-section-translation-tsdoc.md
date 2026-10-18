---
'@objectstack/spec': patch
---

Clause-②: no

The published TSDoc now sends a form section's translations to the right key. `FormSectionSchema.name` used to name only `metadataForms.<type>.sections.<name>`, which is the key for a metadata-editing form (`defineForm({ schemaId })`, read by `resolveMetadataFormLabels`). A section of an object-bound form view is keyed at `objects.<object>._sections.<name>`, where `<object>` is the form's own `data.object`, else its view's. The docblock now names both keys and which form each one serves. `TranslationDataSchema._sections` now names the three surfaces that author its key (form-view sections, `record:details` sections, object `fieldGroups`) and its readers (`walkObjectSections`, `collectViewRecord`, `translateView`). `resolveMetadataFormLabels`' docblock no longer says that a section without a `name` keeps its section-level text: such a section is looked up under a slug of its `label`, as the function has always done. These are comment changes only: no key, `.describe()` text or behaviour changes. An object-form translation bundle written from the old docblock under `metadataForms.…` never translated anything. Move its section entries to `objects.<object>._sections.<name>`.
