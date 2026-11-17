---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a named import mapping's summary names fields by their labels, and its preview survives loading a second file

Clause-②: no
Metadata-protocol: none

Two defects in the import wizard when a saved (named) import mapping is active, both measured in a zh-CN organization:

- The mapping step's read-only summary listed each target by its API name (`supply_week`, `lead_source`). Every other wizard screen names a field by the label the server serves, which is the translated one in a localized organization. The summary now resolves each target, including each target of a split entry, to that served label. A target the wizard has no field for keeps its name.
- Going Back to the upload step and loading a file again kept the mapping selected: the summary still showed it, and the import still named it and ran correctly. But the preview grid was rebuilt by auto-matching the new headers to field names, which the server never applies. When the source headers did not resemble the field names, the preview showed no columns, so every row looked blank. A file loaded while a named mapping is active now derives the preview from that mapping, exactly as picking it does.

Translating the mapping's own label is not part of this change.
