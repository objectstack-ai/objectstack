---
'@objectstack/objectql': minor
'@objectstack/metadata': patch
'@objectstack/spec': patch
---

feat(objectql): the runtime resolves a field's `picklist` onto its served options, validates writes against the resolved list, and merges `picklistExtensions` additively

Clause-②: no

- **Load.** `defineStack({ picklists })` and `defineStack({ picklistExtensions })` now register, from a manifest and from a nested plugin, through the same registration seam as every other collection. The compiled-artifact door registers `picklists` as `picklist` items, so `GET /meta/picklist` serves them on an artifact boot.
- **Merge.** A picklist's options are its own, followed by the options every `picklistExtensions` entry adds. A value the list already carries is refused with `422 INVALID_METADATA`, which names both declarations, whichever of the two registered first. The later declaration never replaces the earlier one. A package that registers again replaces its own extension. Uninstalling a package removes the values it added.
- **Serve.** A field with `picklist: 'NAME'` is served with the resolved options written onto it and `picklist` kept (`PicklistServedFieldSchema`), on every object read, including objects stored in `sys_metadata`. The list's translations (`picklists.NAME.options.VALUE`) relabel those options per request locale. An option marked `default: true` in the list fills an omitted field on insert, as an inline option does, and the import template reads it the same way.
- **Unknown name.** A packaged field that names a picklist no loaded package declares fails the boot at `kernel:ready` with `INVALID_METADATA`, and so does a `picklistExtensions` entry that extends such a list. The error names every such field or extension and the package that declared it. After boot, an artifact registered through the `manifest` service is checked before any of it registers. A field whose list does not resolve is served with no options and accepts no value.
- **Write validation.** The write door judges a picklist-bound field against the resolved options, and its refusal names the picklist. The wire code stays `invalid_option`. The validation message catalog gains three message keys for this (`invalid_option_picklist`, `invalid_option_value_picklist`, `invalid_option_picklist_unresolved`) in en, zh-CN, ja-JP and es-ES. They change the message text only, never the wire.
- **Writing the served body back.** The served body carries `picklist` and `options` together. Writing it back through the metadata door is still refused, with the prescription to drop `options`, as `FieldSchema` declares. Nothing strips it on the write side.
- **Ledger.** `field.picklist`, the `picklist` kind's rows and `translation.picklists` are `live`. `field.picklist` no longer carries `authorWarn`, so `os lint` / `os validate` stop warning an author who writes it.
