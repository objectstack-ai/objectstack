---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): add a field to a read-only base object, written as an extension in its customization pair

Clause-②: no
Metadata-protocol: none

- **Before.** In Studio's Data pillar, a base object of an installed (read-only) package offered no Add field: the grid "+" and the Form toolbar's add were hidden with the rest of the read-only package, and the field inspector locked every property. The only way to add a field was to take the object over.
- **Now.** On a base object of a read-only base with a customization pair, Add field is offered in the Form toolbar and the grid "+". Create ensures the pair `<base>.custom` (once, without a prompt) and writes an `object_extension` draft of the object into the pair through the `/api/v1/meta` doors. The base object's own body is never sent. The popover shows the api name with its `__c` suffix before Create, a typed name is suffixed too, and the taken-name refusal covers the fields of the object as shown, a published extension's fields included. The new field shows in the form at once and its inspector edits the extension; it joins the Records grid's columns once published, like any draft field.
- **Base fields.** Selecting one of the package's own fields opens the inspector with only `BASE_FIELD_DISPLAY_WHITELIST` editable (label, description, help text, placeholder, option labels), read from the spec constant, under one sentence naming them. An edit is written as the field's `fieldPatches` entry in the extension, and clearing a property drops it from the patch so the package's text shows again. Every other property draws read-only.
- **Refusals and walls.** A refusal from the ensure door or the save is shown in the server's own words. Under a walled posture the Add field action draws disabled with the console's walled sentence.
- A writable package's add-field and inspector are unchanged.
