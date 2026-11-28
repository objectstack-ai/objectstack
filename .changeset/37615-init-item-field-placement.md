---
'@objectstack/cli': patch
---

fix(cli): `objectstack init -t app` places the item's fields through the group's `fields` list, as `objectstack generate object` does

Clause-②: no
Metadata-protocol: none

The item object of the `app` template now writes `fieldGroups: [{ key: 'details', label: 'Details', fields: ['name', 'description', 'status'] }]` after the field map, and its fields no longer carry `group: 'details'`. That is how `objectstack generate object` and the `npm create objectstack` starter place fields, so a new project meets one style. Both spellings mean the same placement: the form and detail page show the same Details section, and `objectstack validate` and `objectstack lint` report nothing new. A project scaffolded by an earlier release keeps working unchanged. When you add a field to the item, list its name in the group's `fields` too.
