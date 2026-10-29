---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the import wizard's "Match on" no longer offers a field the server refuses as a match key (#27567)

Clause-②: yes (widening)
Metadata-protocol: none

In "Update existing" and "Update if matched, else create", "Match on" listed every mapped field. The server refuses a match key whose value is a list or a structured payload (`400 INVALID_REQUEST`, #27465), so ticking such a field got the whole import refused at Validate. The list now leaves those fields out, by the same spec definitions the server's `multiValueMatchKeyRefusal` reads (`isMultiValueField`, `STRUCTURED_JSON_TYPES` from `@objectstack/spec/data`): a `multiple: true` lookup, user, select, radio, file or image field; a multiselect, checkboxes or tags field; and a JSON-stored type such as `json` or `address`. Single-value fields are offered as before.

The wizard's field shape (`ImportWizardProps['fields']`) takes an optional `multiple` flag, carried from the object schema by the console's import targets; a host that leaves it out still has the inherently multi and structured types filtered by type.

What to do: nothing.
