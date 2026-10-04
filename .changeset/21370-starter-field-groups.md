---
'create-objectstack': patch
'@objectstack/cli': patch
---

fix: a fresh project no longer warns about its own starter fields after the first `objectstack generate`

Clause-②: no

The blank starter's `note` object (`npm create objectstack`) and the item object of the `app` template (`objectstack init -t app`) now declare one field group, `fieldGroups: [{ key: 'details', label: 'Details' }]`, and place every field in it with `group: 'details'`. Before this, the first view, flow, dashboard or other metadata that can read a field made `objectstack validate` and `objectstack lint` report `field-no-consumers` on a field the author never wrote: the note's `body`, or the item's `description` and `status`. That held whether the author generated it or wrote it by hand. Both commands still exited 0. A field placed in a declared group is drawn by the object's form and detail page, and the rule counts that as displayed, so a fresh project now reports nothing. The `plugin` and `empty` templates are unchanged: the plugin's one field is the record's title, which the rule never reports, and the empty template declares no object.

**What changes for an author.** In a new project, the object's form and detail page show the starter fields in one section labelled Details instead of a flat list. A field you add joins a section the same way, by naming its `key` in `group`. A project scaffolded by an earlier release keeps its files. To clear the warning there, add the same `fieldGroups` entry to the object and `group: 'details'` to each field the warning names, or give each field another consumer, such as a view column.
